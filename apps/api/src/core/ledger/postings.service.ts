import { HttpStatus, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { AdjustmentType, AdvanceType, CollectionMethod, HandoverMethod, LedgerTxKind, PayoutMethod } from '@goturtle/shared';
import type { DbOrTx } from '../../db/client';
import { ledgerAccounts, ledgerEntries, ledgerTransactions, type couriers, type orders } from '../../db/schema';
import { DomainError } from '../../common/errors';
import { LedgerService } from './ledger.service';
import { CompanyAccounts, type AccountRef, type CompanyAccountKey } from './accounts';

type OrderRow = typeof orders.$inferSelect;
type CourierRow = typeof couriers.$inferSelect;

/** Where incoming money lands for a given handover / payout method. */
const cashAccountFor = (method: HandoverMethod | PayoutMethod | null | undefined): CompanyAccountKey =>
  method === 'CASH' || method === 'CASH_AT_HUB' ? 'TREASURY' : 'BANK';

/**
 * How the recipient paid at the door (TransitionOptions.extensions.collection,
 * normalised by the money-programs guard). Non-cash money never reaches the
 * hero's custody: it waits in 1030 Digital clearing until finance confirms it,
 * or lands directly in 1020 Payment gateway when the door payment link was
 * already paid.
 */
export interface DoorCollection {
  method: CollectionMethod;
  reference?: string | null;
  /** PAYMENT_LINK already confirmed by the gateway before the delivery was recorded. */
  gatewayPaid?: boolean;
}

/** Maps a ledger account code back to the reference LedgerService.post() understands. */
function refOfAccount(code: string): AccountRef {
  const [base, owner, id] = code.split(':');
  if (owner === 'BRAND' && base === '2100') return { brandWallet: id };
  if (owner === 'BRAND' && base === '1300') return { brandAdvance: id };
  if (owner === 'HERO' && base === '1100') return { courierCustody: id };
  if (owner === 'HERO' && base === '2200') return { courierPayable: id };
  const key = (Object.keys(CompanyAccounts) as CompanyAccountKey[]).find((k) => CompanyAccounts[k].code === code);
  if (!key) throw new Error(`Unknown ledger account ${code}`);
  return { company: key };
}

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
  async orderDelivered(tx: DbOrTx, order: OrderRow, courier: CourierRow | null, actorId?: string | null, collection?: DoorCollection | null) {
    const collected = order.collectedCents;
    if (collected > 0 && collection && collection.method !== 'CASH') {
      // Digital payment at the door: the brand is owed the money, the hero holds nothing.
      await this.ledger.post(tx, {
        kind: 'DIGITAL_COLLECTION',
        reference: `order:${order.id}:cod`,
        description: `${collection.method} collected for ${order.trackingNumber}${collection.reference ? ` (ref ${collection.reference})` : ''}`,
        orderId: order.id,
        createdById: actorId,
        metadata: { method: collection.method, reference: collection.reference ?? null, gatewayPaid: !!collection.gatewayPaid },
        lines: [
          { account: { company: collection.gatewayPaid ? 'PAYMENT_GATEWAY' : 'DIGITAL_CLEARING' }, debit: collected },
          { account: { brandWallet: order.brandId }, credit: collected },
        ],
      });
    } else if (collected > 0) {
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

  // ---------------------------------------------------------------- money programs (v1.1)

  /** Finance (or the gateway webhook) confirmed a digital collection: clearing → bank / gateway. */
  async digitalCollectionConfirmed(
    tx: DbOrTx,
    order: Pick<OrderRow, 'id' | 'trackingNumber' | 'collectedCents'>,
    via: 'BANK' | 'PAYMENT_GATEWAY',
    actorId?: string | null,
    bankReference?: string | null,
  ) {
    await this.ledger.post(tx, {
      kind: 'DIGITAL_COLLECTION',
      reference: `order:${order.id}:collection:confirmed`,
      description: `Digital collection confirmed for ${order.trackingNumber}${bankReference ? ` (ref ${bankReference})` : ''}`,
      orderId: order.id,
      createdById: actorId,
      metadata: { via, reference: bankReference ?? null },
      lines: [
        { account: { company: via }, debit: order.collectedCents },
        { account: { company: 'DIGITAL_CLEARING' }, credit: order.collectedCents },
      ],
    });
  }

  /** The transfer never arrived: the hero now owes it as cash (custody goes up by the amount). */
  async digitalCollectionRejected(tx: DbOrTx, order: Pick<OrderRow, 'id' | 'trackingNumber' | 'collectedCents'>, courierId: string, actorId?: string | null) {
    await this.ledger.post(tx, {
      kind: 'DIGITAL_COLLECTION',
      reference: `order:${order.id}:collection:rejected`,
      description: `Digital collection rejected for ${order.trackingNumber} — moved to hero cash custody`,
      orderId: order.id,
      createdById: actorId,
      lines: [
        { account: { courierCustody: courierId }, debit: order.collectedCents },
        { account: { company: 'DIGITAL_CLEARING' }, credit: order.collectedCents },
      ],
    });
  }

  /**
   * Brand advance paid out.
   *  EARLY_PAYOUT: Dr brand wallet (amount + fee) / Cr cash (amount) / Cr 4030 finance fees (fee).
   *  COD_ADVANCE:  Dr 1300 brand advance (amount) / Cr cash (amount), and the fee Dr brand wallet / Cr 4030.
   */
  async brandAdvancePaid(
    tx: DbOrTx,
    a: { id: string; code: string; brandId: string; type: AdvanceType; amountCents: number; feeCents: number; method: PayoutMethod | null },
    actorId?: string | null,
  ) {
    const cash = cashAccountFor(a.method);
    const lines: Array<{ account: AccountRef; debit?: number; credit?: number }> =
      a.type === 'EARLY_PAYOUT'
        ? [
            { account: { brandWallet: a.brandId }, debit: a.amountCents + a.feeCents },
            { account: { company: cash }, credit: a.amountCents },
            { account: { company: 'REVENUE_FINANCE' }, credit: a.feeCents },
          ]
        : [
            { account: { brandAdvance: a.brandId }, debit: a.amountCents },
            { account: { company: cash }, credit: a.amountCents },
            { account: { brandWallet: a.brandId }, debit: a.feeCents },
            { account: { company: 'REVENUE_FINANCE' }, credit: a.feeCents },
          ];
    await this.ledger.post(tx, {
      kind: 'BRAND_ADVANCE',
      reference: `advance:${a.id}:paid`,
      description: a.type === 'EARLY_PAYOUT' ? `Early payout ${a.code} (fee included)` : `COD advance ${a.code} (fee charged to the wallet)`,
      createdById: actorId,
      metadata: { advanceId: a.id, type: a.type, amountCents: a.amountCents, feeCents: a.feeCents },
      lines,
    });
  }

  /** Part (or all) of a COD advance recovered from the brand wallet while a settlement is generated. */
  async advanceRecovery(tx: DbOrTx, r: { advanceId: string; code: string; brandId: string; settlementId: string; amountCents: number }, actorId?: string | null) {
    if (r.amountCents <= 0) return;
    await this.ledger.post(tx, {
      kind: 'ADVANCE_RECOVERY',
      reference: `settlement:${r.settlementId}:recovery:${r.advanceId}`,
      description: `COD advance ${r.code} recovered`,
      createdById: actorId,
      metadata: { advanceId: r.advanceId, settlementId: r.settlementId },
      lines: [
        { account: { brandWallet: r.brandId }, debit: r.amountCents },
        { account: { brandAdvance: r.brandId }, credit: r.amountCents },
      ],
    });
  }

  /** Approved claim paid into the brand wallet (paid out with the next settlement). */
  async claimPayout(tx: DbOrTx, c: { id: string; code: string; brandId: string; orderId: string; approvedCents: number }, actorId?: string | null) {
    if (c.approvedCents <= 0) return;
    await this.ledger.post(tx, {
      kind: 'CLAIM_PAYOUT',
      reference: `claim:${c.id}:payout`,
      description: `Claim ${c.code} paid`,
      orderId: c.orderId,
      createdById: actorId,
      metadata: { claimId: c.id },
      lines: [
        { account: { company: 'EXPENSE_CLAIMS' }, debit: c.approvedCents },
        { account: { brandWallet: c.brandId }, credit: c.approvedCents },
      ],
    });
  }

  /** Hub weighing re-priced the order: the extra weight fee and its VAT are charged to the brand. */
  async weightAdjustment(
    tx: DbOrTx,
    order: Pick<OrderRow, 'id' | 'trackingNumber' | 'brandId'>,
    a: { feeCents: number; vatCents: number; billableGrams: number },
    actorId?: string | null,
  ) {
    if (a.feeCents + a.vatCents <= 0) return;
    await this.ledger.post(tx, {
      kind: 'FEE_ADJUSTMENT',
      reference: `order:${order.id}:weight_adjustment`,
      description: `Weight re-pricing for ${order.trackingNumber} (${(a.billableGrams / 1000).toFixed(2)} kg billable)`,
      orderId: order.id,
      createdById: actorId,
      metadata: { billableGrams: a.billableGrams, feeCents: a.feeCents, vatCents: a.vatCents },
      lines: [
        { account: { brandWallet: order.brandId }, debit: a.feeCents + a.vatCents },
        { account: { company: 'REVENUE_SHIPPING' }, credit: a.feeCents },
        { account: { company: 'VAT_PAYABLE' }, credit: a.vatCents },
      ],
    });
  }

  /** Weight dispute upheld: the exact mirror of the re-pricing posting. */
  async weightAdjustmentReversal(tx: DbOrTx, order: Pick<OrderRow, 'id' | 'trackingNumber'>, actorId?: string | null) {
    await this.reverseTransaction(tx, `order:${order.id}:weight_adjustment`, {
      kind: 'FEE_REVERSAL',
      reference: `order:${order.id}:weight_adjustment:reversal`,
      description: `Weight re-pricing reversed for ${order.trackingNumber} (dispute upheld)`,
      orderId: order.id,
      createdById: actorId,
    });
  }

  /** Posts the exact mirror (debits ↔ credits) of an existing transaction. */
  private async reverseTransaction(
    tx: DbOrTx,
    originalReference: string,
    input: { kind: LedgerTxKind; reference: string; description: string; orderId?: string | null; createdById?: string | null },
  ) {
    const entries = await tx
      .select({ code: ledgerAccounts.code, debitCents: ledgerEntries.debitCents, creditCents: ledgerEntries.creditCents })
      .from(ledgerEntries)
      .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .where(eq(ledgerTransactions.reference, originalReference));
    if (!entries.length) throw new DomainError('NOT_POSTED', `Nothing was posted under ${originalReference}`, HttpStatus.CONFLICT);
    await this.ledger.post(tx, {
      ...input,
      metadata: { reverses: originalReference },
      lines: entries.map((e) => ({ account: refOfAccount(e.code), debit: e.creditCents, credit: e.debitCents })),
    });
  }
}
