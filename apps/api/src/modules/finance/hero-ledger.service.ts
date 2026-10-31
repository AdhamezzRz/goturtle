import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client';
import { courierAdjustments, ledgerAccounts, ledgerEntries, ledgerTransactions, orders } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { describeRef } from '../../core/ledger/accounts';
import { toNumber } from '../couriers/workforce.util';

/** What a line on a hero's earnings account (2200:HERO:<id>) is about. */
export const HERO_LEDGER_CATEGORIES = [
  'delivery', 'attempt', 'pickup', 'shift', 'salary', 'other_earning',
  'bonus', 'reimbursement', 'penalty', 'cash_shortage', 'advance', 'payout', 'other',
] as const;
export type HeroLedgerCategory = (typeof HERO_LEDGER_CATEGORIES)[number];

export type CategoryTotals = Record<HeroLedgerCategory, { count: number; creditsCents: number; debitsCents: number; netCents: number }>;

/**
 * Category of a payable-account line, from the transaction reference set by
 * PostingsService (order:<id>:earning:delivery, …:attempt:<n>, pickup:<id>:earning,
 * shift:<id>:earning, salary:…, payout:<id>, adjustment:<id> → adjustment type).
 */
function categorySql() {
  return sql<string>`case
    when ${ledgerTransactions.reference} like 'order:%:earning:delivery' then 'delivery'
    when ${ledgerTransactions.reference} like 'order:%:earning:attempt:%' then 'attempt'
    when ${ledgerTransactions.reference} like 'pickup:%' then 'pickup'
    when ${ledgerTransactions.reference} like 'shift:%' then 'shift'
    when ${ledgerTransactions.reference} like 'salary:%' then 'salary'
    when ${ledgerTransactions.reference} like 'payout:%' then 'payout'
    when ${courierAdjustments.type} is not null then lower(${courierAdjustments.type})
    when ${ledgerTransactions.kind} = 'COURIER_EARNING' then 'other_earning'
    else 'other' end`;
}

export const emptyTotals = (): CategoryTotals =>
  Object.fromEntries(HERO_LEDGER_CATEGORIES.map((c) => [c, { count: 0, creditsCents: 0, debitsCents: 0, netCents: 0 }])) as CategoryTotals;

/** Read model over a hero's earnings payable account. */
@Injectable()
export class HeroLedgerService {
  constructor(@InjectDb() private readonly db: Db) {}

  payableCode(courierId: string) {
    return describeRef({ courierPayable: courierId }).code;
  }

  private async accountId(courierId: string, tx: DbOrTx = this.db): Promise<string | null> {
    const [a] = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(eq(ledgerAccounts.code, this.payableCode(courierId))).limit(1);
    return a?.id ?? null;
  }

  /** What GoTurtle owes the hero right now (negative = the hero owes GoTurtle). */
  async balance(courierId: string, tx: DbOrTx = this.db): Promise<number> {
    const [a] = await tx.select({ b: ledgerAccounts.balanceCents }).from(ledgerAccounts).where(eq(ledgerAccounts.code, this.payableCode(courierId))).limit(1);
    return a?.b ?? 0;
  }

  /** Sums per category for entries in [start, end). Net = credits − debits (what the hero gained). */
  async totals(courierId: string, start: Date, end: Date, tx: DbOrTx = this.db): Promise<CategoryTotals> {
    const out = emptyTotals();
    const accountId = await this.accountId(courierId, tx);
    if (!accountId) return out;
    const category = categorySql();
    const rows = await tx
      .select({
        category,
        n: count(),
        credits: sql<number>`coalesce(sum(${ledgerEntries.creditCents}), 0)`.mapWith(Number),
        debits: sql<number>`coalesce(sum(${ledgerEntries.debitCents}), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
      .leftJoin(courierAdjustments, sql`${ledgerTransactions.reference} = concat('adjustment:', ${courierAdjustments.id})`)
      .where(and(eq(ledgerEntries.accountId, accountId), gte(ledgerEntries.createdAt, start), lt(ledgerEntries.createdAt, end)))
      .groupBy(category);
    for (const r of rows) {
      const key = (HERO_LEDGER_CATEGORIES as readonly string[]).includes(r.category) ? (r.category as HeroLedgerCategory) : 'other';
      out[key].count += Number(r.n);
      out[key].creditsCents += toNumber(r.credits);
      out[key].debitsCents += toNumber(r.debits);
      out[key].netCents += toNumber(r.credits) - toNumber(r.debits);
    }
    return out;
  }

  /** Statement lines in [start, end), newest first, with category and tracking number. */
  async lines(courierId: string, start: Date, end: Date, page: { limit: number; offset: number }) {
    const accountId = await this.accountId(courierId);
    if (!accountId) return { total: 0, lines: [] };
    const where = and(eq(ledgerEntries.accountId, accountId), gte(ledgerEntries.createdAt, start), lt(ledgerEntries.createdAt, end));
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({
          id: ledgerEntries.id, createdAt: ledgerEntries.createdAt, debitCents: ledgerEntries.debitCents, creditCents: ledgerEntries.creditCents,
          kind: ledgerTransactions.kind, reference: ledgerTransactions.reference, description: ledgerTransactions.description,
          orderId: ledgerTransactions.orderId, trackingNumber: orders.trackingNumber, category: categorySql(),
        })
        .from(ledgerEntries)
        .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
        .leftJoin(courierAdjustments, sql`${ledgerTransactions.reference} = concat('adjustment:', ${courierAdjustments.id})`)
        .leftJoin(orders, eq(orders.id, ledgerTransactions.orderId))
        .where(where)
        .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ n: count() }).from(ledgerEntries).where(where),
    ]);
    return { total: Number(n), lines: rows.map((r) => ({ ...r, amountCents: r.creditCents - r.debitCents })) };
  }
}

/** Groups category totals into the payout columns. */
export function payoutBreakdown(t: CategoryTotals) {
  const deliveryEarningsCents = t.delivery.netCents + t.attempt.netCents + t.pickup.netCents + t.other_earning.netCents;
  const hourlyEarningsCents = t.shift.netCents;
  const salaryCents = t.salary.netCents;
  const bonusesCents = t.bonus.netCents + t.reimbursement.netCents;
  const deductionsCents = -(t.penalty.netCents + t.cash_shortage.netCents + t.advance.netCents);
  return {
    deliveriesCount: t.delivery.count,
    pickupsCount: t.pickup.count,
    failedAttemptsCount: t.attempt.count,
    deliveryEarningsCents,
    hourlyEarningsCents,
    salaryCents,
    bonusesCents,
    deductionsCents,
    periodNetCents: deliveryEarningsCents + hourlyEarningsCents + salaryCents + bonusesCents - deductionsCents,
  };
}
