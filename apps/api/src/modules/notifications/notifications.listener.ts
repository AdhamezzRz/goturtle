import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import { formatEgp, isStaffRole, type FailureReason, type Locale, type OtpPurpose } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { brands, couriers, orders, runsheets, settlements, tickets, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import {
  CoreEvents, DomainEvents,
  type OrderCreatedEvent, type OrderStatusChangedEvent, type OtpRequestedEvent, type SettlementPaidEvent, type UserInvitedEvent,
} from '../../core/events';
import { config } from '../../config';
import { cairoToday } from '../../db/helpers';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService, type OutboundChannel } from './notifications.service';
import { FAILURE_REASON_LABELS, PRIORITY_LABELS, SNIPPETS, interpolate, type TemplateName } from './templates';
import type { TicketChangedEvent } from '../tickets/tickets.events';

const OTP_TEMPLATES: Record<OtpPurpose, TemplateName> = {
  TRACKING: 'otp_tracking',
  LOGIN: 'otp_login',
  PASSWORD_RESET: 'otp_password_reset',
  DELIVERY: 'otp_delivery',
};

const DEDUPE_MS = 10 * 60_000;

export const trackingUrl = (tn: string) => `${config.appUrl}/t/${tn}`;

const cairoTime = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

/**
 * Turns domain events into messages. Listeners never throw: failures are
 * logged and the business flow that emitted the event is unaffected.
 */
@Injectable()
export class NotificationsListener {
  private readonly log = new Logger('NotificationsListener');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  /** OTP codes go out immediately by SMS (never queued behind other traffic). */
  @OnEvent(CoreEvents.OtpRequested, { async: true })
  async onOtp(e: OtpRequestedEvent) {
    await this.safe('otp', async () => {
      let locale: Locale = e.locale ?? 'ar';
      let tn: string | null = null;
      if (!e.locale && e.purpose === 'PASSWORD_RESET') {
        const [u] = await this.db.select({ locale: users.locale }).from(users).where(eq(users.phone, e.phone)).limit(1);
        if (u) locale = u.locale;
      }
      if (e.orderId) {
        const [o] = await this.db.select({ tn: orders.trackingNumber }).from(orders).where(eq(orders.id, e.orderId)).limit(1);
        tn = o?.tn ?? null;
      }
      await this.notifications.sendNow({
        channel: 'SMS',
        to: e.phone,
        template: OTP_TEMPLATES[e.purpose] ?? 'otp_login',
        locale,
        orderId: e.orderId ?? null,
        vars: { code: e.code, minutes: e.purpose === 'DELIVERY' ? 24 * 60 : 10, tn },
        data: { purpose: e.purpose },
      });
    });
  }

  @OnEvent(DomainEvents.OrderCreated, { async: true })
  async onOrderCreated(e: OrderCreatedEvent) {
    await this.safe('order.created', async () => {
      const prefs = await this.settings.get('notifications');
      if (!prefs.customerSmsOnCreated) return;
      await this.customerMessage(e.orderId, 'order_created', async (o) => ({ link: trackingUrl(o.trackingNumber) }));
    });
  }

  @OnEvent(DomainEvents.OrderStatusChanged, { async: true })
  async onStatusChanged(e: OrderStatusChangedEvent) {
    await this.safe('order.status_changed', async () => {
      const prefs = await this.settings.get('notifications');
      switch (e.to) {
        case 'OUT_FOR_DELIVERY':
          if (!prefs.onOutForDelivery) return;
          await this.customerMessage(e.orderId, 'out_for_delivery', async (o, locale) => ({
            hero: await this.heroFirstName(o.courierId ?? e.courierId),
            eta: await this.eta(o, locale),
            otpNote: o.deliveryOtpRequired ? SNIPPETS.otpNote[locale] : '',
            link: trackingUrl(o.trackingNumber),
          }));
          return;
        case 'DELIVERED':
          if (!prefs.onDelivered) return;
          await this.customerMessage(e.orderId, 'delivered', async (o) => ({ link: `${trackingUrl(o.trackingNumber)}?rate=1` }));
          return;
        case 'FAILED_ATTEMPT':
          if (!prefs.onFailed) return;
          await this.customerMessage(e.orderId, 'failed_attempt', async (o, locale) => {
            // Only the coded reason is shown — hero/ops free-text notes never reach the customer.
            const reason = (e.reason && e.reason in FAILURE_REASON_LABELS ? e.reason : 'OTHER') as FailureReason;
            return { reason: FAILURE_REASON_LABELS[reason][locale], link: trackingUrl(o.trackingNumber) };
          }, { dedupe: false });
          return;
        case 'RETURNED':
          if (!prefs.onReturned) return;
          await this.customerMessage(e.orderId, 'returned', async () => ({}));
          return;
        default:
          return;
      }
    });
  }

  @OnEvent(CoreEvents.UserInvited, { async: true })
  async onUserInvited(e: UserInvitedEvent) {
    await this.safe('user.invited', async () => {
      const [u] = await this.db.select({ locale: users.locale, role: users.role }).from(users).where(eq(users.id, e.userId)).limit(1);
      const locale = u?.locale ?? 'ar';
      const portal = u && isStaffRole(u.role) ? 'ops' : u?.role === 'COURIER' ? 'hero' : 'brand';
      const vars = { name: e.name.split(' ')[0], password: e.temporaryPassword, phone: e.phone, link: `${config.appUrl}/login?portal=${portal}` };
      await this.notifications.sendNow({ channel: 'SMS', to: e.phone, template: 'user_invited', locale, userId: e.userId, vars });
      if (e.email) await this.notifications.queue({ channel: 'EMAIL', to: e.email, template: 'user_invited', locale, userId: e.userId, vars });
    });
  }

  @OnEvent(DomainEvents.SettlementPaid, { async: true })
  async onSettlementPaid(e: SettlementPaidEvent) {
    await this.safe('settlement.paid', async () => {
      const [s] = await this.db.select().from(settlements).where(eq(settlements.id, e.settlementId)).limit(1);
      const period = s ? `${cairoToday(s.periodStart)} → ${cairoToday(new Date(s.periodEnd.getTime() - 1))}` : '';
      await this.notifications.notifyBrandOwners(
        e.brandId,
        'settlement_paid',
        {
          code: s?.code ?? '',
          amount: formatEgp(e.netPayableCents, 'ar'),
          period,
          reference: s?.paymentReference ?? '-',
          link: `${config.appUrl}/brand/finance`,
        },
        { email: true, data: { settlementId: e.settlementId, link: '/brand/finance' } },
      );
    });
  }

  @OnEvent(DomainEvents.TicketCreated, { async: true })
  async onTicketCreated(e: TicketChangedEvent) {
    await this.safe('ticket.created', async () => {
      const t = await this.ticket(e.ticketId);
      if (!t) return;
      const vars = { code: t.code, subject: t.subject, priority: PRIORITY_LABELS[t.priority].en };
      const data = { ticketId: t.id, link: `/ops/tickets/${t.id}` };
      if (t.assigneeId) await this.notifications.inApp([t.assigneeId], 'ticket_assigned', vars, { data });
      else await this.notifications.notifyRoles(['SUPPORT', 'OPS_MANAGER'], 'ticket_created', vars, { data, exceptUserId: e.actorId });
    });
  }

  @OnEvent(DomainEvents.TicketUpdated, { async: true })
  async onTicketUpdated(e: TicketChangedEvent) {
    if (e.change !== 'reply' && e.change !== 'assigned') return;
    await this.safe('ticket.updated', async () => {
      const t = await this.ticket(e.ticketId);
      if (!t) return;
      const staffData = { ticketId: t.id, link: `/ops/tickets/${t.id}` };
      const vars = { code: t.code, subject: t.subject, priority: PRIORITY_LABELS[t.priority].en };

      if (e.change === 'assigned') {
        if (t.assigneeId && t.assigneeId !== e.actorId) await this.notifications.inApp([t.assigneeId], 'ticket_assigned', vars, { data: staffData });
        return;
      }
      if (e.isInternal) return; // internal notes never notify the requester
      if (e.actorType === 'STAFF') {
        // Staff answered: tell the requester.
        if (t.brandId && (t.openedByType === 'BRAND' || t.openedByType === 'API')) {
          const [opener] = t.openedById
            ? await this.db.select({ id: users.id, brandId: users.brandId }).from(users).where(eq(users.id, t.openedById)).limit(1)
            : [];
          const data = { ticketId: t.id, link: `/brand/support/${t.id}` };
          if (opener && opener.brandId === t.brandId) await this.notifications.inApp([opener.id], 'ticket_reply', { code: t.code, link: '' }, { data });
          else await this.notifications.notifyBrandOwners(t.brandId, 'ticket_reply', { code: t.code, link: '' }, { data });
        } else if (t.openedByType === 'CUSTOMER' && t.contactPhone) {
          const [o] = t.orderId ? await this.db.select({ tn: orders.trackingNumber }).from(orders).where(eq(orders.id, t.orderId)).limit(1) : [];
          await this.notifications.queue({
            channel: 'SMS', to: t.contactPhone, template: 'ticket_reply', locale: 'ar', orderId: t.orderId,
            vars: { code: t.code, link: o ? trackingUrl(o.tn) : `${config.appUrl}/support` }, data: { ticketId: t.id },
          });
        }
        return;
      }
      // Requester replied: tell the assignee (or the support team when unassigned).
      if (t.assigneeId) await this.notifications.inApp([t.assigneeId], 'ticket_reply', { code: t.code, link: '' }, { data: staffData });
      else await this.notifications.notifyRoles(['SUPPORT'], 'ticket_reply', { code: t.code, link: '' }, { data: staffData });
    });
  }

  // ------------------------------------------------------------------ helpers

  private async customerMessage(
    orderId: string,
    template: TemplateName,
    extra: (o: typeof orders.$inferSelect, locale: Locale) => Promise<Record<string, string | number | null>>,
    opts: { dedupe?: boolean } = {},
  ) {
    const [row] = await this.db
      .select({ order: orders, brandName: brands.name })
      .from(orders)
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row) return;
    if (opts.dedupe !== false && (await this.notifications.recentlySent(orderId, template, DEDUPE_MS))) return;
    const prefs = await this.settings.get('notifications');
    const channel: OutboundChannel = prefs.channel === 'WHATSAPP' ? 'WHATSAPP' : 'SMS';
    const locale: Locale = 'ar';
    await this.notifications.queue({
      channel,
      to: row.order.recipientPhone,
      template,
      locale,
      orderId,
      vars: { brand: row.brandName, tn: row.order.trackingNumber, ...(await extra(row.order, locale)) },
      data: { trackingNumber: row.order.trackingNumber, status: row.order.status },
    });
  }

  private async heroFirstName(courierId: string | null | undefined): Promise<string> {
    if (!courierId) return '';
    const [r] = await this.db
      .select({ name: users.name })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(eq(couriers.id, courierId))
      .limit(1);
    return r?.name.split(/\s+/)[0] ?? '';
  }

  /** ETA window from the runsheet route when available, otherwise "today". */
  private async eta(o: typeof orders.$inferSelect, locale: Locale): Promise<string> {
    if (o.runsheetId) {
      const [rs] = await this.db
        .select({ route: runsheets.route, startedAt: runsheets.startedAt, dispatchedAt: runsheets.dispatchedAt })
        .from(runsheets)
        .where(and(eq(runsheets.id, o.runsheetId)))
        .limit(1);
      const stop = rs?.route?.find((s) => s.orderId === o.id);
      if (rs && stop && Number.isFinite(stop.etaMinutes)) {
        const base = (rs.startedAt ?? rs.dispatchedAt ?? new Date()).getTime();
        const at = base + stop.etaMinutes * 60_000;
        if (at > Date.now() - 30 * 60_000) {
          return interpolate(SNIPPETS.between[locale], { from: cairoTime(new Date(at - 30 * 60_000)), to: cairoTime(new Date(at + 60 * 60_000)) });
        }
      }
    }
    return SNIPPETS.today[locale];
  }

  private async ticket(id: string) {
    const [t] = await this.db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    return t ?? null;
  }

  private async safe(what: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      this.log.error(`${what} notification failed: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
    }
  }
}
