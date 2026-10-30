import { Injectable } from '@nestjs/common';
import type { AdjustmentType, HandoverMethod, PayoutMethod } from '@goturtle/shared';
import type { DbOrTx } from '../../db/client';
import type { couriers, orders } from '../../db/schema';
import { LedgerService } from './ledger.service';
import type { CompanyAccountKey } from './accounts';

type OrderRow = typeof orders.$inferSelect;
type CourierRow = typeof couriers.$inferSelect;

/** Where incoming money lands for a given handover / payout method. */
const cashAccountFor = (method: HandoverMethod | PayoutMethod | null | undefined): CompanyAccountKey =>
  method === 'CASH' || method === 'CASH_AT_HUB' ? 'TREASURY' : 'BANK';

/**
 * The business postings. Each one is idempotent through its reference, so
 * retries (and double-clicks) never double-count money.
 */
@Injectable()
export class PostingsService {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * Order delivered: hero now holds the collected cash (owed to the brand),
   * the brand is charged the order fees and the hero earns the delivery rate.
   */
  async orderDelivered(tx: DbOrTx, order: OrderRow, courier: CourierRow | null, actorId?: string | null) {
    const collected = order.collectedCents;
    if (collected > 0) {
      if (!courier) throw new Error('A courier is required to post collected cash');
      await this.ledger.post(tx, {
        kind: 'COD_COLLECTED',
        reference: `order:${order.id}:cod`,
        description: `COD collected for ${order.trackingNumber}`,
        orderId: order.id,
        createdById: actorId,
        lines: [
          { account: { courierCustody: courier.id }, debit: collected },
          { account: { brandWallet: order.brandId }, credit: collected },
        ],
      });
    }
    await this.orderFees(tx, order, actorId);
    if (courier && courier.perDeliveryRateCents > 0) {
      await this.courierEarning(tx, courier.id, courier.perDeliveryRateCents, `order:${order.id}:earning:delivery`, `Delivery ${order.trackingNumber}`, order.id);
    }
  }

  /** Charges the order's fees to the brand wallet (shipping/extra → 4000, COD fee → 4010, VAT → 2300). */
  async orderFees(tx: DbOrTx, order: OrderRow, actorId?: string | null, opts: { excludeCodFee?: boolean } = {}) {
    const codFee = opts.excludeCodFee ? 0 : order.codFeeCents;
    const shipping = order.shippingFeeCents + order.extraFeesCents;
    // When the COD fee is waived (returns), VAT is recomputed proportionally.
    const vat = opts.excludeCodFee && order.shippingFeeCents + order.extraFeesCents + order.codFeeCents > 0
      ? Math.round((order.vatCents * shipping) / (shipping + order.codFeeCents))
      : order.vatCents;
    const total = shipping + codFee + vat;
    if (total <= 0) return;
    await this.ledger.post(tx, {
      kind: 'ORDER_FEES',
      reference: `order:${order.id}:fees`,
      description: `Fees for ${order.trackingNumber}`,
      orderId: order.id,
      createdById: actorId,
      lines: [
        { account: { brandWallet: order.brandId }, debit: total },
        { account: { company: 'REVENUE_SHIPPING' }, credit: shipping },
        { account: { company: 'REVENUE_COD_FEES' }, credit: codFee },
        { account: { company: 'VAT_PAYABLE' }, credit: vat },
      ],
    });
  }

  /** Returned to origin: shipping fees (without COD fee) + return fee incl. VAT. */
  async orderReturned(tx: DbOrTx, order: OrderRow, returnFeeCents: number, returnFeeVatCents: number, actorId?: string | null) {
    await this.orderFees(tx, order, actorId, { excludeCodFee: true });
    if (returnFeeCents + returnFeeVatCents > 0) {
      await this.ledger.post(tx, {
        kind: 'ORDER_FEES',
        reference: `order:${order.id}:return_fee`,
        description: `Return fee for ${order.trackingNumber}`,
        orderId: order.id,
        createdById: actorId,
        lines: [
          { account: { brandWallet: order.brandId }, debit: returnFeeCents + returnFeeVatCents },
          { account: { company: 'REVENUE_RETURNS' }, credit: returnFeeCents },
          { account: { company: 'VAT_PAYABLE' }, credit: returnFeeVatCents },
        ],
      });
    }
  }

  /** Small payout for a failed attempt (the hero still drove there). */
  async failedAttemptEarning(tx: DbOrTx, order: OrderRow, courier: CourierRow, attemptNo: number) {
    if (courier.failedAttemptRateCents <= 0) return;
    await this.courierEarning(tx, courier.id, courier.failedAttemptRateCents, `order:${order.id}:earning:attempt:${attemptNo}`, `Failed attempt ${attemptNo} on ${order.trackingNumber}`, order.id);
  }

  async pickupEarning(tx: DbOrTx, pickupId: string, pickupCode: string, courier: CourierRow) {
    if (courier.perPickupRateCents <= 0) return;
    await this.courierEarning(tx, courier.id, courier.perPickupRateCents, `pickup:${pickupId}:earning`, `Pickup ${pickupCode}`);
  }

  /** Hourly pay for a completed shift. */
  async shiftEarning(tx: DbOrTx, shiftId: string, courierId: string, amountCents: number) {
    if (amountCents <= 0) return;
    await this.courierEarning(tx, courierId, amountCents, `shift:${shiftId}:earning`, 'Shift hours');
  }

  async courierEarning(tx: DbOrTx, courierId: string, amountCents: number, reference: string, description: string, orderId?: string) {
    await this.ledger.post(tx, {
      kind: 'COURIER_EARNING',
      reference,
      description,
      orderId,
      lines: [
        { account: { company: 'EXPENSE_COURIER_PAY' }, debit: amountCents },
        { account: { courierPayable: courierId }, credit: amountCents },
      ],
    });
  }

  /** Finance confirmed cash/transfer from a hero: custody goes down by what was actually received. */
  async cashHandover(tx: DbOrTx, h: { id: string; code: string; courierId: string; method: HandoverMethod; receivedCents: number }, actorId?: string | null) {
    if (h.receivedCents <= 0) return;
    await this.ledger.post(tx, {
      kind: 'CASH_HANDOVER',
      reference: `handover:${h.id}`,
      description: `Cash handover ${h.code}`,
      createdById: actorId,
      lines: [
        { account: { company: cashAccountFor(h.method) }, debit: h.receivedCents },
        { account: { courierCustody: h.courierId }, credit: h.receivedCents },
      ],
    });
  }

  /** Brand settlement paid. Positive = we pay the brand; negative = the brand paid us. */
  async brandPayout(tx: DbOrTx, s: { id: string; code: string; brandId: string; netPayableCents: number; method: PayoutMethod | null }, actorId?: string | null) {
    const amt = Math.abs(s.netPayableCents);
    if (!amt) return;
    const cash = cashAccountFor(s.method);
    await this.ledger.post(tx, {
      kind: 'BRAND_PAYOUT',
      reference: `settlement:${s.id}`,
      description: `Settlement ${s.code}`,
      createdById: actorId,
      lines:
        s.netPayableCents > 0
          ? [{ account: { brandWallet: s.brandId }, debit: amt }, { account: { company: cash }, credit: amt }]
          : [{ account: { company: cash }, debit: amt }, { account: { brandWallet: s.brandId }, credit: amt }],
    });
  }

  async courierPayout(tx: DbOrTx, p: { id: string; code: string; courierId: string; netCents: number; method: PayoutMethod | null }, actorId?: string | null) {
    if (p.netCents <= 0) return;
    await this.ledger.post(tx, {
      kind: 'COURIER_PAYOUT',
      reference: `payout:${p.id}`,
      description: `Hero payout ${p.code}`,
      createdById: actorId,
      lines: [
        { account: { courierPayable: p.courierId }, debit: p.netCents },
        { account: { company: cashAccountFor(p.method) }, credit: p.netCents },
      ],
    });
  }

  /** Bonuses, penalties, cash shortages, advances and reimbursements for heroes. */
  async courierAdjustment(tx: DbOrTx, a: { id: string; courierId: string; type: AdjustmentType; amountCents: number; reason: string }, actorId?: string | null) {
    const amt = a.amountCents;
    const hero = { courierPayable: a.courierId };
    const lines = {
      BONUS: [{ account: { company: 'EXPENSE_COURIER_PAY' as const }, debit: amt }, { account: hero, credit: amt }],
      REIMBURSEMENT: [{ account: { company: 'EXPENSE_OPERATIONS' as const }, debit: amt }, { account: hero, credit: amt }],
      PENALTY: [{ account: hero, debit: amt }, { account: { company: 'REVENUE_OTHER' as const }, credit: amt }],
      ADVANCE: [{ account: hero, debit: amt }, { account: { company: 'BANK' as const }, credit: amt }],
      // Shortage: the cash the hero failed to hand over is deducted from earnings.
      CASH_SHORTAGE: [{ account: hero, debit: amt }, { account: { courierCustody: a.courierId }, credit: amt }],
    }[a.type];
    await this.ledger.post(tx, {
      kind: 'COURIER_ADJUSTMENT',
      reference: `adjustment:${a.id}`,
      description: `${a.type}: ${a.reason}`,
      createdById: actorId,
      lines,
    });
  }
}
