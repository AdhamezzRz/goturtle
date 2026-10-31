import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNotNull, like, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { CollectionMethod, formatEgp, type CollectionStatus } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { brands, couriers, orders, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { PostingsService, type DoorCollection } from '../../core/ledger/postings.service';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { principalUserId, type Principal } from '../../common/principal';
import { actorFromPrincipal } from '../../common/actor';
import type { RequestMetaInfo } from '../../common/decorators';
import { likeEscape } from '../../db/helpers';
import { resolveDayRange, toNumber } from '../couriers/workforce.util';
import { OrderWorkflowService, type TransitionContext } from '../orders/order-workflow.service';
import type { OrderRow } from '../orders/order-factory.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService, paymentOf } from '../payments/payments.service';
import type { BulkConfirmCollectionsDto, ListCollectionsQuery } from './money-programs.dto';

/** Methods that need the transfer / card-slip reference typed by the hero. */
const NEEDS_REFERENCE: CollectionMethod[] = ['INSTAPAY', 'WALLET', 'CARD'];
/** Where a confirmed digital collection lands. */
const confirmVia = (method: CollectionMethod | null) => (method === 'PAYMENT_LINK' ? 'PAYMENT_GATEWAY' : 'BANK') as 'BANK' | 'PAYMENT_GATEWAY';
const DIGITAL = and(isNotNull(orders.collectionMethod), ne(orders.collectionMethod, 'CASH'))!;

/**
 * Digital payment at the door (InstaPay, mobile wallets, card on a POS,
 * Paymob payment link). The hero never holds this money: on delivery it is
 * posted to 1030 Digital clearing (owed to the brand as usual) and finance
 * confirms it against the bank statement (→ 1010 Bank) or rejects it (the
 * transfer never arrived → the hero owes it as cash).
 *
 * Hooks into the order workflow: a guard validates & normalises
 * `extensions.collection` on DELIVERED, an effect stores the method/status on
 * the order. The posting itself is PostingsService.orderDelivered.
 */
@Injectable()
export class CollectionsService implements OnModuleInit {
  private readonly log = new Logger('Collections');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly workflow: OrderWorkflowService,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
    private readonly postings: PostingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.workflow.registerGuard('money.collection', (ctx) => this.guard(ctx));
    this.workflow.registerEffect('money.collection', (ctx) => this.effect(ctx));
  }

  // ------------------------------------------------------------------ workflow hooks

  private async guard(ctx: TransitionContext) {
    if (ctx.to !== 'DELIVERED' || !ctx.opts.extensions || !('collection' in ctx.opts.extensions)) return;
    const raw = (ctx.opts.extensions.collection ?? {}) as { method?: string; reference?: string | null };
    const method = (raw.method ?? 'CASH') as CollectionMethod;
    if (!Object.values(CollectionMethod).includes(method)) throw new DomainError('INVALID_COLLECTION_METHOD', `Unknown collection method ${raw.method}`, HttpStatus.BAD_REQUEST);
    const collected = ctx.opts.delivery?.collectedCents ?? ctx.order.collectCents;
    if (collected <= 0) {
      // Nothing to collect (prepaid): the method is irrelevant.
      ctx.opts.extensions.collection = null;
      return;
    }
    const fin = await this.settings.get('finance');
    if (!fin.acceptedCollectionMethods.includes(method)) {
      throw new DomainError('COLLECTION_METHOD_NOT_ACCEPTED', `${method} is not accepted at the door`, HttpStatus.UNPROCESSABLE_ENTITY, { accepted: fin.acceptedCollectionMethods });
    }
    let reference = raw.reference?.trim() || null;
    let gatewayPaid = false;
    if (NEEDS_REFERENCE.includes(method)) {
      if (!reference || reference.length < 4) throw new DomainError('COLLECTION_REFERENCE_REQUIRED', 'Enter the transfer reference shown on the customer’s phone', HttpStatus.UNPROCESSABLE_ENTITY);
      // One transfer pays one parcel: a reused reference is refused.
      const [dup] = await ctx.tx
        .select({ trackingNumber: orders.trackingNumber })
        .from(orders)
        .where(and(eq(orders.collectionMethod, method), eq(orders.collectionReference, reference), ne(orders.id, ctx.order.id), ne(orders.collectionStatus, 'REJECTED')))
        .limit(1);
      if (dup) throw new DomainError('COLLECTION_REFERENCE_USED', `This reference was already used for ${dup.trackingNumber}`, HttpStatus.CONFLICT, { trackingNumber: dup.trackingNumber });
    }
    if (method === 'PAYMENT_LINK') {
      if (!this.payments.enabled) throw new DomainError('PAYMENTS_DISABLED', 'Online payments are not enabled', HttpStatus.CONFLICT);
      const pay = paymentOf(ctx.order.metadata);
      if (!pay?.atDoor) throw new DomainError('PAYMENT_LINK_REQUIRED', 'Create the payment link for the customer first', HttpStatus.UNPROCESSABLE_ENTITY);
      if (pay.amountCents !== collected) throw new DomainError('PAYMENT_LINK_AMOUNT_MISMATCH', 'The payment link amount differs from the amount to collect', HttpStatus.CONFLICT);
      gatewayPaid = pay.status === 'PAID';
      reference = reference ?? (pay.transactionId ? `paymob:${pay.transactionId}` : pay.specialReference);
    }
    ctx.opts.extensions.collection = { method, reference: method === 'CASH' ? null : reference, gatewayPaid } satisfies DoorCollection;
  }

  private async effect(ctx: TransitionContext & { updated: OrderRow }) {
    if (ctx.to !== 'DELIVERED') return;
    const c = ctx.opts.extensions?.collection as DoorCollection | null | undefined;
    if (!c || ctx.updated.collectedCents <= 0) return;
    const status: CollectionStatus = c.method === 'CASH' ? 'NOT_APPLICABLE' : c.gatewayPaid ? 'CONFIRMED' : 'PENDING_CONFIRMATION';
    await ctx.tx.update(orders).set({ collectionMethod: c.method, collectionStatus: status, collectionReference: c.reference ?? null }).where(eq(orders.id, ctx.order.id));
  }

  // ------------------------------------------------------------------ finance queue

  async list(q: ListCollectionsQuery) {
    const conds: Array<SQL | undefined> = [
      DIGITAL,
      q.status ? eq(orders.collectionStatus, q.status) : undefined,
      q.method ? eq(orders.collectionMethod, q.method) : undefined,
      q.courierId ? eq(orders.courierId, q.courierId) : undefined,
    ];
    if (q.from || q.to) {
      const r = resolveDayRange(q.from, q.to, 30, 366);
      conds.push(gte(orders.deliveredAt, r.start), lt(orders.deliveredAt, r.end));
    }
    if (q.q?.trim()) {
      const term = `%${likeEscape(q.q.trim())}%`;
      conds.push(or(like(orders.trackingNumber, term), like(orders.collectionReference, term)));
    }
    const where = and(...conds);
    const [rows, [{ n }], totals] = await Promise.all([
      this.baseSelect().where(where).orderBy(desc(orders.deliveredAt), desc(orders.id)).limit(q.pageSize).offset(offsetOf(q)),
      this.db.select({ n: count() }).from(orders).where(where),
      this.db
        .select({ status: orders.collectionStatus, method: orders.collectionMethod, n: count(), cents: sql<number>`coalesce(sum(${orders.collectedCents}), 0)`.mapWith(Number) })
        .from(orders)
        .where(DIGITAL)
        .groupBy(orders.collectionStatus, orders.collectionMethod),
    ]);
    const sum = (s: CollectionStatus) => totals.filter((r) => r.status === s).reduce((a, r) => ({ n: a.n + Number(r.n), cents: a.cents + toNumber(r.cents) }), { n: 0, cents: 0 });
    return {
      ...paginate(rows.map((r) => this.present(r)), Number(n), q),
      summary: {
        pending: sum('PENDING_CONFIRMATION'),
        confirmed: sum('CONFIRMED'),
        rejected: sum('REJECTED'),
        pendingByMethod: Object.fromEntries(totals.filter((r) => r.status === 'PENDING_CONFIRMATION').map((r) => [r.method, { n: Number(r.n), cents: toNumber(r.cents) }])),
      },
    };
  }

  private baseSelect() {
    return this.db
      .select({
        id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, brandId: orders.brandId, brandName: brands.name, brandCode: brands.code,
        courierId: orders.courierId, courierCode: couriers.code, courierName: users.name, recipientName: orders.recipientName,
        collectedCents: orders.collectedCents, collectionMethod: orders.collectionMethod, collectionStatus: orders.collectionStatus,
        collectionReference: orders.collectionReference, deliveredAt: orders.deliveredAt, metadata: orders.metadata,
      })
      .from(orders)
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .leftJoin(couriers, eq(couriers.id, orders.courierId))
      .leftJoin(users, eq(users.id, couriers.userId));
  }

  private present(r: Awaited<ReturnType<CollectionsService['baseSelect']>>[number]) {
    const { metadata, ...rest } = r;
    const decision = (metadata as Record<string, unknown> | null)?.collectionDecision as { note?: string; at?: string; by?: string; bankReference?: string } | undefined;
    return {
      ...rest,
      brand: { id: r.brandId, code: r.brandCode, name: r.brandName },
      courier: r.courierId ? { id: r.courierId, code: r.courierCode, name: r.courierName } : null,
      decision: decision ?? null,
    };
  }

  async get(orderId: string) {
    const [row] = await this.baseSelect().where(and(eq(orders.id, orderId), DIGITAL)).limit(1);
    if (!row) throw notFound('Collection', orderId);
    return this.present(row);
  }

  /** Transfer found on the bank statement (or gateway report): clearing → bank. */
  async confirm(orderId: string, bankReference: string | null, principal: Principal, meta: RequestMetaInfo | null) {
    await this.workflow.run(async (tx) => {
      const o = await this.workflow.lock(tx, orderId);
      this.assertPending(o);
      const via = confirmVia(o.collectionMethod);
      await this.postings.digitalCollectionConfirmed(tx, o, via, principalUserId(principal), bankReference);
      const decision = { status: 'CONFIRMED', at: new Date().toISOString(), by: principal.name, bankReference: bankReference ?? null };
      await tx.update(orders).set({ collectionStatus: 'CONFIRMED', metadata: { ...(o.metadata ?? {}), collectionDecision: decision } }).where(eq(orders.id, orderId));
      await this.workflow.addNote(tx, o, actorFromPrincipal(principal), {
        reason: 'COLLECTION_CONFIRMED', note: `${o.collectionMethod} ${formatEgp(o.collectedCents)} confirmed${bankReference ? ` (bank ref ${bankReference})` : ''}`,
        metadata: { via, bankReference },
      });
      await this.audit.record(principal, { action: 'collection.confirm', entity: 'Order', entityId: orderId, before: { collectionStatus: o.collectionStatus }, after: { collectionStatus: 'CONFIRMED', via, bankReference } }, meta, tx);
    });
    return this.get(orderId);
  }

  /** Money never arrived: the hero owes it as cash (custody goes up) and is told why. */
  async reject(orderId: string, note: string, principal: Principal, meta: RequestMetaInfo | null) {
    const o = await this.workflow.run(async (tx) => {
      const row = await this.workflow.lock(tx, orderId);
      this.assertPending(row);
      if (!row.courierId) throw new DomainError('COURIER_REQUIRED', 'The order has no hero to hold the amount', HttpStatus.CONFLICT);
      await this.postings.digitalCollectionRejected(tx, row, row.courierId, principalUserId(principal));
      const decision = { status: 'REJECTED', at: new Date().toISOString(), by: principal.name, note };
      await tx.update(orders).set({ collectionStatus: 'REJECTED', metadata: { ...(row.metadata ?? {}), collectionDecision: decision } }).where(eq(orders.id, orderId));
      await this.workflow.addNote(tx, row, actorFromPrincipal(principal), { reason: 'COLLECTION_REJECTED', note: `${row.collectionMethod} ${formatEgp(row.collectedCents)} rejected: ${note}`, metadata: { note } });
      await this.audit.record(principal, { action: 'collection.reject', entity: 'Order', entityId: orderId, before: { collectionStatus: row.collectionStatus }, after: { collectionStatus: 'REJECTED', note } }, meta, tx);
      return row;
    });
    const [hero] = await this.db.select({ userId: couriers.userId }).from(couriers).where(eq(couriers.id, o.courierId!)).limit(1);
    if (hero) {
      await this.notifications
        .inApp([hero.userId], 'collection_rejected', { tn: o.trackingNumber, amount: formatEgp(o.collectedCents, 'ar'), note }, { orderId: o.id, data: { orderId: o.id, link: '/hero/wallet' } })
        .catch((err) => this.log.warn(`collection_rejected notification failed: ${err instanceof Error ? err.message : err}`));
    }
    return this.get(orderId);
  }

  /** Paste the references from the bank statement: every pending collection that matches is confirmed. */
  async bulkConfirm(dto: BulkConfirmCollectionsDto, principal: Principal, meta: RequestMetaInfo | null) {
    const refs = [...new Set(dto.references.map((r) => r.trim()).filter((r) => r.length >= 2))];
    const found = refs.length
      ? await this.db
          .select({ id: orders.id, trackingNumber: orders.trackingNumber, reference: orders.collectionReference, status: orders.collectionStatus })
          .from(orders)
          .where(and(DIGITAL, inArray(orders.collectionReference, refs)))
      : [];
    const confirmed: Array<{ orderId: string; trackingNumber: string; reference: string }> = [];
    const alreadyProcessed: Array<{ trackingNumber: string; reference: string; status: CollectionStatus }> = [];
    for (const f of found) {
      if (f.status !== 'PENDING_CONFIRMATION') {
        alreadyProcessed.push({ trackingNumber: f.trackingNumber, reference: f.reference!, status: f.status });
        continue;
      }
      try {
        await this.confirm(f.id, dto.bankReference ?? f.reference, principal, meta);
        confirmed.push({ orderId: f.id, trackingNumber: f.trackingNumber, reference: f.reference! });
      } catch (err) {
        if (err instanceof DomainError && err.code === 'COLLECTION_NOT_PENDING') alreadyProcessed.push({ trackingNumber: f.trackingNumber, reference: f.reference!, status: 'CONFIRMED' });
        else throw err;
      }
    }
    const matched = new Set(found.map((f) => f.reference));
    return { confirmed, alreadyProcessed, notFound: refs.filter((r) => !matched.has(r)) };
  }

  private assertPending(o: OrderRow) {
    if (!o.collectionMethod || o.collectionMethod === 'CASH') throw notFound('Collection', o.id);
    if (o.collectionStatus !== 'PENDING_CONFIRMATION') {
      throw new DomainError('COLLECTION_NOT_PENDING', `This collection is already ${o.collectionStatus}`, HttpStatus.CONFLICT, { status: o.collectionStatus });
    }
  }

  // ------------------------------------------------------------------ hero

  /** What the deliver sheet offers: accepted methods, the company InstaPay / wallet, and whether payment links work. */
  async heroOptions() {
    const fin = await this.settings.get('finance');
    const methods = fin.acceptedCollectionMethods.filter((m) => m !== 'PAYMENT_LINK' || this.payments.enabled);
    return { methods, instapayAddress: fin.instapayAddress || null, walletNumber: fin.walletNumber || null, paymentLinkEnabled: methods.includes('PAYMENT_LINK') };
  }

  /** The hero's digital collections: they never count toward cash on hand (until rejected). */
  async heroCollections(courierId: string, q: { status?: CollectionStatus; page: number; pageSize: number }) {
    const where = and(DIGITAL, eq(orders.courierId, courierId), q.status ? eq(orders.collectionStatus, q.status) : undefined);
    const [rows, [{ n }], totals] = await Promise.all([
      this.baseSelect().where(where).orderBy(desc(orders.deliveredAt), desc(orders.id)).limit(q.pageSize).offset(offsetOf(q)),
      this.db.select({ n: count() }).from(orders).where(where),
      this.db
        .select({ status: orders.collectionStatus, n: count(), cents: sql<number>`coalesce(sum(${orders.collectedCents}), 0)`.mapWith(Number) })
        .from(orders)
        .where(and(DIGITAL, eq(orders.courierId, courierId)))
        .groupBy(orders.collectionStatus),
    ]);
    const of = (s: CollectionStatus) => {
      const r = totals.find((x) => x.status === s);
      return { n: Number(r?.n ?? 0), cents: toNumber(r?.cents) };
    };
    return {
      ...paginate(rows.map((r) => this.present(r)), Number(n), q),
      summary: { pending: of('PENDING_CONFIRMATION'), confirmed: of('CONFIRMED'), rejected: of('REJECTED') },
    };
  }

  async doorPaymentStatus(courierId: string, orderId: string) {
    const [o] = await this.db.select({ id: orders.id, courierId: orders.courierId, metadata: orders.metadata, collectCents: orders.collectCents }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o || o.courierId !== courierId) throw notFound('Order', orderId);
    const pay = paymentOf(o.metadata);
    return { orderId, enabled: this.payments.enabled, payment: pay?.atDoor ? { status: pay.status, amountCents: pay.amountCents, checkoutUrl: pay.checkoutUrl, paidAt: pay.paidAt ?? null } : null };
  }
}
