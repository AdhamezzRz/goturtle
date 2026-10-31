import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { OrderStatus, WebhookEvent } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { brandLocations, couriers, orders, pickups, settlements, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import {
  DomainEvents, type OrderCreatedEvent, type OrderStatusChangedEvent, type PickupCompletedEvent, type SettlementPaidEvent,
} from '../../core/events';
import { config } from '../../config';
import { WebhookDispatcher } from './webhook-dispatcher.service';

/** Status → the specific event sent in addition to `order.status_changed`. */
export const STATUS_EVENTS: Partial<Record<OrderStatus, WebhookEvent>> = {
  PICKED_UP: 'order.picked_up',
  OUT_FOR_DELIVERY: 'order.out_for_delivery',
  DELIVERED: 'order.delivered',
  FAILED_ATTEMPT: 'order.failed_attempt',
  RETURNED: 'order.returned',
  CANCELLED: 'order.cancelled',
};

/** Only machine reason codes leave the platform (never free-text notes). */
const REASON_CODE = /^[A-Z][A-Z0-9_]{1,59}$/;

/**
 * Builds the public webhook payloads from domain events. The order snapshot
 * is stable and documented:
 *   { orderId, trackingNumber, brandReference, externalId, status, previousStatus, reason,
 *     paymentMethod, codAmountCents, collectCents, collectedCents, totalFeesCents, attempts,
 *     deliveredAt, returnedAt, cancelledAt, hero: { firstName } | null, trackingUrl, updatedAt }
 */
@Injectable()
export class WebhooksListener {
  private readonly log = new Logger('WebhooksListener');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  @OnEvent(DomainEvents.OrderCreated, { async: true })
  async onOrderCreated(e: OrderCreatedEvent) {
    await this.safe('order.created', async () => {
      const data = await this.orderSnapshot(e.orderId, { previousStatus: null, reason: null });
      if (data) await this.dispatcher.enqueue(e.brandId, 'order.created', { ...data, source: e.source });
    });
  }

  @OnEvent(DomainEvents.OrderStatusChanged, { async: true })
  async onStatusChanged(e: OrderStatusChangedEvent) {
    await this.safe('order.status_changed', async () => {
      const data = await this.orderSnapshot(e.orderId, { previousStatus: e.from, reason: e.reason ?? null, status: e.to });
      if (!data) return;
      const at = e.at instanceof Date ? e.at : new Date(e.at);
      await this.dispatcher.enqueue(e.brandId, 'order.status_changed', data, at);
      const specific = STATUS_EVENTS[e.to];
      if (specific) await this.dispatcher.enqueue(e.brandId, specific, data, at);
    });
  }

  @OnEvent(DomainEvents.PickupCompleted, { async: true })
  async onPickupCompleted(e: PickupCompletedEvent) {
    await this.safe('pickup.completed', async () => {
      const [row] = await this.db
        .select({ pickup: pickups, locationName: brandLocations.name })
        .from(pickups)
        .leftJoin(brandLocations, eq(brandLocations.id, pickups.locationId))
        .where(eq(pickups.id, e.pickupId))
        .limit(1);
      await this.dispatcher.enqueue(e.brandId, 'pickup.completed', {
        pickupId: e.pickupId,
        code: row?.pickup.code ?? null,
        status: row?.pickup.status ?? 'COMPLETED',
        scheduledDate: row?.pickup.scheduledDate ?? null,
        expectedCount: row?.pickup.expectedCount ?? null,
        pickedCount: e.pickedCount,
        location: row ? { id: row.pickup.locationId, name: row.locationName } : null,
        completedAt: (row?.pickup.completedAt ?? new Date()).toISOString(),
        hero: { firstName: await this.heroFirstName(e.courierId) },
      });
    });
  }

  @OnEvent(DomainEvents.SettlementPaid, { async: true })
  async onSettlementPaid(e: SettlementPaidEvent) {
    await this.safe('settlement.paid', async () => {
      const [s] = await this.db.select().from(settlements).where(eq(settlements.id, e.settlementId)).limit(1);
      await this.dispatcher.enqueue(e.brandId, 'settlement.paid', {
        settlementId: e.settlementId,
        code: s?.code ?? null,
        periodStart: s?.periodStart.toISOString() ?? null,
        periodEnd: s?.periodEnd.toISOString() ?? null,
        ordersCount: s?.ordersCount ?? null,
        codCollectedCents: s?.codCollectedCents ?? null,
        feesCents: s?.feesCents ?? null,
        adjustmentsCents: s?.adjustmentsCents ?? null,
        netPayableCents: e.netPayableCents,
        method: s?.method ?? null,
        paymentReference: s?.paymentReference ?? null,
        invoiceNumber: s?.invoiceNumber ?? null,
        paidAt: (s?.paidAt ?? new Date()).toISOString(),
      });
    });
  }

  async orderSnapshot(orderId: string, ctx: { previousStatus: OrderStatus | null; reason: string | null; status?: OrderStatus }) {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o) return null;
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      orderId: o.id,
      trackingNumber: o.trackingNumber,
      brandReference: o.brandReference,
      externalId: o.externalId,
      status: ctx.status ?? o.status,
      previousStatus: ctx.previousStatus,
      reason: ctx.reason && REASON_CODE.test(ctx.reason) ? ctx.reason : null,
      paymentMethod: o.paymentMethod,
      codAmountCents: o.codAmountCents,
      collectCents: o.collectCents,
      collectedCents: o.collectedCents,
      totalFeesCents: o.totalFeesCents,
      attempts: o.attempts,
      deliveredAt: iso(o.deliveredAt),
      returnedAt: iso(o.returnedAt),
      cancelledAt: iso(o.cancelledAt),
      hero: o.courierId ? { firstName: await this.heroFirstName(o.courierId) } : null,
      trackingUrl: `${config.appUrl}/t/${o.trackingNumber}`,
      updatedAt: o.updatedAt.toISOString(),
    };
  }

  private async heroFirstName(courierId: string | null): Promise<string | null> {
    if (!courierId) return null;
    const [r] = await this.db
      .select({ name: users.name })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(eq(couriers.id, courierId))
      .limit(1);
    return r ? r.name.split(/\s+/)[0] : null;
  }

  private async safe(what: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      this.log.error(`${what} webhook enqueue failed: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
    }
  }
}
