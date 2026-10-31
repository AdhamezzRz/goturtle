import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import webpush from 'web-push';
import type { UserRole } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { pushSubscriptions, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { sha256 } from '../../common/crypto';
import { SettingsService } from '../settings/settings.service';
import { renderTemplate, type TemplateName, type TemplateVars } from '../notifications/templates';
import type { SubscribeDto } from './push.dto';

export interface PushMessage {
  title: string;
  body: string;
  /** Opened on tap (same-origin path). */
  url?: string;
  /** Notifications with the same tag replace each other on the device. */
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Transport (web-push in production, a stub in tests). Resolves with the push service's HTTP status. */
export interface PushSender {
  send(target: PushTarget, payload: string, opts: { ttlSeconds: number; urgency: 'normal' | 'high'; topic?: string }): Promise<{ statusCode: number }>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** VAPID keys from the environment; null (push disabled) when not configured. */
export function vapidFromEnv(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || 'mailto:ops@goturtle.co' };
}

/** web-push transport. Errors with a status code (404/410 expired, 413 too big…) resolve with that code. */
export class WebPushSender implements PushSender {
  async send(target: PushTarget, payload: string, opts: { ttlSeconds: number; urgency: 'normal' | 'high'; topic?: string }) {
    const vapid = vapidFromEnv();
    if (!vapid) throw new Error('VAPID keys are not configured');
    try {
      const res = await webpush.sendNotification(target, payload, {
        vapidDetails: vapid,
        TTL: opts.ttlSeconds,
        urgency: opts.urgency,
        ...(opts.topic ? { topic: opts.topic } : {}),
        timeout: 10_000,
      });
      return { statusCode: res.statusCode };
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (typeof code === 'number') return { statusCode: code };
      throw err;
    }
  }
}

/** Drop a subscription after this many consecutive non-expiry failures. */
const MAX_FAILURES = 10;
const MAX_SUBSCRIPTIONS_PER_USER = 10;

export interface SendResult {
  enabled: boolean;
  sent: number;
  failed: number;
  pruned: number;
}

/**
 * Web Push (VAPID). Subscriptions are per browser/device and upserted by
 * sha256(endpoint). Expired endpoints (404/410) are deleted, other failures
 * counted (and the subscription dropped after repeated failures). Without
 * VAPID keys push is simply disabled — callers never need to check.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  get enabled(): boolean {
    return !!vapidFromEnv();
  }

  publicKey() {
    return { enabled: this.enabled, publicKey: vapidFromEnv()?.publicKey ?? null };
  }

  async subscribe(userId: string, dto: SubscribeDto, userAgent: string | null) {
    const endpointHash = sha256(dto.endpoint);
    const values = { userId, endpoint: dto.endpoint, endpointHash, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null, failures: 0 };
    // Same browser re-subscribing (or switching account) updates the row.
    await this.db
      .insert(pushSubscriptions)
      .values(values)
      .onDuplicateKeyUpdate({ set: { userId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent: values.userAgent, failures: 0 } });
    // Keep the newest subscriptions per user only.
    const rows = await this.db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).orderBy(sql`${pushSubscriptions.createdAt} desc`);
    if (rows.length > MAX_SUBSCRIPTIONS_PER_USER) {
      await this.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, rows.slice(MAX_SUBSCRIPTIONS_PER_USER).map((r) => r.id)));
    }
    return { subscribed: true, enabled: this.enabled, devices: Math.min(rows.length, MAX_SUBSCRIPTIONS_PER_USER) };
  }

  async unsubscribe(userId: string, endpoint: string) {
    const [res] = (await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpointHash, sha256(endpoint))))) as unknown as [{ affectedRows: number }];
    return { unsubscribed: res.affectedRows > 0 };
  }

  async status(userId: string, endpoint?: string) {
    const rows = await this.db.select({ hash: pushSubscriptions.endpointHash }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    return { enabled: this.enabled, devices: rows.length, thisDevice: endpoint ? rows.some((r) => r.hash === sha256(endpoint)) : null };
  }

  async sendTest(userId: string): Promise<SendResult> {
    return this.notifyUsers([userId], 'push_test', {}, { url: '/', tag: 'test' });
  }

  /** Renders a template in each user's language and pushes it to all their devices. */
  async notifyUsers(userIds: string[], template: TemplateName, vars: TemplateVars | ((locale: 'ar' | 'en') => TemplateVars), opts: { url?: string; tag?: string; urgency?: 'normal' | 'high' } = {}): Promise<SendResult> {
    const ids = [...new Set(userIds.filter(Boolean))];
    const total: SendResult = { enabled: this.enabled, sent: 0, failed: 0, pruned: 0 };
    if (!ids.length || !this.enabled) return total;
    const company = (await this.settings.get('company')).name;
    const recipients = await this.db.select({ id: users.id, locale: users.locale, status: users.status }).from(users).where(inArray(users.id, ids));
    for (const u of recipients) {
      if (u.status !== 'ACTIVE') continue;
      const r = renderTemplate(template, u.locale, { company, ...(typeof vars === 'function' ? vars(u.locale) : vars) });
      const res = await this.sendToUser(u.id, { title: r.title, body: r.body, url: opts.url, tag: opts.tag }, opts.urgency);
      total.sent += res.sent;
      total.failed += res.failed;
      total.pruned += res.pruned;
    }
    return total;
  }

  async notifyRoles(roles: UserRole[], template: TemplateName, vars: TemplateVars | ((locale: 'ar' | 'en') => TemplateVars), opts: { url?: string; tag?: string } = {}) {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(pushSubscriptions, eq(pushSubscriptions.userId, users.id))
      .where(and(inArray(users.role, roles), eq(users.status, 'ACTIVE')))
      .groupBy(users.id)
      .limit(500);
    return this.notifyUsers(rows.map((r) => r.id), template, vars, opts);
  }

  async notifyBrandOwners(brandId: string, template: TemplateName, vars: TemplateVars | ((locale: 'ar' | 'en') => TemplateVars), opts: { url?: string; tag?: string } = {}) {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(pushSubscriptions, eq(pushSubscriptions.userId, users.id))
      .where(and(eq(users.brandId, brandId), eq(users.role, 'BRAND_OWNER'), eq(users.status, 'ACTIVE')))
      .groupBy(users.id);
    return this.notifyUsers(rows.map((r) => r.id), template, vars, opts);
  }

  /** Low level: one message to every device of a user. Never throws. */
  async sendToUser(userId: string, msg: PushMessage, urgency: 'normal' | 'high' = 'normal'): Promise<SendResult> {
    const result: SendResult = { enabled: this.enabled, sent: 0, failed: 0, pruned: 0 };
    if (!this.enabled) return result;
    const subs = await this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).limit(MAX_SUBSCRIPTIONS_PER_USER);
    if (!subs.length) return result;
    const payload = JSON.stringify({
      title: msg.title.slice(0, 120),
      body: msg.body.slice(0, 400),
      url: msg.url && msg.url.startsWith('/') ? msg.url : '/',
      tag: msg.tag ?? null,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      ts: Date.now(),
    });
    for (const s of subs) {
      try {
        const { statusCode } = await this.sender.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          ttlSeconds: 6 * 3600,
          urgency,
          topic: msg.tag ? msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined : undefined,
        });
        if (statusCode >= 200 && statusCode < 300) {
          result.sent++;
          await this.db.update(pushSubscriptions).set({ failures: 0, lastUsedAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
        } else if (statusCode === 404 || statusCode === 410) {
          result.pruned++;
          await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        } else {
          await this.recordFailure(s.id, s.failures, result, `HTTP ${statusCode}`);
        }
      } catch (err) {
        await this.recordFailure(s.id, s.failures, result, err instanceof Error ? err.message : String(err));
      }
    }
    return result;
  }

  private async recordFailure(id: string, failures: number, result: SendResult, reason: string) {
    result.failed++;
    this.log.warn(`push to subscription ${id} failed: ${reason}`);
    if (failures + 1 >= MAX_FAILURES) {
      result.pruned++;
      await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
    } else {
      await this.db.update(pushSubscriptions).set({ failures: sql`${pushSubscriptions.failures} + 1` }).where(eq(pushSubscriptions.id, id));
    }
  }
}
