import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, like, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { LedgerTxKind } from '@goturtle/shared';
import type { DbOrTx } from '../../db/client';
import { brandAdvances, ledgerAccounts, ledgerEntries, ledgerTransactions, orders, settlements } from '../../db/schema';
import { PostingsService } from '../../core/ledger/postings.service';
import { CompanyAccounts, describeRef } from '../../core/ledger/accounts';
import { toNumber } from '../couriers/workforce.util';

type SettlementRow = typeof settlements.$inferSelect;

/** Wallet credits that are the order's collected money (cash, digital, online prepayment). */
export const COD_KINDS: LedgerTxKind[] = ['COD_COLLECTED', 'DIGITAL_COLLECTION'];
/**
 * Order-linked wallet movements that are NOT part of the order's own net
 * (cod − fees): they are paid out as settlement adjustments instead.
 */
export const ADJUSTMENT_KINDS: LedgerTxKind[] = ['CLAIM_PAYOUT'];
/** Unsettled orders whose wallet movements are netted as adjustments instead of waiting for the order. */
const NEVER_SETTLED: Array<(typeof orders.$inferSelect)['status']> = ['LOST'];
const OPEN_SETTLEMENT: SettlementRow['status'][] = ['DRAFT', 'APPROVED'];

export interface AdjustmentLine {
  kind: LedgerTxKind | 'OTHER';
  reference: string | null;
  description: string;
  orderId: string | null;
  amountCents: number;
  createdAt: Date | null;
}

/**
 * Settlement netting — the brand is never paid twice, and never paid less.
 *
 * Every brand-wallet movement belongs to exactly one of:
 *   (a) an order's own net (COD credits − fee debits ± fee corrections), settled with that order;
 *   (b) everything else — early payouts, COD-advance fees and recoveries, claims, corrections
 *       on orders that were already paid out, LOST orders — the "residual".
 *
 * At generation the residual is computed from balances, not from a list:
 *   residual = wallet balance − Σ open settlements' net − Σ net of orders still waiting to settle
 * so it always contains exactly what no settlement has paid yet. It becomes the
 * settlement's adjustmentsCents (negative residuals are capped so a settlement
 * never pays less than zero for orders that are in profit; the remainder simply
 * stays in the wallet for the next settlement). Outstanding COD advances are
 * recovered from the wallet first (ADVANCE_RECOVERY), within what the
 * settlement can absorb.
 */
@Injectable()
export class SettlementNettingService {
  constructor(private readonly postings: PostingsService) {}

  /** Locks the brand wallet account row (null when the brand never had a wallet movement). */
  async lockWallet(tx: DbOrTx, brandId: string) {
    const code = describeRef({ brandWallet: brandId }).code;
    const [w] = await tx.select({ id: ledgerAccounts.id, balanceCents: ledgerAccounts.balanceCents }).from(ledgerAccounts).where(eq(ledgerAccounts.code, code)).for('update').limit(1);
    return w ?? null;
  }

  /** Order part of a settlement straight from the ledger: COD, fees (incl. VAT and corrections) and VAT. */
  async orderTotals(tx: DbOrTx, settlementId: string, brandId: string) {
    const walletCode = describeRef({ brandWallet: brandId }).code;
    const isWallet = sql`${ledgerAccounts.code} = ${walletCode}`;
    const isCod = inArray(ledgerTransactions.kind, COD_KINDS);
    const [[ord], [led]] = await Promise.all([
      tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(orders).where(eq(orders.settlementId, settlementId)),
      tx
        .select({
          cod: sql<number>`coalesce(sum(case when ${isWallet} and ${isCod} then ${ledgerEntries.creditCents} else 0 end), 0)`.mapWith(Number),
          walletDebits: sql<number>`coalesce(sum(case when ${isWallet} then ${ledgerEntries.debitCents} else 0 end), 0)`.mapWith(Number),
          otherCredits: sql<number>`coalesce(sum(case when ${isWallet} and not ${isCod} then ${ledgerEntries.creditCents} else 0 end), 0)`.mapWith(Number),
          vat: sql<number>`coalesce(sum(case when ${ledgerAccounts.code} = ${CompanyAccounts.VAT_PAYABLE.code} then ${ledgerEntries.creditCents} - ${ledgerEntries.debitCents} else 0 end), 0)`.mapWith(Number),
        })
        .from(ledgerEntries)
        .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
        .innerJoin(orders, eq(orders.id, ledgerTransactions.orderId))
        .where(and(eq(orders.settlementId, settlementId), notInArray(ledgerTransactions.kind, ADJUSTMENT_KINDS))),
    ]);
    const codCollectedCents = toNumber(led?.cod);
    const feesCents = toNumber(led?.walletDebits) - toNumber(led?.otherCredits);
    return { ordersCount: Number(ord?.n ?? 0), codCollectedCents, feesCents, vatCents: toNumber(led?.vat), netCents: codCollectedCents - feesCents };
  }

  /** Per-order COD and fees of a settlement (same rules as orderTotals). */
  async orderLines(db: DbOrTx, settlementId: string, brandId: string) {
    const walletCode = describeRef({ brandWallet: brandId }).code;
    const isCod = inArray(ledgerTransactions.kind, COD_KINDS);
    const rows = await db
      .select({
        orderId: ledgerTransactions.orderId,
        cod: sql<number>`coalesce(sum(case when ${isCod} then ${ledgerEntries.creditCents} else 0 end), 0)`.mapWith(Number),
        fees: sql<number>`coalesce(sum(${ledgerEntries.debitCents}), 0) - coalesce(sum(case when not ${isCod} then ${ledgerEntries.creditCents} else 0 end), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .innerJoin(orders, eq(orders.id, ledgerTransactions.orderId))
      .where(and(eq(orders.settlementId, settlementId), eq(ledgerAccounts.code, walletCode), notInArray(ledgerTransactions.kind, ADJUSTMENT_KINDS)))
      .groupBy(ledgerTransactions.orderId);
    return new Map(rows.map((r) => [r.orderId!, { codCents: toNumber(r.cod), feesCents: toNumber(r.fees) }]));
  }

  /**
   * What no settlement has paid yet: wallet − open settlements − orders still
   * waiting to settle. `excludeSettlementId` leaves a settlement out of the
   * open total (the one being computed).
   */
  async residual(tx: DbOrTx, brandId: string, wallet: { id: string; balanceCents: number } | null, excludeSettlementId?: string) {
    if (!wallet) {
      const openNetCents = await this.openNet(tx, brandId, excludeSettlementId);
      return { walletCents: 0, openNetCents, pendingNetCents: 0, residualCents: -openNetCents };
    }
    const [openNetCents, [pending]] = await Promise.all([
      this.openNet(tx, brandId, excludeSettlementId),
      tx
        .select({ net: sql<number>`coalesce(sum(${ledgerEntries.creditCents}) - sum(${ledgerEntries.debitCents}), 0)`.mapWith(Number) })
        .from(ledgerEntries)
        .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
        .innerJoin(orders, eq(orders.id, ledgerTransactions.orderId))
        .where(
          and(
            eq(ledgerEntries.accountId, wallet.id),
            eq(orders.brandId, brandId),
            isNull(orders.settlementId),
            notInArray(orders.status, NEVER_SETTLED),
            notInArray(ledgerTransactions.kind, ADJUSTMENT_KINDS),
          ),
        ),
    ]);
    const pendingNetCents = toNumber(pending?.net);
    return { walletCents: wallet.balanceCents, openNetCents, pendingNetCents, residualCents: wallet.balanceCents - openNetCents - pendingNetCents };
  }

  async openNet(tx: DbOrTx, brandId: string, excludeSettlementId?: string) {
    const [row] = await tx
      .select({ s: sql<number>`coalesce(sum(${settlements.netPayableCents}), 0)`.mapWith(Number) })
      .from(settlements)
      .where(and(eq(settlements.brandId, brandId), inArray(settlements.status, OPEN_SETTLEMENT), excludeSettlementId ? ne(settlements.id, excludeSettlementId) : undefined));
    return toNumber(row?.s);
  }

  /**
   * Recovers outstanding COD advances (oldest first) from the wallet, at most
   * `capacityCents` in total. Returns what was recovered.
   */
  async recoverAdvances(tx: DbOrTx, brandId: string, settlementId: string, capacityCents: number, actorId: string | null): Promise<number> {
    if (capacityCents <= 0) return 0;
    const open = await tx
      .select()
      .from(brandAdvances)
      .where(and(eq(brandAdvances.brandId, brandId), eq(brandAdvances.type, 'COD_ADVANCE'), eq(brandAdvances.status, 'PAID'), gt(brandAdvances.amountCents, brandAdvances.recoveredCents)))
      .orderBy(asc(brandAdvances.paidAt), asc(brandAdvances.id))
      .for('update');
    let left = capacityCents;
    let recovered = 0;
    const now = new Date();
    for (const a of open) {
      if (left <= 0) break;
      const take = Math.min(left, a.amountCents - a.recoveredCents);
      await this.postings.advanceRecovery(tx, { advanceId: a.id, code: a.code, brandId, settlementId, amountCents: take }, actorId);
      const full = a.recoveredCents + take === a.amountCents;
      await tx
        .update(brandAdvances)
        .set({ recoveredCents: a.recoveredCents + take, ...(full ? { status: 'RECOVERED' as const, recoveredAt: now } : {}) })
        .where(eq(brandAdvances.id, a.id));
      left -= take;
      recovered += take;
    }
    return recovered;
  }

  /** Adjustment amount for a residual: positives in full, negatives capped by the order part when it is in profit. */
  static adjustmentFor(residualCents: number, orderNetCents: number): number {
    return residualCents >= 0 ? residualCents : Math.max(residualCents, -Math.max(orderNetCents, 0));
  }

  /**
   * Statement lines behind a settlement's adjustmentsCents: its own advance
   * recoveries plus the non-order wallet movements posted since the previous
   * settlement was generated; anything else (corrections on already-paid
   * orders, carried balances) is shown as one OTHER line so the lines always
   * add up to adjustmentsCents exactly.
   */
  async adjustmentLines(db: DbOrTx, s: SettlementRow): Promise<AdjustmentLine[]> {
    if (s.status === 'CANCELLED') return [];
    const walletCode = describeRef({ brandWallet: s.brandId }).code;
    const [prev] = await db
      .select({ createdAt: settlements.createdAt })
      .from(settlements)
      .where(and(eq(settlements.brandId, s.brandId), ne(settlements.status, 'CANCELLED'), ne(settlements.id, s.id), lt(settlements.createdAt, s.createdAt)))
      .orderBy(desc(settlements.createdAt))
      .limit(1);
    const inWindow = and(
      prev ? gt(ledgerTransactions.createdAt, prev.createdAt) : undefined,
      lte(ledgerTransactions.createdAt, s.createdAt),
      ne(ledgerTransactions.kind, 'BRAND_PAYOUT'),
      sql`${ledgerTransactions.reference} not like 'settlement:%'`,
      or(isNull(ledgerTransactions.orderId), inArray(ledgerTransactions.kind, ADJUSTMENT_KINDS)),
    );
    const rows = await db
      .select({
        kind: ledgerTransactions.kind,
        reference: ledgerTransactions.reference,
        description: ledgerTransactions.description,
        orderId: ledgerTransactions.orderId,
        createdAt: ledgerTransactions.createdAt,
        amount: sql<number>`coalesce(sum(${ledgerEntries.creditCents}) - sum(${ledgerEntries.debitCents}), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .where(and(eq(ledgerAccounts.code, walletCode), or(like(ledgerTransactions.reference, `settlement:${s.id}:%`), inWindow)))
      .groupBy(ledgerTransactions.id)
      .orderBy(asc(ledgerTransactions.createdAt));
    const lines: AdjustmentLine[] = rows
      .map((r) => ({ kind: r.kind, reference: r.reference, description: r.description, orderId: r.orderId, amountCents: toNumber(r.amount), createdAt: r.createdAt }))
      .filter((l) => l.amountCents !== 0);
    const other = s.adjustmentsCents - lines.reduce((sum, l) => sum + l.amountCents, 0);
    if (other !== 0) lines.push({ kind: 'OTHER', reference: null, description: 'Other wallet movements & balance carried between settlements', orderId: null, amountCents: other, createdAt: null });
    return lines;
  }
}
