import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import {
  actorCanSetStatus, applyBp, canTransition, DomainEvents, ORDER_TRANSITIONS, type FailureReason, type OrderStatus,
} from '@goturtle/shared';
import type { Db, DbOrTx, Tx } from '../../db/client';
import { couriers, deliveryAttempts, orderEvents, orders, runsheets } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { OtpService } from '../../core/otp.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { CoreEvents, type OrderStatusChangedEvent, type OtpRequestedEvent } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import { SYSTEM_ACTOR, type ActorContext } from '../../common/actor';
import type { RequestMetaInfo } from '../../common/decorators';
import { PricingService } from '../pricing/pricing.service';
import { CustomersService } from '../customers/customers.service';
import { OrderFactoryService, type OrderInsert, type OrderRow } from './order-factory.service';
import { auditPrincipal, endOfCairoDay, PostCommit } from './ops-kit';

export interface TransitionOptions {
  /** Machine reason code stored on the event (FailureReason, MAX_ATTEMPTS, CUSTOMER_REQUEST …). */
  reason?: string | null;
  note?: string | null;
  /** Show on the customer tracking timeline (default depends on the status). */
  isPublic?: boolean;
  /** Where the actor was (hero GPS / hub). */
  lat?: number | null;
  lng?: number | null;
  hubId?: string | null;
  /** Hero to hold the order (PICKUP_ASSIGNED, PICKED_UP, ASSIGNED, OUT_FOR_DELIVERY, RETURN_OUT). */
  courierId?: string | null;
  /** Runsheet for ASSIGNED / OUT_FOR_DELIVERY (null detaches). */
  runsheetId?: string | null;
  /** RECEIVED_AT_HUB: also detach from the runsheet. */
  clearRunsheet?: boolean;
  pickupId?: string | null;
  /** CREATED (pickup cancelled / not collected): detach from the pickup. */
  clearPickup?: boolean;
  /** RESCHEDULED: the new delivery day. */
  scheduledDate?: string | null;
  delivery?: { collectedCents?: number; podPhotoUrl?: string | null; signatureUrl?: string | null; receivedBy?: string | null };
  failure?: { reason: FailureReason; photoUrl?: string | null; rescheduleDate?: string | null };
  metadata?: Record<string, unknown> | null;
  meta?: RequestMetaInfo | null;
  /** Override the clock (demo seed backfill). */
  at?: Date;
}

/** Statuses that are internal plumbing and hidden from the customer timeline by default. */
const PRIVATE_STATUSES: readonly OrderStatus[] = ['PICKUP_ASSIGNED', 'ASSIGNED', 'ON_HOLD', 'LOST', 'DAMAGED'];
/** Statuses that keep a runsheet stop open. */
const OPEN_STOP: readonly OrderStatus[] = ['ASSIGNED', 'OUT_FOR_DELIVERY'];
/** Statuses where the hero (not the hub) is responsible for the parcel. */
const HERO_HELD: readonly OrderStatus[] = ['PICKUP_ASSIGNED', 'PICKED_UP', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_OUT'];

/**
 * The order state machine with all its side effects. This is the ONLY place
 * that changes `orders.status`. Each transition runs in a transaction with the
 * order row locked (SELECT … FOR UPDATE), writes an OrderEvent and an audit
 * entry, posts money through PostingsService and emits
 * `order.status_changed` after commit.
 *
 * Other modules compose several transitions atomically with:
 *   await workflow.run(async (tx, fx) => { await workflow.apply(tx, fx, id, 'OUT_FOR_DELIVERY', actor, {...}); … });
 */
@Injectable()
export class OrderWorkflowService {
  private readonly log = new Logger('OrderWorkflow');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    private readonly postings: PostingsService,
    private readonly pricing: PricingService,
    private readonly customers: CustomersService,
    private readonly factory: OrderFactoryService,
  ) {}

  /** Runs `fn` in a transaction and emits the collected events after commit. */
  async run<T>(fn: (tx: Tx, fx: PostCommit) => Promise<T>): Promise<T> {
    const fx = new PostCommit();
    const result = await this.db.transaction((tx) => fn(tx, fx));
    fx.flush(this.events, this.log);
    return result;
  }

  /** One transition in its own transaction. Returns the updated order. */
  transition(orderId: string, to: OrderStatus, actor: ActorContext, opts: TransitionOptions = {}): Promise<OrderRow> {
    return this.run((tx, fx) => this.apply(tx, fx, orderId, to, actor, opts));
  }

  async lock(tx: DbOrTx, orderId: string): Promise<OrderRow> {
    const [row] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update').limit(1);
    if (!row) throw notFound('Order', orderId);
    return row;
  }

  /** Validates and applies a transition inside the caller's transaction. */
  async apply(tx: DbOrTx, fx: PostCommit, orderId: string, to: OrderStatus, actor: ActorContext, opts: TransitionOptions = {}): Promise<OrderRow> {
    const order = await this.lock(tx, orderId);
    const from = order.status;
    this.assertAllowed(order, to, actor);
    const now = opts.at ?? new Date();

    const patch: Partial<OrderInsert> = { status: to };
    const requireCourier = (candidate: string | null | undefined): string => {
      if (!candidate) throw new DomainError('COURIER_REQUIRED', `A hero is required to move the order to ${to}`, HttpStatus.UNPROCESSABLE_ENTITY);
      return candidate;
    };

    switch (to) {
      case 'CREATED':
        patch.courierId = null;
        if (opts.clearPickup) patch.pickupId = null;
        break;
      case 'PICKUP_ASSIGNED':
        patch.courierId = requireCourier(opts.courierId ?? order.courierId);
        if (opts.pickupId !== undefined) patch.pickupId = opts.pickupId;
        break;
      case 'PICKED_UP':
        patch.courierId = requireCourier(opts.courierId ?? actor.courierId ?? order.courierId);
        patch.pickedUpAt = now;
        if (opts.pickupId !== undefined) patch.pickupId = opts.pickupId;
        break;
      case 'RECEIVED_AT_HUB':
        patch.hubId = opts.hubId ?? order.hubId;
        patch.courierId = null;
        if (opts.clearRunsheet) Object.assign(patch, { runsheetId: null, routeSequence: null });
        break;
      case 'ASSIGNED': {
        patch.courierId = requireCourier(opts.courierId ?? order.courierId);
        if (opts.runsheetId !== undefined && opts.runsheetId !== order.runsheetId) Object.assign(patch, { runsheetId: opts.runsheetId, routeSequence: null });
        break;
      }
      case 'OUT_FOR_DELIVERY':
        patch.courierId = requireCourier(opts.courierId ?? order.courierId ?? actor.courierId);
        patch.outForDeliveryAt = now;
        if (opts.runsheetId !== undefined) patch.runsheetId = opts.runsheetId;
        break;
      case 'DELIVERED': {
        const collected = opts.delivery?.collectedCents ?? order.collectCents;
        if (!Number.isInteger(collected) || collected < 0) throw new DomainError('INVALID_AMOUNT', 'collectedCents must be a non-negative integer', HttpStatus.BAD_REQUEST);
        requireCourier(order.courierId);
        Object.assign(patch, {
          collectedCents: collected,
          deliveredAt: now,
          podPhotoUrl: opts.delivery?.podPhotoUrl ?? order.podPhotoUrl,
          podSignatureUrl: opts.delivery?.signatureUrl ?? order.podSignatureUrl,
          podReceivedBy: opts.delivery?.receivedBy ?? order.podReceivedBy,
        });
        break;
      }
      case 'FAILED_ATTEMPT':
        if (!opts.failure?.reason) throw new DomainError('FAILURE_REASON_REQUIRED', 'A failure reason is required', HttpStatus.BAD_REQUEST);
        requireCourier(order.courierId);
        patch.attempts = order.attempts + 1;
        break;
      case 'RESCHEDULED': {
        const day = opts.scheduledDate ?? order.scheduledDate;
        if (day) Object.assign(patch, { scheduledDate: day, promisedBy: endOfCairoDay(day) });
        break;
      }
      case 'RETURN_OUT':
        patch.courierId = requireCourier(opts.courierId ?? actor.courierId ?? order.courierId);
        break;
      case 'RETURNED':
        patch.returnedAt = now;
        break;
      case 'CANCELLED':
        patch.cancelledAt = now;
        patch.courierId = null;
        break;
      default:
        break;
    }

    await tx.update(orders).set(patch).where(eq(orders.id, orderId));
    let updated: OrderRow = { ...order, ...(patch as Partial<OrderRow>) };
    const eventMeta: Record<string, unknown> = { ...(opts.metadata ?? {}) };

    // ---------------------------------------------------------------- side effects
    if (to === 'OUT_FOR_DELIVERY' && order.deliveryOtpRequired) {
      const issued = await this.otp.issue(order.recipientPhone, 'DELIVERY', { orderId, tx, send: false });
      fx.emit(CoreEvents.OtpRequested, { phone: order.recipientPhone, code: issued.code, purpose: 'DELIVERY', orderId, locale: 'ar' } satisfies OtpRequestedEvent);
      eventMeta.otpIssued = true;
    }

    if (to === 'DELIVERED') {
      const courier = updated.courierId ? await this.courier(tx, updated.courierId) : null;
      await this.postings.orderDelivered(tx, updated, courier, actor.actorId);
      await this.customers.recordDelivered(tx, order.customerId);
      await tx.insert(deliveryAttempts).values({
        orderId, courierId: requireCourier(updated.courierId), attemptNo: order.attempts + 1, success: true,
        note: opts.note ?? null, lat: opts.lat ?? null, lng: opts.lng ?? null, photoUrl: opts.delivery?.podPhotoUrl ?? null, createdAt: now,
      });
      if (updated.runsheetId && updated.collectedCents > 0) {
        await tx.update(runsheets).set({ collectedCents: sql`${runsheets.collectedCents} + ${updated.collectedCents}` }).where(eq(runsheets.id, updated.runsheetId));
      }
      eventMeta.collectedCents = updated.collectedCents;
    }

    if (to === 'FAILED_ATTEMPT') {
      const courier = await this.courier(tx, updated.courierId!);
      const reason = opts.failure!.reason;
      await tx.insert(deliveryAttempts).values({
        orderId, courierId: courier.id, attemptNo: updated.attempts, success: false, failureReason: reason,
        note: opts.note ?? null, lat: opts.lat ?? null, lng: opts.lng ?? null, photoUrl: opts.failure?.photoUrl ?? null, createdAt: now,
      });
      await this.postings.failedAttemptEarning(tx, updated, courier, updated.attempts);
      if (reason === 'CUSTOMER_REFUSED') await this.customers.recordRefused(tx, order.customerId);
      eventMeta.attemptNo = updated.attempts;
    }

    if (to === 'RETURNED') {
      const { card } = await this.pricing.rateCardForBrand(order.brandId, tx);
      const feeCents = applyBp(order.shippingFeeCents, card.returnFeeBp);
      const vatCents = applyBp(feeCents, card.vatBp);
      await this.postings.orderReturned(tx, updated, feeCents, vatCents, actor.actorId);
      const metadata = { ...(order.metadata ?? {}), returnFee: { feeCents, vatCents, totalCents: feeCents + vatCents, codFeeWaived: true } };
      await tx.update(orders).set({ metadata }).where(eq(orders.id, orderId));
      updated = { ...updated, metadata };
      eventMeta.returnFeeCents = feeCents + vatCents;
    }

    // ---------------------------------------------------------------- event, audit, runsheet
    await tx.insert(orderEvents).values({
      orderId,
      status: to,
      fromStatus: from,
      reason: (opts.failure?.reason ?? opts.reason ?? null)?.slice(0, 60) ?? null,
      note: opts.note?.slice(0, 1000) ?? null,
      actorId: actor.actorId,
      actorType: actor.actorType,
      actorName: actor.name,
      hubId: opts.hubId ?? (to === 'RECEIVED_AT_HUB' ? updated.hubId : null),
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
      isPublic: opts.isPublic ?? !PRIVATE_STATUSES.includes(to),
      metadata: Object.keys(eventMeta).length ? eventMeta : null,
      createdAt: now,
    });
    await this.audit.record(
      auditPrincipal(actor),
      { action: 'order.status', entity: 'Order', entityId: orderId, before: { status: from }, after: { status: to, reason: opts.failure?.reason ?? opts.reason ?? null } },
      opts.meta ?? null,
      tx,
    );
    for (const rsId of new Set([order.runsheetId, updated.runsheetId].filter((x): x is string => !!x))) {
      await this.syncRunsheet(tx, rsId, to, now);
    }
    fx.emit(DomainEvents.OrderStatusChanged, {
      orderId,
      trackingNumber: order.trackingNumber,
      brandId: order.brandId,
      courierId: updated.courierId ?? null,
      from,
      to,
      reason: opts.failure?.reason ?? opts.reason ?? null,
      note: opts.note ?? null,
      actorType: actor.actorType,
      actorId: actor.actorId,
      at: now,
    } satisfies OrderStatusChangedEvent);

    // ---------------------------------------------------------------- automatic follow-ups
    if (to === 'FAILED_ATTEMPT') {
      const refused = opts.failure!.reason === 'CUSTOMER_REFUSED';
      if (refused || updated.attempts >= updated.maxAttempts) {
        return this.apply(tx, fx, orderId, 'RETURN_PENDING', SYSTEM_ACTOR, {
          reason: refused ? 'CUSTOMER_REFUSED' : 'MAX_ATTEMPTS',
          note: refused ? 'Customer refused the parcel — returning to the brand' : `${updated.attempts} delivery attempts failed — returning to the brand`,
          at: now,
        });
      }
      if (opts.failure?.rescheduleDate) {
        return this.apply(tx, fx, orderId, 'RESCHEDULED', actor, {
          reason: 'CUSTOMER_RESCHEDULED',
          scheduledDate: opts.failure.rescheduleDate,
          note: `Rescheduled to ${opts.failure.rescheduleDate}`,
          at: now,
        });
      }
    }
    if (to === 'DELIVERED' && order.type === 'EXCHANGE') {
      const leg = await this.factory.insertReturnLeg(tx, fx, updated, actor);
      await this.apply(tx, fx, leg.id, 'PICKED_UP', actor, {
        courierId: updated.courierId,
        note: `Collected from the customer during exchange ${order.trackingNumber}`,
        isPublic: false,
        at: now,
      });
    }
    return updated;
  }

  /** Validation shared by apply() and pre-checks in other services. */
  assertAllowed(order: Pick<OrderRow, 'status' | 'brandId' | 'courierId'>, to: OrderStatus, actor: ActorContext) {
    const from = order.status;
    if (!canTransition(from, to)) {
      throw new DomainError('INVALID_TRANSITION', `Cannot move an order from ${from} to ${to}`, HttpStatus.CONFLICT, { from, to, allowed: ORDER_TRANSITIONS[from] });
    }
    if (!actorCanSetStatus(actor.actorType, to)) {
      throw new DomainError('TRANSITION_NOT_ALLOWED', `${actor.actorType.toLowerCase()} accounts cannot set ${to}`, HttpStatus.FORBIDDEN, { from, to, actorType: actor.actorType });
    }
    if ((actor.actorType === 'BRAND' || actor.actorType === 'API' || actor.actorType === 'INTEGRATION') && actor.brandId && actor.brandId !== order.brandId) {
      throw notFound('Order');
    }
    if (actor.actorType === 'COURIER') {
      if (!actor.courierId) throw new DomainError('NOT_YOUR_ORDER', 'Hero account required', HttpStatus.FORBIDDEN);
      if (order.courierId && order.courierId !== actor.courierId) throw new DomainError('NOT_YOUR_ORDER', 'This order is assigned to another hero', HttpStatus.FORBIDDEN);
      if (!order.courierId && to !== 'PICKED_UP') throw new DomainError('NOT_YOUR_ORDER', 'This order is not assigned to you', HttpStatus.FORBIDDEN);
    }
  }

  /**
   * A timeline entry that does not change the status (address edits,
   * custody notes, reassignments …).
   */
  async addNote(
    tx: DbOrTx,
    order: Pick<OrderRow, 'id' | 'status'>,
    actor: ActorContext,
    entry: { reason: string; note?: string | null; isPublic?: boolean; hubId?: string | null; lat?: number | null; lng?: number | null; metadata?: Record<string, unknown> | null; at?: Date },
  ) {
    await tx.insert(orderEvents).values({
      orderId: order.id,
      status: order.status,
      fromStatus: order.status,
      reason: entry.reason.slice(0, 60),
      note: entry.note?.slice(0, 1000) ?? null,
      actorId: actor.actorId,
      actorType: actor.actorType,
      actorName: actor.name,
      hubId: entry.hubId ?? null,
      lat: entry.lat ?? null,
      lng: entry.lng ?? null,
      isPublic: entry.isPublic ?? false,
      metadata: entry.metadata ?? null,
      createdAt: entry.at ?? new Date(),
    });
  }

  /** Hands an order to another hero without a status change (pickup reassignment, runsheet move). */
  async reassignCourier(tx: DbOrTx, orderId: string, courierId: string | null, actor: ActorContext, note?: string) {
    const order = await this.lock(tx, orderId);
    if (order.courierId === courierId) return order;
    if (!HERO_HELD.includes(order.status)) {
      throw new DomainError('INVALID_TRANSITION', `Cannot reassign an order in ${order.status}`, HttpStatus.CONFLICT, { from: order.status, to: order.status });
    }
    await tx.update(orders).set({ courierId }).where(eq(orders.id, orderId));
    await this.addNote(tx, order, actor, { reason: 'COURIER_REASSIGNED', note: note ?? null, metadata: { fromCourierId: order.courierId, toCourierId: courierId } });
    await this.audit.record(auditPrincipal(actor), { action: 'order.reassign', entity: 'Order', entityId: orderId, before: { courierId: order.courierId }, after: { courierId } }, null, tx);
    return { ...order, courierId };
  }

  private async courier(tx: DbOrTx, courierId: string) {
    const [c] = await tx.select().from(couriers).where(eq(couriers.id, courierId)).limit(1);
    if (!c) throw notFound('Hero', courierId);
    return c;
  }

  /** Keeps the runsheet status in step with its stops. */
  private async syncRunsheet(tx: DbOrTx, runsheetId: string, to: OrderStatus, now: Date) {
    const [rs] = await tx.select({ id: runsheets.id, status: runsheets.status }).from(runsheets).where(eq(runsheets.id, runsheetId)).for('update').limit(1);
    if (!rs) return;
    if (to === 'OUT_FOR_DELIVERY' && rs.status === 'COMPLETED') {
      await tx.update(runsheets).set({ status: 'IN_PROGRESS', completedAt: null }).where(eq(runsheets.id, runsheetId));
      return;
    }
    if ((rs.status === 'DISPATCHED' || rs.status === 'IN_PROGRESS') && !OPEN_STOP.includes(to)) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(orders)
        .where(and(eq(orders.runsheetId, runsheetId), inArray(orders.status, [...OPEN_STOP])));
      if (Number(n) === 0) await tx.update(runsheets).set({ status: 'COMPLETED', completedAt: now }).where(eq(runsheets.id, runsheetId));
    }
  }
}
