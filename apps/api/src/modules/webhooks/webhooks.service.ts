import { HttpStatus, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, type SQL } from 'drizzle-orm';
import { WEBHOOK_EVENTS } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { brands, webhookDeliveries, webhookEndpoints } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { brandScope, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { config } from '../../config';
import { newWebhookSecret } from './signature';
import { validateWebhookUrl } from './url-guard';
import { WebhookDispatcher } from './webhook-dispatcher.service';
import type { CreateEndpointDto, DeliveriesQueryDto, EndpointsQueryDto, UpdateEndpointDto } from './webhooks.dto';

export const MAX_ENDPOINTS_PER_BRAND = 10;

type EndpointRow = typeof webhookEndpoints.$inferSelect;

/** Webhook endpoints management (brand self-service; staff read-only + redeliver). */
@Injectable()
export class WebhooksService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  events() {
    return { events: WEBHOOK_EVENTS, wildcard: '*' };
  }

  async list(p: Principal, q: EndpointsQueryDto) {
    const scope = brandScope(p);
    const conds: SQL[] = [];
    if (scope) conds.push(eq(webhookEndpoints.brandId, scope));
    else if (q.brandId) conds.push(eq(webhookEndpoints.brandId, q.brandId));
    if (q.isActive !== undefined) conds.push(eq(webhookEndpoints.isActive, q.isActive));
    const where = conds.length ? and(...conds) : undefined;
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({ endpoint: webhookEndpoints, brandName: brands.name })
        .from(webhookEndpoints)
        .innerJoin(brands, eq(brands.id, webhookEndpoints.brandId))
        .where(where)
        .orderBy(desc(webhookEndpoints.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(webhookEndpoints).where(where),
    ]);
    return paginate(rows.map((r) => ({ ...present(r.endpoint), brandName: r.brandName })), Number(n), q);
  }

  async get(p: Principal, id: string) {
    const endpoint = await this.load(p, id);
    const since = new Date(Date.now() - 7 * 86_400_000);
    const stats = await this.db
      .select({ status: webhookDeliveries.status, n: count() })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.endpointId, id), gte(webhookDeliveries.createdAt, since)))
      .groupBy(webhookDeliveries.status);
    const [last] = await this.db
      .select({ id: webhookDeliveries.id, event: webhookDeliveries.event, status: webhookDeliveries.status, lastResponseCode: webhookDeliveries.lastResponseCode, createdAt: webhookDeliveries.createdAt })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(1);
    return { ...present(endpoint), last7Days: Object.fromEntries(stats.map((s) => [s.status, Number(s.n)])), lastDelivery: last ?? null };
  }

  async create(brandId: string, dto: CreateEndpointDto, actor: Principal, meta: RequestMetaInfo) {
    const url = await validateWebhookUrl(dto.url, { production: config.isProd });
    const events = normalizeEvents(dto.events);
    const id = await this.db.transaction(async (tx) => {
      await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).for('update');
      const [{ n }] = await tx.select({ n: count() }).from(webhookEndpoints).where(eq(webhookEndpoints.brandId, brandId));
      if (Number(n) >= MAX_ENDPOINTS_PER_BRAND) {
        throw new DomainError('WEBHOOK_LIMIT', `A brand can have at most ${MAX_ENDPOINTS_PER_BRAND} webhook endpoints`, HttpStatus.CONFLICT);
      }
      const [row] = await tx
        .insert(webhookEndpoints)
        .values({ brandId, url, events, description: dto.description ?? null, isActive: dto.isActive ?? true, secret: newWebhookSecret() })
        .$returningId();
      await this.audit.record(actor, { action: 'webhook.create', entity: 'WebhookEndpoint', entityId: row.id, after: { url, events } }, meta, tx);
      return row.id;
    });
    const [row] = await this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1);
    return { ...present(row), secret: row.secret };
  }

  async update(p: Principal, id: string, dto: UpdateEndpointDto, meta: RequestMetaInfo) {
    const before = await this.load(p, id);
    const patch: Partial<typeof webhookEndpoints.$inferInsert> = {};
    if (dto.url !== undefined) patch.url = await validateWebhookUrl(dto.url, { production: config.isProd });
    if (dto.events !== undefined) patch.events = normalizeEvents(dto.events);
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.isActive !== undefined) {
      patch.isActive = dto.isActive;
      if (dto.isActive && !before.isActive) patch.failureCount = 0;
    }
    if (Object.keys(patch).length) await this.db.update(webhookEndpoints).set(patch).where(eq(webhookEndpoints.id, id));
    await this.audit.record(p, { action: 'webhook.update', entity: 'WebhookEndpoint', entityId: id, before: present(before), after: patch }, meta);
    return this.get(p, id);
  }

  async remove(p: Principal, id: string, meta: RequestMetaInfo) {
    const before = await this.load(p, id);
    await this.db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    await this.audit.record(p, { action: 'webhook.delete', entity: 'WebhookEndpoint', entityId: id, before: present(before) }, meta);
    return { deleted: true };
  }

  async revealSecret(p: Principal, id: string, meta: RequestMetaInfo) {
    const endpoint = await this.load(p, id);
    await this.audit.record(p, { action: 'webhook.reveal_secret', entity: 'WebhookEndpoint', entityId: id }, meta);
    return { id, secret: endpoint.secret };
  }

  async rotateSecret(p: Principal, id: string, meta: RequestMetaInfo) {
    await this.load(p, id);
    const secret = newWebhookSecret();
    await this.db.update(webhookEndpoints).set({ secret }).where(eq(webhookEndpoints.id, id));
    await this.audit.record(p, { action: 'webhook.rotate_secret', entity: 'WebhookEndpoint', entityId: id }, meta);
    return { id, secret };
  }

  async deliveries(p: Principal, endpointId: string, q: DeliveriesQueryDto) {
    await this.load(p, endpointId);
    const where = and(
      eq(webhookDeliveries.endpointId, endpointId),
      q.status ? eq(webhookDeliveries.status, q.status) : undefined,
      q.event ? eq(webhookDeliveries.event, q.event) : undefined,
    );
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({
          id: webhookDeliveries.id, event: webhookDeliveries.event, status: webhookDeliveries.status, attempts: webhookDeliveries.attempts,
          nextAttemptAt: webhookDeliveries.nextAttemptAt, lastResponseCode: webhookDeliveries.lastResponseCode, lastError: webhookDeliveries.lastError,
          deliveredAt: webhookDeliveries.deliveredAt, createdAt: webhookDeliveries.createdAt,
        })
        .from(webhookDeliveries)
        .where(where)
        .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(webhookDeliveries).where(where),
    ]);
    return paginate(rows.map((r) => ({ ...r, nextAttemptAt: r.status === 'PENDING' || r.status === 'FAILED' ? r.nextAttemptAt : null })), Number(n), q);
  }

  async delivery(p: Principal, deliveryId: string) {
    const row = await this.loadDelivery(p, deliveryId);
    return row;
  }

  /** Queues a fresh copy of a delivery (same payload & event id) for immediate sending. */
  async redeliver(p: Principal, deliveryId: string, meta: RequestMetaInfo) {
    const original = await this.loadDelivery(p, deliveryId);
    const endpoint = await this.load(p, original.endpointId);
    if (!endpoint.isActive) throw new DomainError('WEBHOOK_DISABLED', 'Enable the endpoint before re-delivering', HttpStatus.CONFLICT);
    if (original.event === 'ping') throw new DomainError('NOT_REDELIVERABLE', 'Use the test action to send a new ping', HttpStatus.CONFLICT);
    const [row] = await this.db
      .insert(webhookDeliveries)
      .values({ endpointId: endpoint.id, event: original.event, payload: original.payload, status: 'PENDING', nextAttemptAt: new Date() })
      .$returningId();
    await this.audit.record(p, { action: 'webhook.redeliver', entity: 'WebhookDelivery', entityId: row.id, before: { from: deliveryId } }, meta);
    return this.loadDelivery(p, row.id);
  }

  async test(p: Principal, id: string) {
    const endpoint = await this.load(p, id);
    return this.dispatcher.ping(endpoint);
  }

  private async load(p: Principal, id: string): Promise<EndpointRow> {
    const scope = brandScope(p);
    const [row] = await this.db
      .select()
      .from(webhookEndpoints)
      .where(scope ? and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.brandId, scope)) : eq(webhookEndpoints.id, id))
      .limit(1);
    if (!row) throw notFound('Webhook endpoint', id);
    return row;
  }

  private async loadDelivery(p: Principal, id: string) {
    const scope = brandScope(p);
    const [row] = await this.db
      .select({ delivery: webhookDeliveries, brandId: webhookEndpoints.brandId })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(scope ? and(eq(webhookDeliveries.id, id), eq(webhookEndpoints.brandId, scope)) : eq(webhookDeliveries.id, id))
      .limit(1);
    if (!row) throw notFound('Webhook delivery', id);
    return row.delivery;
  }
}

/** Endpoint without its secret. */
function present(e: EndpointRow) {
  const { secret, ...rest } = e;
  return { ...rest, secretHint: `${secret.slice(0, 9)}…${secret.slice(-4)}` };
}

function normalizeEvents(events: string[]): string[] {
  const unique = [...new Set(events)];
  if (unique.includes('*')) return ['*'];
  return unique.sort();
}
