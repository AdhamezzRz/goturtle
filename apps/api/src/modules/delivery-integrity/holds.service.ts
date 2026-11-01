import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq, or } from 'drizzle-orm';
import { DomainEvents, maskPhone, type OrderStatus } from '@goturtle/shared';
import type { Db, DbOrTx, Tx } from '../../db/client';
import { customers, orders, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import type { OrderCreatedEvent } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import { SYSTEM_ACTOR, actorFromPrincipal, type ActorContext } from '../../common/actor';
import { brandScope, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { OrderWorkflowService, type TransitionContext } from '../orders/order-workflow.service';
import type { OrderRow } from '../orders/order-factory.service';
import { auditPrincipal, type PostCommit } from '../orders/ops-kit';
import { SettingsService } from '../settings/settings.service';
import type { IntegritySettings } from '../settings/settings.registry';
import { NotificationsService } from '../notifications/notifications.service';
import { HoldReason, INTEGRITY_HOLD_REASONS } from './integrity.util';

export interface IntegrityMeta {
  /** Status the order was in when it was put ON_HOLD. */
  holdFrom?: OrderStatus;
  heldAt?: string;
  /** A manager allowed dispatch despite the integrity rules. */
  override?: { byUserId: string | null; byName: string; at: string; reason: string };
}

export const integrityMetaOf = (metadata: unknown): IntegrityMeta => {
  const m = (metadata ?? {}) as { integrity?: IntegrityMeta };
  return m.integrity && typeof m.integrity === 'object' ? m.integrity : {};
};

export interface DispatchBlocker {
  code: 'CONFIRMATION_REQUIRED';
  message: string;
  details: { holdReason: string | null; confirmationStatus: string; riskScore: number; threshold: number };
}

const OVERRIDE_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER'];
const PREPAY_SWEEP_BATCH = 100;

/**
 * Integrity holds: the dispatch guard (no risky unconfirmed parcel leaves
 * the hub), the holdReason bookkeeping for every ON_HOLD transition, the
 * prepayment rule on new orders, and staff release / cancel / override.
 */
@Injectable()
export class HoldsService implements OnModuleInit {
  private readonly log = new Logger('IntegrityHolds');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly workflow: OrderWorkflowService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.workflow.registerGuard('integrity.dispatch', (ctx) => this.dispatchGuard(ctx));
    this.workflow.registerEffect('integrity.hold-reason', (ctx) => this.holdReasonEffect(ctx));
  }

  config(): Promise<IntegritySettings> {
    return this.settings.get('integrity');
  }

  // ------------------------------------------------------------------ dispatch guard

  /** Why this order may not be dispatched right now (null = it may). */
  blockerFor(
    o: Pick<OrderRow, 'status' | 'holdReason' | 'confirmationStatus' | 'riskScore' | 'metadata' | 'paymentMethod' | 'codAmountCents'>,
    s: IntegritySettings,
    customerRequiresPrepayment = false,
  ): DispatchBlocker | null {
    if (integrityMetaOf(o.metadata).override) return null;
    const details = { holdReason: o.holdReason ?? null, confirmationStatus: o.confirmationStatus, riskScore: o.riskScore, threshold: s.holdUnconfirmedAboveRisk };
    if (o.status === 'ON_HOLD' && o.holdReason && INTEGRITY_HOLD_REASONS.includes(o.holdReason)) {
      const message = o.holdReason === HoldReason.PREPAY_REQUIRED
        ? 'This order is held until the recipient pays online or the brand switches it to prepaid'
        : 'This order is held by the delivery-integrity rules until the customer confirms';
      return { code: 'CONFIRMATION_REQUIRED', message, details };
    }
    if (o.paymentMethod === 'COD' && o.codAmountCents > 0 && (customerRequiresPrepayment || o.riskScore >= s.prepayAboveRisk)) {
      // A prepay-held parcel scanned into a hub is still not allowed out on COD.
      return { code: 'CONFIRMATION_REQUIRED', message: 'This recipient must pay online first — send a payment link or switch the order to prepaid', details: { ...details, holdReason: HoldReason.PREPAY_REQUIRED } };
    }
    if (o.confirmationStatus === 'DECLINED') {
      return { code: 'CONFIRMATION_REQUIRED', message: 'The customer declined this delivery — return it to the brand', details };
    }
    if (s.confirmationEnabled && (o.confirmationStatus === 'PENDING' || o.confirmationStatus === 'NO_RESPONSE') && o.riskScore >= s.holdUnconfirmedAboveRisk) {
      return { code: 'CONFIRMATION_REQUIRED', message: 'High-risk order: the customer has not confirmed the delivery yet', details };
    }
    return null;
  }

  private async dispatchGuard(ctx: TransitionContext) {
    if (ctx.to !== 'ASSIGNED' && ctx.to !== 'OUT_FOR_DELIVERY') return;
    // Re-dispatching a stop already on a runsheet (ASSIGNED → OUT_FOR_DELIVERY) was checked when it was assigned.
    if (ctx.to === 'OUT_FOR_DELIVERY' && ctx.order.status === 'ASSIGNED' && ctx.order.confirmationStatus !== 'DECLINED') return;
    const [c] = await ctx.tx.select({ requirePrepayment: customers.requirePrepayment }).from(customers).where(eq(customers.id, ctx.order.customerId)).limit(1);
    const blocker = this.blockerFor(ctx.order, await this.config(), !!c?.requirePrepayment);
    if (!blocker) return;
    const ext = ctx.opts.extensions ?? {};
    if (ext.integrityOverride === true) {
      await this.assertCanOverride(ctx.tx, ctx.actor);
      const reason = String(ext.integrityOverrideReason ?? ctx.opts.note ?? 'Dispatch override').slice(0, 300);
      await this.recordOverride(ctx.tx, ctx.order, ctx.actor, reason, blocker, ctx.opts.meta ?? null);
      return;
    }
    throw new DomainError(blocker.code, blocker.message, HttpStatus.CONFLICT, { ...blocker.details, orderId: ctx.order.id, trackingNumber: ctx.order.trackingNumber });
  }

  async assertCanOverride(db: DbOrTx, actor: ActorContext) {
    if (actor.actorType === 'STAFF' && actor.actorId) {
      const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, actor.actorId)).limit(1);
      if (u && OVERRIDE_ROLES.includes(u.role)) return;
    }
    throw new DomainError('OVERRIDE_NOT_ALLOWED', 'Only an operations manager can override the delivery-integrity rules', HttpStatus.FORBIDDEN);
  }

  private async recordOverride(tx: DbOrTx, order: OrderRow, actor: ActorContext, reason: string, blocker: DispatchBlocker | null, meta: RequestMetaInfo | null) {
    const override = { byUserId: actor.actorId, byName: actor.name, at: new Date().toISOString(), reason };
    await this.patchMeta(tx, order.id, { override });
    await this.workflow.addNote(tx, order, actor, { reason: 'INTEGRITY_OVERRIDE', note: `Integrity rules overridden: ${reason}`, metadata: { blocker: blocker?.details ?? null } });
    await this.audit.record(auditPrincipal(actor), { action: 'integrity.override', entity: 'Order', entityId: order.id, before: blocker?.details ?? null, after: { reason } }, meta, tx);
  }

  /** Merges keys into orders.metadata.integrity (re-read inside the transaction). */
  async patchMeta(tx: DbOrTx, orderId: string, patch: Partial<IntegrityMeta>) {
    const [row] = await tx.select({ metadata: orders.metadata }).from(orders).where(eq(orders.id, orderId)).limit(1);
    const metadata = { ...(row?.metadata ?? {}), integrity: { ...integrityMetaOf(row?.metadata), ...patch } };
    await tx.update(orders).set({ metadata }).where(eq(orders.id, orderId));
  }

  // ------------------------------------------------------------------ hold reason bookkeeping

  private async holdReasonEffect(ctx: TransitionContext & { updated: OrderRow }) {
    if (ctx.to === 'ON_HOLD') {
      const ext = ctx.opts.extensions ?? {};
      const reason = (typeof ext.holdReason === 'string' && ext.holdReason) || ctx.opts.reason || 'MANUAL';
      await ctx.tx.update(orders).set({ holdReason: reason.slice(0, 60) }).where(eq(orders.id, ctx.order.id));
      await this.patchMeta(ctx.tx, ctx.order.id, { holdFrom: ctx.order.status, heldAt: (ctx.opts.at ?? new Date()).toISOString() });
    } else if (ctx.order.status === 'ON_HOLD' && ctx.order.holdReason) {
      await ctx.tx.update(orders).set({ holdReason: null }).where(eq(orders.id, ctx.order.id));
      if (INTEGRITY_HOLD_REASONS.includes(ctx.order.holdReason) && ctx.opts.extensions?.integrityRelease !== true) {
        // Left the hold some other way (hub scan, manual status change): keep it traceable.
        await this.workflow.addNote(ctx.tx, ctx.updated, ctx.actor, { reason: 'INTEGRITY_HOLD_CLEARED', note: `${ctx.order.holdReason} hold cleared by moving the order to ${ctx.to}`, metadata: { holdReason: ctx.order.holdReason } });
      }
    }
  }

  /** Puts an order ON_HOLD for an integrity reason inside the caller's transaction. */
  hold(tx: Tx, fx: PostCommit, orderId: string, reason: HoldReason, actor: ActorContext, note: string) {
    return this.workflow.apply(tx, fx, orderId, 'ON_HOLD', actor, { reason, note, isPublic: false, extensions: { holdReason: reason } });
  }

  /** Where a released order goes back to: the hub if it was already collected, otherwise the pickup queue. */
  releaseTarget(o: Pick<OrderRow, 'metadata' | 'pickedUpAt'>): OrderStatus {
    const from = integrityMetaOf(o.metadata).holdFrom;
    if (from === 'CREATED' || from === 'PICKUP_ASSIGNED') return 'CREATED';
    if (from) return 'RECEIVED_AT_HUB';
    return o.pickedUpAt ? 'RECEIVED_AT_HUB' : 'CREATED';
  }

  /** Releases an ON_HOLD order inside the caller's transaction (no-op when it is not held). */
  async releaseInTx(tx: Tx, fx: PostCommit, orderId: string, actor: ActorContext, note: string, extra: { reason?: string; meta?: RequestMetaInfo | null } = {}) {
    const o = await this.workflow.lock(tx, orderId);
    if (o.status !== 'ON_HOLD') return o;
    return this.workflow.apply(tx, fx, orderId, this.releaseTarget(o), actor, {
      reason: extra.reason ?? 'HOLD_RELEASED', note, isPublic: false, meta: extra.meta ?? null, extensions: { integrityRelease: true },
    });
  }

  // ------------------------------------------------------------------ prepayment rule

  @OnEvent(DomainEvents.OrderCreated, { async: true })
  async onOrderCreated(e: OrderCreatedEvent) {
    try {
      await this.applyPrepaymentRule(e.orderId);
    } catch (err) {
      this.log.error(`prepayment rule failed for ${e.trackingNumber}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** COD to a prepay-only customer or above the prepay risk threshold → ON_HOLD PREPAY_REQUIRED + brand notified. */
  async applyPrepaymentRule(orderId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ o: orders, requirePrepayment: customers.requirePrepayment })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row) return false;
    const { o } = row;
    if (o.status !== 'CREATED' || o.paymentMethod !== 'COD' || o.codAmountCents <= 0 || o.type === 'RETURN') return false;
    const s = await this.config();
    const byCustomer = row.requirePrepayment;
    if (!byCustomer && o.riskScore < s.prepayAboveRisk) return false;
    const held = await this.workflow.run(async (tx, fx) => {
      const cur = await this.workflow.lock(tx, orderId);
      if (cur.status !== 'CREATED' || cur.paymentMethod !== 'COD') return false;
      const note = byCustomer
        ? 'Held: this recipient must pay online first (network prepayment rule)'
        : `Held: COD risk ${cur.riskScore} ≥ ${s.prepayAboveRisk} — collect online first`;
      await this.hold(tx, fx, orderId, HoldReason.PREPAY_REQUIRED, SYSTEM_ACTOR, note);
      return true;
    });
    if (held) {
      await this.notifications.notifyBrandOwners(o.brandId, 'prepay_required', { tn: o.trackingNumber, phone: maskPhone(o.recipientPhone) }, {
        orderId: o.id,
        data: { orderId: o.id, trackingNumber: o.trackingNumber, holdReason: HoldReason.PREPAY_REQUIRED, link: `/brand/orders/${o.id}` },
      });
    }
    return held;
  }

  /** Job step: PREPAY_REQUIRED holds whose order became prepaid (payment link paid / brand switched) are released. */
  async sweepPrepaid(): Promise<number> {
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'ON_HOLD'), eq(orders.holdReason, HoldReason.PREPAY_REQUIRED), or(eq(orders.paymentMethod, 'PREPAID'), eq(orders.codAmountCents, 0))))
      .limit(PREPAY_SWEEP_BATCH);
    let n = 0;
    for (const r of rows) {
      try {
        await this.workflow.run((tx, fx) => this.releaseInTx(tx, fx, r.id, SYSTEM_ACTOR, 'Prepaid — released for delivery', { reason: 'PREPAID' }));
        n++;
      } catch (err) {
        this.log.warn(`prepaid release failed for ${r.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ staff / brand actions

  private async load(id: string, p: Principal): Promise<OrderRow> {
    const scope = brandScope(p);
    const [o] = await this.db.select().from(orders).where(scope ? and(eq(orders.id, id), eq(orders.brandId, scope)) : eq(orders.id, id)).limit(1);
    if (!o) throw notFound('Order', id);
    return o;
  }

  /**
   * Release a hold whose cause is resolved: prepay holds once the order is
   * prepaid, unconfirmed holds once the customer confirmed (or use override).
   * Brands may release their own PREPAY_REQUIRED holds after switching to prepaid.
   */
  async release(id: string, note: string | undefined, p: Principal, meta: RequestMetaInfo) {
    const actor = actorFromPrincipal(p);
    const o = await this.load(id, p);
    if (o.status !== 'ON_HOLD') throw new DomainError('NOT_ON_HOLD', 'This order is not on hold', HttpStatus.CONFLICT, { status: o.status });
    const isBrand = brandScope(p) !== null;
    if (isBrand && o.holdReason !== HoldReason.PREPAY_REQUIRED) throw new DomainError('HOLD_NOT_RELEASABLE', 'Only GoTurtle staff can release this hold', HttpStatus.FORBIDDEN);
    if (o.holdReason === HoldReason.PREPAY_REQUIRED && o.paymentMethod === 'COD' && o.codAmountCents > 0) {
      throw new DomainError('PREPAYMENT_REQUIRED', 'Collect online first (payment link) or switch the order to prepaid', HttpStatus.CONFLICT, { holdReason: o.holdReason });
    }
    if (o.holdReason === HoldReason.UNCONFIRMED && !['CONFIRMED', 'RESCHEDULED'].includes(o.confirmationStatus)) {
      throw new DomainError('CONFIRMATION_REQUIRED', 'The customer has not confirmed — record the confirmation or use a manager override', HttpStatus.CONFLICT, { holdReason: o.holdReason, confirmationStatus: o.confirmationStatus });
    }
    // Brand users have no STATUS_ACTORS right to move out of ON_HOLD: the system releases on their behalf.
    const by: ActorContext = isBrand ? { ...SYSTEM_ACTOR, name: `${actor.name} (brand)` } : actor;
    await this.workflow.run(async (tx, fx) => {
      await this.releaseInTx(tx, fx, id, by, note?.trim() || 'Hold released', { meta });
      await this.audit.record(p, { action: 'integrity.hold_release', entity: 'Order', entityId: id, before: { holdReason: o.holdReason }, after: { note: note ?? null } }, meta, tx);
    });
    return this.holdState(id);
  }

  /** Manager override: releases any integrity hold and lets the order be dispatched. */
  async override(id: string, reason: string, p: Principal, meta: RequestMetaInfo) {
    const actor = actorFromPrincipal(p);
    await this.assertCanOverride(this.db, actor);
    await this.workflow.run(async (tx, fx) => {
      const o = await this.workflow.lock(tx, id);
      if (o.status !== 'ON_HOLD' && !this.blockerFor(o, await this.config())) {
        throw new DomainError('NOTHING_TO_OVERRIDE', 'No delivery-integrity rule blocks this order', HttpStatus.CONFLICT);
      }
      await this.recordOverride(tx, o, actor, reason.trim(), this.blockerFor(o, await this.config()), meta);
      if (o.status === 'ON_HOLD') await this.releaseInTx(tx, fx, id, actor, `Override: ${reason.trim()}`, { reason: 'INTEGRITY_OVERRIDE', meta });
    });
    return this.holdState(id);
  }

  /** Cancel a held order (before pickup) or send it back to the brand (already collected). */
  async cancel(id: string, note: string, p: Principal, meta: RequestMetaInfo) {
    const actor = actorFromPrincipal(p);
    await this.workflow.run(async (tx, fx) => {
      const o = await this.workflow.lock(tx, id);
      if (o.status !== 'ON_HOLD') throw new DomainError('NOT_ON_HOLD', 'This order is not on hold', HttpStatus.CONFLICT, { status: o.status });
      const to: OrderStatus = o.pickedUpAt ? 'RETURN_PENDING' : 'CANCELLED';
      await this.workflow.apply(tx, fx, id, to, actor, { reason: o.holdReason ?? 'HOLD_CANCELLED', note: note.trim(), meta });
      await this.audit.record(p, { action: 'integrity.hold_cancel', entity: 'Order', entityId: id, before: { holdReason: o.holdReason }, after: { status: to, note } }, meta, tx);
    });
    return this.holdState(id);
  }

  async holdState(id: string) {
    const [o] = await this.db
      .select({ id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, holdReason: orders.holdReason, confirmationStatus: orders.confirmationStatus, paymentMethod: orders.paymentMethod, metadata: orders.metadata })
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);
    if (!o) throw notFound('Order', id);
    const { metadata, ...rest } = o;
    return { ...rest, override: integrityMetaOf(metadata).override ?? null };
  }
}
