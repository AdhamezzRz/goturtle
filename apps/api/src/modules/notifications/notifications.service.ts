import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNull, like, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Locale, NotificationChannel, NotificationStatus, UserRole } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { notifications, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { JobsService } from '../../core/jobs.service';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { likeEscape, loadByIds } from '../../db/helpers';
import { SettingsService } from '../settings/settings.service';
import { ProviderRegistry } from './providers/provider-registry';
import { ProviderError, type SendResult } from './providers/types';
import { mapWithBudget } from './providers/http';
import { emailHtml, renderTemplate, type TemplateName, type TemplateVars } from './templates';
import type { AdminNotificationsQueryDto, MyNotificationsQueryDto } from './notifications.dto';

export type OutboundChannel = Extract<NotificationChannel, 'SMS' | 'WHATSAPP' | 'EMAIL'>;

export interface OutboundInput {
  channel: OutboundChannel;
  /** E.164 phone for SMS/WhatsApp, address for e-mail. */
  to: string;
  template: TemplateName;
  vars: TemplateVars;
  locale?: Locale;
  userId?: string | null;
  orderId?: string | null;
  data?: Record<string, unknown> | null;
}

export interface InAppOptions {
  data?: Record<string, unknown> | null;
  orderId?: string | null;
  /** Also e-mail users that have an address. */
  email?: boolean;
}

type NotificationRow = typeof notifications.$inferSelect;

export const MAX_ATTEMPTS = 3;
/** Attempt n (0-based count of previous attempts) is due this long after the row was created. */
const BACKOFF_MS = [0, 60_000, 5 * 60_000];
/** Template variables that must not stay readable in the log once the message went out. */
const SENSITIVE_VARS = ['code', 'password'];
const BATCH = 50;

/**
 * Outbound messages (SMS, WhatsApp, e-mail) and in-app notifications.
 *
 *  - queue(): renders the template and stores a QUEUED row; the
 *    `notifications.send` job (every 10 s, batches of 50, max 3 attempts with
 *    1 min / 5 min backoff) delivers it through the configured provider.
 *  - sendNow(): same, but attempts delivery immediately (OTP codes).
 *  - inApp(): rows shown in the portals' bell (`GET /notifications`).
 *
 * Every attempt claims the row with an optimistic `attempts = n` update so the
 * job and an immediate send can never deliver the same row twice. Secrets
 * (OTP codes, temporary passwords) are masked in the stored body once the
 * message is sent or has finally failed.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly providers: ProviderRegistry,
  ) {}

  onModuleInit() {
    this.jobs.register({ name: 'notifications.send', everySeconds: 10, timeoutSeconds: 90, run: () => this.processQueue() });
  }

  // ------------------------------------------------------------------ outbound

  /** Renders and stores a message for the background sender. Returns the row id. */
  async queue(input: OutboundInput, tx?: DbOrTx): Promise<string> {
    const values = await this.buildRow(input);
    const [row] = await (tx ?? this.db).insert(notifications).values(values).$returningId();
    return row.id;
  }

  /** Stores the message and delivers it right away (still retried by the job if the provider fails). */
  async sendNow(input: OutboundInput): Promise<NotificationRow> {
    const id = await this.queue(input);
    await this.attempt(id, 0);
    return this.getRow(id);
  }

  private async buildRow(input: OutboundInput): Promise<typeof notifications.$inferInsert> {
    const company = await this.settings.get('company');
    const vars: TemplateVars = { company: company.name, ...input.vars };
    const locale: Locale = input.locale === 'en' ? 'en' : 'ar';
    const rendered = renderTemplate(input.template, locale, vars);
    const hasSecret = SENSITIVE_VARS.some((k) => vars[k] !== undefined && vars[k] !== null && vars[k] !== '');
    const masked = hasSecret
      ? renderTemplate(input.template, locale, { ...vars, ...Object.fromEntries(SENSITIVE_VARS.filter((k) => vars[k]).map((k) => [k, '••••••'])) })
      : null;
    const body = input.channel === 'EMAIL' ? rendered.text : rendered.body;
    return {
      channel: input.channel,
      recipient: input.to.slice(0, 191),
      userId: input.userId ?? null,
      orderId: input.orderId ?? null,
      template: input.template,
      locale,
      title: rendered.title.slice(0, 200),
      body,
      data: {
        ...(input.data ?? {}),
        ...(masked ? { maskedBody: input.channel === 'EMAIL' ? masked.text : masked.body, sensitive: true } : {}),
        // Removed from the row once sent (they may contain the secret).
        ...(input.channel === 'EMAIL' ? { html: rendered.html } : {}),
        ...(input.channel === 'WHATSAPP' ? { params: rendered.params } : {}),
      },
      status: 'QUEUED',
    };
  }

  /**
   * One delivery attempt. `expectedAttempts` is the attempts value the caller
   * saw; the claim fails (and nothing is sent) if someone else got there first.
   */
  private async attempt(id: string, expectedAttempts: number): Promise<NotificationStatus | 'SKIPPED'> {
    const [claim] = (await this.db
      .update(notifications)
      .set({ attempts: sql`${notifications.attempts} + 1` })
      .where(and(eq(notifications.id, id), eq(notifications.status, 'QUEUED'), eq(notifications.attempts, expectedAttempts)))) as unknown as [{ affectedRows: number }];
    if (claim.affectedRows !== 1) return 'SKIPPED';
    const row = await this.getRow(id);
    const attempts = expectedAttempts + 1;
    const data = (row.data ?? {}) as Record<string, unknown>;
    const finalBody = typeof data.maskedBody === 'string' ? data.maskedBody : row.body;
    const finalData = (): Record<string, unknown> => {
      const { maskedBody: _m, html: _h, params: _p, ...rest } = data;
      void _m;
      void _h;
      void _p;
      return rest;
    };

    let provider = 'unknown';
    try {
      let result: SendResult;
      if (row.channel === 'SMS') {
        const p = this.providers.sms();
        provider = p.name;
        result = await p.sendSms({ to: row.recipient, body: row.body });
      } else if (row.channel === 'WHATSAPP') {
        const p = this.providers.whatsapp();
        provider = p.name;
        const params = Array.isArray(data.params) ? (data.params as string[]) : [];
        result = await p.sendWhatsApp({ to: row.recipient, body: row.body, template: { name: row.template, locale: row.locale, params } });
      } else if (row.channel === 'EMAIL') {
        const p = this.providers.email();
        provider = p.name;
        const subject = row.title ?? row.template;
        const html = typeof data.html === 'string' ? data.html : emailHtml(subject, row.body, row.locale);
        result = await p.sendEmail({ to: row.recipient, subject, text: row.body, html });
      } else {
        // In-app / push rows are never queued for delivery.
        await this.db.update(notifications).set({ status: 'SENT', sentAt: new Date() }).where(eq(notifications.id, id));
        return 'SENT';
      }
      await this.db
        .update(notifications)
        .set({ status: 'SENT', sentAt: new Date(), provider, providerMessageId: result.messageId?.slice(0, 120) ?? null, error: null, body: finalBody, data: finalData() })
        .where(eq(notifications.id, id));
      return 'SENT';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof ProviderError ? err.retryable : true;
      const failed = !retryable || attempts >= MAX_ATTEMPTS;
      this.log.warn(`notification ${id} (${row.channel} ${row.template}) attempt ${attempts} failed: ${message}`);
      await this.db
        .update(notifications)
        .set({
          status: failed ? 'FAILED' : 'QUEUED',
          provider,
          error: message.slice(0, 1000),
          ...(failed ? { body: finalBody, data: finalData() } : {}),
        })
        .where(eq(notifications.id, id));
      return failed ? 'FAILED' : 'QUEUED';
    }
  }

  /** Job: deliver due QUEUED rows. */
  async processQueue(): Promise<string> {
    const now = Date.now();
    const due = or(
      eq(notifications.attempts, 0),
      and(eq(notifications.attempts, 1), lte(notifications.createdAt, new Date(now - BACKOFF_MS[1]))),
      and(eq(notifications.attempts, 2), lte(notifications.createdAt, new Date(now - BACKOFF_MS[2]))),
    );
    const rows = await this.db
      .select({ id: notifications.id, attempts: notifications.attempts })
      .from(notifications)
      .where(and(eq(notifications.status, 'QUEUED'), ne(notifications.channel, 'IN_APP'), lt(notifications.attempts, MAX_ATTEMPTS), due))
      .orderBy(asc(notifications.createdAt))
      .limit(BATCH);
    const tally: Record<string, number> = {};
    await mapWithBudget(rows, { concurrency: 5, budgetMs: 60_000 }, async (r) => {
      const status = await this.attempt(r.id, r.attempts).catch((err) => {
        this.log.error(`notification ${r.id} crashed: ${err instanceof Error ? err.message : err}`);
        return 'ERROR' as const;
      });
      tally[status] = (tally[status] ?? 0) + 1;
    });
    return rows.length ? Object.entries(tally).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ') : 'idle';
  }

  // ------------------------------------------------------------------ in-app

  /** Bell notifications for users, rendered in each user's locale. */
  async inApp(userIds: string[], template: TemplateName, vars: TemplateVars, opts: InAppOptions = {}): Promise<number> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return 0;
    const company = await this.settings.get('company');
    const recipients = await loadByIds(this.db, users, users.id, ids);
    const now = new Date();
    const rows: Array<typeof notifications.$inferInsert> = [];
    for (const u of recipients.values()) {
      if (u.status !== 'ACTIVE') continue;
      const rendered = renderTemplate(template, u.locale, { company: company.name, ...vars });
      rows.push({
        channel: 'IN_APP', recipient: u.id, userId: u.id, orderId: opts.orderId ?? null, template, locale: u.locale,
        title: rendered.title.slice(0, 200), body: rendered.body, data: opts.data ?? null, status: 'SENT', sentAt: now, provider: 'in_app',
      });
    }
    if (rows.length) await this.db.insert(notifications).values(rows);
    if (opts.email) {
      for (const u of recipients.values()) {
        if (u.status === 'ACTIVE' && u.email) {
          await this.queue({ channel: 'EMAIL', to: u.email, template, vars, locale: u.locale, userId: u.id, orderId: opts.orderId ?? null, data: opts.data ?? null });
        }
      }
    }
    return rows.length;
  }

  /** In-app notification to every active staff user with one of the roles. */
  async notifyRoles(roles: UserRole[], template: TemplateName, vars: TemplateVars, opts: InAppOptions & { exceptUserId?: string | null } = {}) {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, roles), eq(users.status, 'ACTIVE')))
      .limit(500);
    return this.inApp(rows.map((r) => r.id).filter((id) => id !== opts.exceptUserId), template, vars, opts);
  }

  /** In-app (+ optional e-mail) to the active owners of a brand. */
  async notifyBrandOwners(brandId: string, template: TemplateName, vars: TemplateVars, opts: InAppOptions = {}) {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.brandId, brandId), eq(users.role, 'BRAND_OWNER'), eq(users.status, 'ACTIVE')));
    return this.inApp(rows.map((r) => r.id), template, vars, opts);
  }

  async listMine(userId: string, q: MyNotificationsQueryDto) {
    const where = and(
      eq(notifications.userId, userId),
      eq(notifications.channel, 'IN_APP'),
      q.unread ? eq(notifications.status, 'SENT') : undefined,
    );
    const [rows, [{ n }], unread] = await Promise.all([
      this.db
        .select({
          id: notifications.id, template: notifications.template, title: notifications.title, body: notifications.body,
          data: notifications.data, orderId: notifications.orderId, readAt: notifications.readAt, createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(notifications).where(where),
      this.unreadCount(userId),
    ]);
    return { ...paginate(rows, Number(n), q), unread: unread.unread };
  }

  async unreadCount(userId: string) {
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.status, 'SENT'), eq(notifications.channel, 'IN_APP')));
    return { unread: Number(n) };
  }

  async markRead(userId: string, id: string) {
    const [row] = await this.db
      .select({ id: notifications.id, readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId), eq(notifications.channel, 'IN_APP')))
      .limit(1);
    if (!row) throw notFound('Notification', id);
    if (!row.readAt) {
      await this.db.update(notifications).set({ status: 'READ', readAt: new Date() }).where(eq(notifications.id, id));
    }
    return { ok: true, ...(await this.unreadCount(userId)) };
  }

  async markAllRead(userId: string) {
    const [res] = (await this.db
      .update(notifications)
      .set({ status: 'READ', readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.status, 'SENT'), eq(notifications.channel, 'IN_APP'), isNull(notifications.readAt)))) as unknown as [
      { affectedRows: number },
    ];
    return { ok: true, updated: res.affectedRows, unread: 0 };
  }

  // ------------------------------------------------------------------ staff log

  async adminList(q: AdminNotificationsQueryDto) {
    const conds: SQL[] = [];
    if (q.channel) conds.push(eq(notifications.channel, q.channel));
    if (q.status) conds.push(eq(notifications.status, q.status));
    if (q.template) conds.push(eq(notifications.template, q.template));
    if (q.orderId) conds.push(eq(notifications.orderId, q.orderId));
    if (q.userId) conds.push(eq(notifications.userId, q.userId));
    if (q.q) conds.push(like(notifications.recipient, `%${likeEscape(q.q)}%`));
    if (q.from) conds.push(gte(notifications.createdAt, new Date(q.from)));
    if (q.to) conds.push(lt(notifications.createdAt, new Date(q.to)));
    const where = conds.length ? and(...conds) : undefined;
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(q.order === 'asc' ? asc(notifications.createdAt) : desc(notifications.createdAt), desc(notifications.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(notifications).where(where),
    ]);
    return paginate(rows.map((r) => this.publicRow(r)), Number(n), q);
  }

  /** Re-sends an SMS / WhatsApp / e-mail as a new log row. OTP and password messages must be re-requested instead. */
  async resend(id: string) {
    const row = await this.getRow(id);
    if (row.channel === 'IN_APP' || row.channel === 'PUSH') throw new DomainError('NOT_RESENDABLE', 'In-app notifications cannot be re-sent', HttpStatus.CONFLICT);
    if (row.status === 'QUEUED') throw new DomainError('NOT_RESENDABLE', 'The message is still queued', HttpStatus.CONFLICT);
    if ((row.data as Record<string, unknown> | null)?.sensitive) {
      throw new DomainError('NOT_RESENDABLE', 'Messages with codes or passwords cannot be re-sent — issue a new one', HttpStatus.CONFLICT);
    }
    const [copy] = await this.db
      .insert(notifications)
      .values({
        channel: row.channel, recipient: row.recipient, userId: row.userId, orderId: row.orderId, template: row.template, locale: row.locale,
        title: row.title, body: row.body, data: { ...((row.data as Record<string, unknown>) ?? {}), resentFrom: row.id }, status: 'QUEUED',
      })
      .$returningId();
    await this.attempt(copy.id, 0);
    return this.publicRow(await this.getRow(copy.id));
  }

  /** Was this template already sent for the order recently? (dedupes repeated status flips) */
  async recentlySent(orderId: string, template: TemplateName, withinMs: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.orderId, orderId), eq(notifications.template, template), gte(notifications.createdAt, new Date(Date.now() - withinMs))))
      .limit(1);
    return !!row;
  }

  private async getRow(id: string): Promise<NotificationRow> {
    const [row] = await this.db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    if (!row) throw notFound('Notification', id);
    return row;
  }

  private publicRow(r: NotificationRow) {
    const { maskedBody: _m, html: _h, ...data } = (r.data ?? {}) as Record<string, unknown>;
    void _m;
    void _h;
    const pending = r.status === 'QUEUED' && data.sensitive;
    return { ...r, body: pending ? '[hidden until sent]' : r.body, data };
  }
}
