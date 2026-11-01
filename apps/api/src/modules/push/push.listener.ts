import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { FailureReason } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { couriers, orders, runsheets, settlements, tickets } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { DomainEvents, type OrderStatusChangedEvent, type SettlementPaidEvent } from '../../core/events';
import type { RunsheetDispatchedEvent } from '../dispatch/runsheets.service';
import type { TicketChangedEvent } from '../tickets/tickets.events';
import { FAILURE_REASON_LABELS } from '../notifications/templates';
import { PushService } from './push.service';

const LIVE_RUNSHEET = ['DISPATCHED', 'IN_PROGRESS'];

const egp = (cents: number, locale: 'ar' | 'en') =>
  `${(cents / 100).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-EG', { maximumFractionDigits: 2 })} ${locale === 'ar' ? 'ج.م' : 'EGP'}`;

/**
 * Web Push for the moments that matter:
 *   heroes  — runsheet dispatched, pickups assigned, a stop added to a live run
 *   brands  — failed delivery attempt, parcel returned, settlement paid (owners)
 *   ops     — attempt disputed by a customer, ticket SLA breached
 * Bursts (a pickup assigns many parcels at once) are coalesced into one
 * notification per hero. Listeners never throw.
 */
@Injectable()
export class PushListener implements OnModuleDestroy {
  private readonly log = new Logger('PushListener');
  private readonly pending = new Map<string, { count: number; first: string; timer: NodeJS.Timeout }>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly push: PushService,
  ) {}

  /** Milliseconds to wait for more events of the same kind before notifying. */
  get coalesceMs() {
    const v = Number(process.env.PUSH_COALESCE_MS);
    return Number.isFinite(v) && v >= 0 ? v : 2000;
  }

  onModuleDestroy() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }

  @OnEvent(DomainEvents.RunsheetDispatched, { async: true })
  async onRunsheetDispatched(e: RunsheetDispatchedEvent) {
    await this.safe('runsheet.dispatched', async () => {
      if (!this.push.enabled) return;
      const userId = await this.courierUser(e.courierId);
      if (userId) await this.push.notifyUsers([userId], 'push_runsheet_dispatched', { code: e.code, count: e.orderCount }, { url: '/hero', tag: `runsheet-${e.runsheetId}`, urgency: 'high' });
    });
  }

  @OnEvent(DomainEvents.OrderStatusChanged, { async: true })
  async onStatusChanged(e: OrderStatusChangedEvent) {
    await this.safe('order.status_changed', async () => {
      if (!this.push.enabled) return;
      if (e.to === 'PICKUP_ASSIGNED' && e.courierId) {
        const courierId = e.courierId;
        this.coalesce(`pickup:${courierId}`, e.trackingNumber, async (count) => {
          const userId = await this.courierUser(courierId);
          if (userId) await this.push.notifyUsers([userId], 'push_pickup_assigned', { count }, { url: '/hero', tag: 'pickup' });
        });
        return;
      }
      if (e.to === 'ASSIGNED' && e.courierId) {
        const [o] = await this.db.select({ rsStatus: runsheets.status }).from(orders).innerJoin(runsheets, eq(runsheets.id, orders.runsheetId)).where(eq(orders.id, e.orderId)).limit(1);
        if (!o || !LIVE_RUNSHEET.includes(o.rsStatus)) return; // a draft run is announced when dispatched
        const courierId = e.courierId;
        this.coalesce(`stop:${courierId}`, e.trackingNumber, async (count, first) => {
          const userId = await this.courierUser(courierId);
          if (userId) await this.push.notifyUsers([userId], 'push_stop_added', { count, tn: first }, { url: '/hero', tag: 'stops', urgency: 'high' });
        });
        return;
      }
      if (e.to === 'FAILED_ATTEMPT') {
        const reason = (e.reason ?? 'OTHER') as FailureReason;
        await this.push.notifyBrandOwners(e.brandId, 'push_attempt_failed', (locale) => ({ tn: e.trackingNumber, reason: (FAILURE_REASON_LABELS[reason] ?? FAILURE_REASON_LABELS.OTHER)[locale] }), {
          url: `/brand/orders/${e.orderId}`,
          tag: `order-${e.orderId}`,
        });
        return;
      }
      if (e.to === 'RETURNED') {
        await this.push.notifyBrandOwners(e.brandId, 'push_order_returned', { tn: e.trackingNumber }, { url: `/brand/orders/${e.orderId}`, tag: `order-${e.orderId}` });
      }
    });
  }

  @OnEvent(DomainEvents.SettlementPaid, { async: true })
  async onSettlementPaid(e: SettlementPaidEvent) {
    await this.safe('settlement.paid', async () => {
      if (!this.push.enabled || e.netPayableCents <= 0) return;
      const [s] = await this.db.select({ code: settlements.code }).from(settlements).where(eq(settlements.id, e.settlementId)).limit(1);
      await this.push.notifyBrandOwners(e.brandId, 'push_settlement_paid', (locale) => ({ code: s?.code ?? '', amount: egp(e.netPayableCents, locale) }), {
        url: `/brand/wallet/settlements/${e.settlementId}`,
        tag: `settlement-${e.settlementId}`,
      });
    });
  }

  @OnEvent(DomainEvents.TicketCreated, { async: true })
  async onTicketCreated(e: TicketChangedEvent) {
    await this.safe('ticket.created', async () => {
      if (!this.push.enabled) return;
      const [t] = await this.db
        .select({ category: tickets.category, tn: orders.trackingNumber })
        .from(tickets)
        .leftJoin(orders, eq(orders.id, tickets.orderId))
        .where(eq(tickets.id, e.ticketId))
        .limit(1);
      if (t?.category !== 'ATTEMPT_DISPUTE') return;
      await this.push.notifyRoles(['SUPPORT', 'OPS_MANAGER'], 'push_attempt_disputed', { code: e.code, tn: t.tn ?? '' }, { url: `/ops/tickets/${e.ticketId}`, tag: `ticket-${e.ticketId}` });
    });
  }

  @OnEvent(DomainEvents.TicketUpdated, { async: true })
  async onTicketUpdated(e: TicketChangedEvent) {
    await this.safe('ticket.updated', async () => {
      if (!this.push.enabled || e.change !== 'sla_breached') return;
      const [t] = await this.db.select({ subject: tickets.subject }).from(tickets).where(eq(tickets.id, e.ticketId)).limit(1);
      const vars = { code: e.code, subject: t?.subject ?? '' };
      const opts = { url: `/ops/tickets/${e.ticketId}`, tag: `ticket-${e.ticketId}` };
      if (e.assigneeId) await this.push.notifyUsers([e.assigneeId], 'push_ticket_sla', vars, opts);
      else await this.push.notifyRoles(['SUPPORT', 'OPS_MANAGER'], 'push_ticket_sla', vars, opts);
    });
  }

  // ------------------------------------------------------------------ helpers

  private coalesce(key: string, item: string, flush: (count: number, first: string) => Promise<void>) {
    const existing = this.pending.get(key);
    if (existing) {
      existing.count++;
      return;
    }
    const entry = {
      count: 1,
      first: item,
      timer: setTimeout(() => {
        this.pending.delete(key);
        void this.safe(`flush ${key}`, () => flush(entry.count, entry.first));
      }, this.coalesceMs),
    };
    entry.timer.unref?.();
    this.pending.set(key, entry);
  }

  private async courierUser(courierId: string): Promise<string | null> {
    const [c] = await this.db.select({ userId: couriers.userId }).from(couriers).where(eq(couriers.id, courierId)).limit(1);
    return c?.userId ?? null;
  }

  private async safe(what: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      this.log.error(`push for ${what} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
