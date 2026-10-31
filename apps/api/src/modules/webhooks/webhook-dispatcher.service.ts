import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { WebhookEvent } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { webhookDeliveries, webhookEndpoints } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { JobsService } from '../../core/jobs.service';
import { newId } from '../../db/columns';
import { config } from '../../config';
import { mapWithBudget } from '../notifications/providers/http';
import { NotificationsService } from '../notifications/notifications.service';
import { signPayload } from './signature';
import { postWebhook, type SendOutcome } from './webhook-sender';

export type WebhookEventName = WebhookEvent | 'ping';

export interface WebhookPayload {
  /** Event id — identical for every endpoint and across retries; use it to de-duplicate. */
  id: string;
  event: WebhookEventName;
  createdAt: string;
  data: Record<string, unknown>;
}

type EndpointRow = typeof webhookEndpoints.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/** Delay before retry n (after the n-th failed attempt). 8 retries → 9 attempts, then DEAD. */
export const RETRY_BACKOFF_SECONDS = [60, 5 * 60, 15 * 60, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 24 * 3600];
export const MAX_DELIVERY_ATTEMPTS = RETRY_BACKOFF_SECONDS.length + 1;
/** Consecutive failed attempts after which an endpoint is switched off. */
export const AUTO_DISABLE_AFTER = 50;
const BATCH = 50;
const LEASE_MS = 5 * 60_000;
const JOB_BUDGET_MS = 60_000;
export const USER_AGENT = 'GoTurtle-Webhooks/1.0';

/**
 * Outbound webhooks: fan-out of domain events into `webhook_deliveries`
 * (one row per matching endpoint) and the `webhooks.deliver` job that POSTs
 * them with signatures, retries with backoff and auto-disables endpoints that
 * keep failing. See ./signature.ts for the verification recipe.
 */
@Injectable()
export class WebhookDispatcher implements OnModuleInit {
  private readonly log = new Logger('Webhooks');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.jobs.register({ name: 'webhooks.deliver', everySeconds: 15, timeoutSeconds: 90, run: () => this.processDue() });
  }

  static payload(event: WebhookEventName, data: Record<string, unknown>, at: Date = new Date()): WebhookPayload {
    return { id: `evt_${newId()}`, event, createdAt: at.toISOString(), data };
  }

  /** Queues one event for every active endpoint of the brand that subscribed to it. */
  async enqueue(brandId: string, event: WebhookEvent, data: Record<string, unknown>, at?: Date): Promise<number> {
    const endpoints = await this.db
      .select({ id: webhookEndpoints.id, events: webhookEndpoints.events })
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.brandId, brandId), eq(webhookEndpoints.isActive, true)));
    const targets = endpoints.filter((e) => (e.events ?? []).includes('*') || (e.events ?? []).includes(event));
    if (!targets.length) return 0;
    const payload = WebhookDispatcher.payload(event, data, at);
    await this.db.insert(webhookDeliveries).values(targets.map((t) => ({ endpointId: t.id, event, payload, status: 'PENDING' as const, nextAttemptAt: new Date() })));
    return targets.length;
  }

  /** Job: deliver due PENDING / FAILED rows of active endpoints. */
  async processDue(): Promise<string> {
    const now = new Date();
    const due = await this.db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(and(inArray(webhookDeliveries.status, ['PENDING', 'FAILED']), lte(webhookDeliveries.nextAttemptAt, now), eq(webhookEndpoints.isActive, true)))
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(BATCH);
    if (!due.length) return 'idle';

    // Lease the batch (unique lease time) so an overlapping runner cannot pick the same rows.
    const leaseUntil = new Date(now.getTime() + LEASE_MS + Math.floor(Math.random() * 1000));
    await this.db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: leaseUntil })
      .where(and(inArray(webhookDeliveries.id, due.map((d) => d.id)), inArray(webhookDeliveries.status, ['PENDING', 'FAILED']), lte(webhookDeliveries.nextAttemptAt, now)));
    const leased = await this.db
      .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(and(inArray(webhookDeliveries.id, due.map((d) => d.id)), eq(webhookDeliveries.nextAttemptAt, leaseUntil)));

    const tally = { success: 0, failed: 0, dead: 0 };
    const leftover = await mapWithBudget(leased, { concurrency: 5, budgetMs: JOB_BUDGET_MS }, async ({ delivery, endpoint }) => {
      const status = await this.attempt(delivery, endpoint).catch((err) => {
        this.log.error(`delivery ${delivery.id} crashed: ${err instanceof Error ? err.message : err}`);
        return 'FAILED' as const;
      });
      if (status === 'SUCCESS') tally.success++;
      else if (status === 'DEAD') tally.dead++;
      else tally.failed++;
    });
    if (leftover.length) {
      await this.db
        .update(webhookDeliveries)
        .set({ nextAttemptAt: new Date() })
        .where(and(inArray(webhookDeliveries.id, leftover.map((l) => l.delivery.id)), eq(webhookDeliveries.nextAttemptAt, leaseUntil)));
    }
    return `success ${tally.success}, failed ${tally.failed}, dead ${tally.dead}${leftover.length ? `, deferred ${leftover.length}` : ''}`;
  }

  /** One HTTP attempt + bookkeeping. */
  async attempt(delivery: DeliveryRow, endpoint: EndpointRow): Promise<'SUCCESS' | 'FAILED' | 'DEAD'> {
    const outcome = await this.send(endpoint, delivery.id, delivery.event, delivery.payload);
    const attempts = delivery.attempts + 1;
    if (outcome.ok) {
      await this.db
        .update(webhookDeliveries)
        .set({ status: 'SUCCESS', attempts, lastResponseCode: outcome.status, lastResponseBody: outcome.body, lastError: null, deliveredAt: new Date(), nextAttemptAt: new Date() })
        .where(eq(webhookDeliveries.id, delivery.id));
      if (endpoint.failureCount !== 0) await this.db.update(webhookEndpoints).set({ failureCount: 0 }).where(eq(webhookEndpoints.id, endpoint.id));
      return 'SUCCESS';
    }
    const dead = attempts >= MAX_DELIVERY_ATTEMPTS;
    const next = new Date(Date.now() + (RETRY_BACKOFF_SECONDS[attempts - 1] ?? RETRY_BACKOFF_SECONDS.at(-1)!) * 1000);
    await this.db
      .update(webhookDeliveries)
      .set({ status: dead ? 'DEAD' : 'FAILED', attempts, lastResponseCode: outcome.status, lastResponseBody: outcome.body, lastError: outcome.error?.slice(0, 1000) ?? null, nextAttemptAt: dead ? new Date() : next })
      .where(eq(webhookDeliveries.id, delivery.id));
    await this.recordEndpointFailure(endpoint);
    return dead ? 'DEAD' : 'FAILED';
  }

  /** Synchronous `ping` used by POST /webhooks/endpoints/:id/test (logged, never retried). */
  async ping(endpoint: EndpointRow) {
    const payload = WebhookDispatcher.payload('ping', { endpointId: endpoint.id, url: endpoint.url, message: 'GoTurtle webhook test' });
    const [row] = await this.db
      .insert(webhookDeliveries)
      .values({ endpointId: endpoint.id, event: 'ping', payload, status: 'PENDING', nextAttemptAt: new Date(Date.now() + 365 * 86_400_000) })
      .$returningId();
    const outcome = await this.send(endpoint, row.id, 'ping', payload);
    await this.db
      .update(webhookDeliveries)
      .set({
        status: outcome.ok ? 'SUCCESS' : 'DEAD', attempts: 1, lastResponseCode: outcome.status, lastResponseBody: outcome.body, lastError: outcome.error,
        deliveredAt: outcome.ok ? new Date() : null, nextAttemptAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, row.id));
    return { deliveryId: row.id, ok: outcome.ok, statusCode: outcome.status, durationMs: outcome.durationMs, responseBody: outcome.body, error: outcome.error };
  }

  private send(endpoint: EndpointRow, deliveryId: string, event: string, payload: unknown): Promise<SendOutcome> {
    const body = JSON.stringify(payload);
    return postWebhook(
      endpoint.url,
      body,
      {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-GoTurtle-Event': event,
        'X-GoTurtle-Delivery': deliveryId,
        'X-GoTurtle-Signature': signPayload(endpoint.secret, body),
      },
      { timeoutMs: 10_000, allowPrivate: !config.isProd },
    );
  }

  private async recordEndpointFailure(endpoint: EndpointRow) {
    await this.db.update(webhookEndpoints).set({ failureCount: sql`${webhookEndpoints.failureCount} + 1` }).where(eq(webhookEndpoints.id, endpoint.id));
    const [res] = (await this.db
      .update(webhookEndpoints)
      .set({ isActive: false })
      .where(and(eq(webhookEndpoints.id, endpoint.id), eq(webhookEndpoints.isActive, true), gte(webhookEndpoints.failureCount, AUTO_DISABLE_AFTER)))) as unknown as [
      { affectedRows: number },
    ];
    if (res.affectedRows === 1) {
      this.log.warn(`webhook endpoint ${endpoint.id} (${endpoint.url}) disabled after ${AUTO_DISABLE_AFTER} consecutive failures`);
      await this.notifications
        .notifyBrandOwners(endpoint.brandId, 'webhook_disabled', { url: endpoint.url, failures: AUTO_DISABLE_AFTER }, { email: true, data: { endpointId: endpoint.id, link: '/brand/developers' } })
        .catch((err) => this.log.error(`webhook_disabled notification failed: ${err instanceof Error ? err.message : err}`));
    }
  }
}
