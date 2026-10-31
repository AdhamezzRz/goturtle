import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { formatEgp, type OrderStatus } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { brands, orderEvents, orders, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { LedgerService } from '../../core/ledger/ledger.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { DomainError, notFound } from '../../common/errors';
import { brandScope, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { config } from '../../config';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymobClient, paymobConcatFromObject, paymobConcatFromQuery, verifyPaymobHmac } from './paymob';

/** Statuses in which the customer can still be asked to pay online instead of cash. */
export const PAYABLE_STATUSES: readonly OrderStatus[] = ['CREATED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'FAILED_ATTEMPT', 'RESCHEDULED', 'ON_HOLD'];
/** Payment arrived after these: money is recorded for a refund decision, the order is not touched. */
const LATE_STATUSES: readonly OrderStatus[] = ['DELIVERED', 'RETURNED', 'CANCELLED', 'LOST', 'RETURN_PENDING', 'RETURN_OUT', 'DAMAGED', 'OUT_FOR_DELIVERY'];
const LINK_REUSE_MS = 23 * 3_600_000;

export interface PaymentMeta {
  provider: 'paymob';
  status: 'PENDING' | 'PAID' | 'PAID_LATE' | 'FAILED';
  amountCents: number;
  specialReference: string;
  intentionId: string;
  checkoutUrl: string;
  createdAt: string;
  transactionId?: string;
  paidAt?: string;
  lastError?: string;
  /** Created by the hero at the door (the order stays COD; the payment confirms the door collection). */
  atDoor?: boolean;
}

export interface ApplyResult {
  ok: boolean;
  action: 'paid' | 'paid_late' | 'already_paid' | 'pending' | 'failed' | 'mismatch' | 'ignored';
  trackingNumber?: string;
}

export interface PaymobTransaction {
  id?: number | string;
  success?: boolean;
  pending?: boolean;
  is_voided?: boolean;
  is_refunded?: boolean;
  error_occured?: boolean;
  amount_cents?: number | string;
  currency?: string;
  order?: { id?: number | string; merchant_order_id?: string | null } | number | string;
  payment_key_claims?: { extra?: Record<string, unknown> };
  [k: string]: unknown;
}

/**
 * Online payment for COD orders (customer pays before the hero arrives).
 * Provider is chosen by PAYMENT_PROVIDER (none | paymob).
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');
  private readonly paymob = new PaymobClient();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly postings: PostingsService,
  ) {}

  get enabled() {
    return config.payments.provider === 'paymob';
  }

  private assertEnabled() {
    if (!this.enabled) throw new DomainError('PAYMENTS_DISABLED', 'Online payments are not enabled', HttpStatus.CONFLICT);
  }

  async status(p: Principal, orderId: string) {
    const o = await this.loadOrder(p, orderId);
    const pay = paymentOf(o.metadata);
    return { orderId: o.id, trackingNumber: o.trackingNumber, enabled: this.enabled, paymentMethod: o.paymentMethod, collectCents: o.collectCents, payment: pay };
  }

  /** Creates (or reuses) a Paymob checkout link for the amount the hero would collect. */
  async createLink(p: Principal, orderId: string, opts: { notifyCustomer?: boolean }, meta: RequestMetaInfo) {
    this.assertEnabled();
    const o = await this.loadOrder(p, orderId);
    if (o.paymentMethod !== 'COD' || o.collectCents <= 0) throw new DomainError('NOT_COD', 'Only cash-on-delivery orders with an amount to collect can be paid online', HttpStatus.CONFLICT);
    if (!PAYABLE_STATUSES.includes(o.status)) throw new DomainError('PAYMENT_NOT_ALLOWED', `Order is ${o.status}; online payment is only possible before it goes out for delivery`, HttpStatus.CONFLICT);

    const existing = paymentOf(o.metadata);
    let payment: PaymentMeta;
    let reused = false;
    if (existing?.status === 'PENDING' && existing.amountCents === o.collectCents && Date.now() - Date.parse(existing.createdAt) < LINK_REUSE_MS) {
      payment = existing;
      reused = true;
    } else {
      payment = await this.openIntention(o, false, p, meta);
    }
    if (opts.notifyCustomer) {
      await this.notifications
        .queue({
          channel: 'SMS', to: o.recipientPhone, template: 'payment_link', locale: 'ar', orderId: o.id,
          vars: { amount: formatEgp(payment.amountCents, 'ar'), tn: o.trackingNumber, brand: o.brandName, link: payment.checkoutUrl },
        })
        .catch((err) => this.log.warn(`payment link SMS failed: ${err instanceof Error ? err.message : err}`));
    }
    return { orderId: o.id, trackingNumber: o.trackingNumber, amountCents: payment.amountCents, checkoutUrl: payment.checkoutUrl, status: payment.status, reused };
  }

  /**
   * Hero at the door: a Paymob link / QR for the amount to collect on the
   * hero's OUT_FOR_DELIVERY order. The order stays COD — when the hero records
   * the delivery with PAYMENT_LINK the collection is confirmed by the webhook
   * (or immediately, when the customer already paid).
   */
  async createDoorLink(p: Principal, courierId: string, orderId: string, meta: RequestMetaInfo | null) {
    this.assertEnabled();
    const [row] = await this.db
      .select({ order: orders, brandName: brands.name, zoneName: zones.nameEn })
      .from(orders)
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .leftJoin(zones, eq(zones.id, orders.zoneId))
      .where(and(eq(orders.id, orderId), eq(orders.courierId, courierId)))
      .limit(1);
    if (!row) throw notFound('Order', orderId);
    const o = { ...row.order, brandName: row.brandName, zoneName: row.zoneName ?? 'Cairo' };
    if (o.paymentMethod !== 'COD' || o.collectCents <= 0) throw new DomainError('NOT_COD', 'Nothing to collect on this parcel', HttpStatus.CONFLICT);
    if (o.status !== 'OUT_FOR_DELIVERY') throw new DomainError('PAYMENT_NOT_ALLOWED', 'A door payment link is only available while the parcel is out for delivery', HttpStatus.CONFLICT);
    const existing = paymentOf(o.metadata);
    if (existing?.atDoor && existing.amountCents === o.collectCents && (existing.status === 'PAID' || (existing.status === 'PENDING' && Date.now() - Date.parse(existing.createdAt) < LINK_REUSE_MS))) {
      return { orderId: o.id, trackingNumber: o.trackingNumber, amountCents: existing.amountCents, checkoutUrl: existing.checkoutUrl, status: existing.status, reused: true };
    }
    const payment = await this.openIntention(o, true, p, meta, courierId);
    return { orderId: o.id, trackingNumber: o.trackingNumber, amountCents: payment.amountCents, checkoutUrl: payment.checkoutUrl, status: payment.status, reused: false };
  }

  /** Creates a Paymob intention for the order's collect amount and stores it on the order metadata. */
  private async openIntention(
    o: (typeof orders.$inferSelect) & { brandName: string; zoneName: string },
    atDoor: boolean,
    p: Principal | null,
    meta: RequestMetaInfo | null,
    courierId?: string,
  ): Promise<PaymentMeta> {
    const specialReference = `gt_${o.id}_${Date.now().toString(36)}`;
    const [first, ...rest] = o.recipientName.trim().split(/\s+/);
    const intention = await this.paymob
      .createIntention({
        amountCents: o.collectCents,
        specialReference,
        description: `${o.brandName} — ${o.trackingNumber}`,
        customer: { firstName: first ?? 'Customer', lastName: rest.join(' ') || first || 'Customer', phone: o.recipientPhone },
        address: { street: o.addressLine, building: o.building, floor: o.floor, apartment: o.apartment, city: o.zoneName },
        notificationUrl: `${config.appUrl}/api/v1/payments/paymob/callback`,
        redirectionUrl: `${config.appUrl}/api/v1/payments/paymob/callback`,
        extras: { orderId: o.id, trackingNumber: o.trackingNumber },
      })
      .catch((err: Error) => {
        this.log.error(`Paymob intention for ${o.trackingNumber} failed: ${err.message}`);
        throw new DomainError('PAYMENT_PROVIDER_ERROR', 'The payment provider is not reachable, try again', HttpStatus.BAD_GATEWAY);
      });
    const payment: PaymentMeta = {
      provider: 'paymob', status: 'PENDING', amountCents: o.collectCents, specialReference, intentionId: intention.intentionId,
      checkoutUrl: intention.checkoutUrl, createdAt: new Date().toISOString(), ...(atDoor ? { atDoor: true } : {}),
    };
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select({ metadata: orders.metadata }).from(orders).where(eq(orders.id, o.id)).for('update');
      await tx.update(orders).set({ metadata: { ...(locked?.metadata ?? {}), payment } }).where(eq(orders.id, o.id));
      await this.audit.record(
        p,
        { action: atDoor ? 'payment.door_link' : 'payment.link', entity: 'Order', entityId: o.id, after: { amountCents: payment.amountCents, intentionId: payment.intentionId, courierId: courierId ?? null } },
        meta,
        tx,
      );
    });
    return payment;
  }

  /** Processed callback (POST JSON). Returns the outcome; throws 401 on a bad HMAC. */
  async handleCallback(body: { type?: string; obj?: PaymobTransaction } | undefined, hmac: string | undefined) {
    const secret = process.env.PAYMOB_HMAC_SECRET ?? '';
    if (!secret) throw new DomainError('PAYMENTS_DISABLED', 'Paymob HMAC secret is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    const obj = body?.obj;
    if (!obj || typeof obj !== 'object' || !verifyPaymobHmac(secret, paymobConcatFromObject(obj), hmac)) {
      throw new DomainError('INVALID_SIGNATURE', 'Invalid Paymob HMAC', HttpStatus.UNAUTHORIZED);
    }
    if (body?.type && body.type !== 'TRANSACTION') return { ok: true, action: 'ignored' as const };
    const merchantRef = typeof obj.order === 'object' && obj.order ? obj.order.merchant_order_id ?? null : null;
    const extraOrderId = typeof obj.payment_key_claims?.extra?.orderId === 'string' ? (obj.payment_key_claims.extra.orderId as string) : null;
    return this.applyTransaction({
      transactionId: String(obj.id ?? ''),
      success: obj.success === true && obj.pending === false && !obj.is_voided && !obj.is_refunded && !obj.error_occured,
      pending: obj.pending === true,
      amountCents: Number(obj.amount_cents),
      currency: String(obj.currency ?? 'EGP'),
      merchantRef,
      extraOrderId,
    });
  }

  /** Browser redirect (GET with flattened fields). Returns where to send the customer. */
  async handleRedirect(query: Record<string, string>) {
    const secret = process.env.PAYMOB_HMAC_SECRET ?? '';
    if (!secret || !verifyPaymobHmac(secret, paymobConcatFromQuery(query), query.hmac)) {
      throw new DomainError('INVALID_SIGNATURE', 'Invalid Paymob HMAC', HttpStatus.UNAUTHORIZED);
    }
    const result = await this.applyTransaction({
      transactionId: String(query.id ?? ''),
      success: query.success === 'true' && query.pending === 'false' && query.is_voided !== 'true' && query.is_refunded !== 'true' && query.error_occured !== 'true',
      pending: query.pending === 'true',
      amountCents: Number(query.amount_cents),
      currency: query.currency ?? 'EGP',
      merchantRef: query.merchant_order_id ?? null,
      extraOrderId: null,
    });
    const tn = result.trackingNumber;
    const outcome = result.action === 'paid' || result.action === 'already_paid' ? 'success' : result.action === 'pending' ? 'pending' : 'failed';
    return { url: tn ? `${config.appUrl}/t/${tn}?payment=${outcome}` : `${config.appUrl}/?payment=${outcome}` };
  }

  /** Idempotent: a transaction is applied at most once (ledger reference payment:<orderId>). */
  async applyTransaction(t: { transactionId: string; success: boolean; pending: boolean; amountCents: number; currency: string; merchantRef: string | null; extraOrderId: string | null }): Promise<ApplyResult> {
    const orderId = /^gt_([a-z0-9]+)_[a-z0-9]+$/.exec(t.merchantRef ?? '')?.[1] ?? t.extraOrderId;
    if (!orderId) {
      this.log.warn(`Paymob transaction ${t.transactionId} has no GoTurtle reference`);
      return { ok: true, action: 'ignored' as const };
    }
    return this.db.transaction(async (tx): Promise<ApplyResult> => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for('update');
      const pay = o ? paymentOf(o.metadata) : null;
      if (!o || !pay || (t.merchantRef && pay.specialReference !== t.merchantRef)) {
        this.log.warn(`Paymob transaction ${t.transactionId} does not match a payment link`);
        return { ok: true, action: 'ignored' as const };
      }
      const save = (next: PaymentMeta) => tx.update(orders).set({ metadata: { ...(o.metadata ?? {}), payment: next } }).where(eq(orders.id, o.id));
      if (pay.status === 'PAID' || pay.status === 'PAID_LATE') return { ok: true, action: 'already_paid' as const, trackingNumber: o.trackingNumber };
      if (t.pending) return { ok: true, action: 'pending' as const, trackingNumber: o.trackingNumber };
      if (!t.success) {
        await save({ ...pay, lastError: `Transaction ${t.transactionId} was not successful` });
        return { ok: true, action: 'failed' as const, trackingNumber: o.trackingNumber };
      }
      if (t.currency !== 'EGP' || t.amountCents !== pay.amountCents) {
        this.log.error(`Paymob amount mismatch on ${o.trackingNumber}: got ${t.amountCents} ${t.currency}, expected ${pay.amountCents} EGP`);
        await save({ ...pay, lastError: `Amount mismatch: ${t.amountCents} ${t.currency}` });
        return { ok: true, action: 'mismatch' as const, trackingNumber: o.trackingNumber };
      }
      const paidAt = new Date().toISOString();
      if (pay.atDoor) {
        const doorDelivery = o.status === 'DELIVERED' && o.collectionMethod === 'PAYMENT_LINK';
        if (o.status === 'OUT_FOR_DELIVERY' || (doorDelivery && o.collectionStatus !== 'REJECTED')) {
          await save({ ...pay, status: 'PAID', transactionId: t.transactionId, paidAt });
          if (doorDelivery && o.collectionStatus === 'PENDING_CONFIRMATION') {
            // Delivered before the gateway called back: the clearing balance moves to the gateway.
            await this.postings.digitalCollectionConfirmed(tx, o, 'PAYMENT_GATEWAY', null, t.transactionId);
            await tx.update(orders).set({ collectionStatus: 'CONFIRMED', collectionReference: o.collectionReference ?? `paymob:${t.transactionId}` }).where(eq(orders.id, o.id));
          }
          await tx.insert(orderEvents).values({
            orderId: o.id, status: o.status, fromStatus: o.status, actorType: 'SYSTEM', actorName: 'Paymob', reason: 'DOOR_PAYMENT_PAID', isPublic: false,
            note: `Paid ${formatEgp(t.amountCents)} at the door with the payment link (Paymob txn ${t.transactionId})`,
            metadata: { paymob: { transactionId: t.transactionId, amountCents: t.amountCents, atDoor: true } },
          });
          return { ok: true, action: 'paid' as const, trackingNumber: o.trackingNumber };
        }
      }
      if (LATE_STATUSES.includes(o.status)) {
        // Too late to switch the order to prepaid (the hero may already hold cash). Finance refunds or settles manually.
        await save({ ...pay, status: 'PAID_LATE', transactionId: t.transactionId, paidAt });
        await tx.insert(orderEvents).values({
          orderId: o.id, status: o.status, fromStatus: o.status, actorType: 'SYSTEM', actorName: 'Paymob', isPublic: false,
          note: `Online payment ${formatEgp(t.amountCents)} received after the order was ${o.status} (Paymob txn ${t.transactionId}) — needs a refund decision`,
          metadata: { paymob: { transactionId: t.transactionId, amountCents: t.amountCents, late: true } },
        });
        return { ok: true, action: 'paid_late' as const, trackingNumber: o.trackingNumber };
      }
      await tx
        .update(orders)
        .set({ paymentMethod: 'PREPAID', collectCents: 0, metadata: { ...(o.metadata ?? {}), payment: { ...pay, status: 'PAID', transactionId: t.transactionId, paidAt } } })
        .where(and(eq(orders.id, o.id)));
      await this.ledger.post(tx, {
        kind: 'COD_COLLECTED',
        reference: `payment:${o.id}`,
        description: `Online payment for ${o.trackingNumber} (Paymob ${t.transactionId})`,
        orderId: o.id,
        metadata: { provider: 'paymob', transactionId: t.transactionId },
        lines: [
          { account: { company: 'PAYMENT_GATEWAY' }, debit: t.amountCents },
          { account: { brandWallet: o.brandId }, credit: t.amountCents },
        ],
      });
      await tx.insert(orderEvents).values({
        orderId: o.id, status: o.status, fromStatus: o.status, actorType: 'SYSTEM', actorName: 'Paymob', isPublic: false,
        note: `Paid online ${formatEgp(t.amountCents)} (Paymob txn ${t.transactionId}) — nothing to collect on delivery`,
        metadata: { paymob: { transactionId: t.transactionId, amountCents: t.amountCents } },
      });
      return { ok: true, action: 'paid' as const, trackingNumber: o.trackingNumber };
    });
  }

  private async loadOrder(p: Principal, id: string) {
    const scope = brandScope(p);
    const [row] = await this.db
      .select({ order: orders, brandName: brands.name, zoneName: zones.nameEn })
      .from(orders)
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .leftJoin(zones, eq(zones.id, orders.zoneId))
      .where(scope ? and(eq(orders.id, id), eq(orders.brandId, scope)) : eq(orders.id, id))
      .limit(1);
    if (!row) throw notFound('Order', id);
    return { ...row.order, brandName: row.brandName, zoneName: row.zoneName ?? 'Cairo' };
  }
}

export function paymentOf(metadata: Record<string, unknown> | null | undefined): PaymentMeta | null {
  const p = metadata?.payment as PaymentMeta | undefined;
  return p && typeof p === 'object' && p.provider === 'paymob' ? p : null;
}
