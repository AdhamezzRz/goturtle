import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { LedgerAccountType } from '@goturtle/shared';
import type { Db } from '../../db/client';
import {
  brands, cashHandovers, courierPayouts, couriers, deliveryAttempts, ledgerAccounts, ledgerEntries, ledgerTransactions, orders,
  settlements, users,
} from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { LedgerService } from '../../core/ledger/ledger.service';
import { CompanyAccounts, isDebitNormal } from '../../core/ledger/accounts';
import { notFound } from '../../common/errors';
import { cairoToday, loadByIds } from '../../db/helpers';
import { assertDay, cairoDayRange, csvRow, egp, percent, resolveDayRange, toNumber } from '../couriers/workforce.util';

const C = CompanyAccounts;
const REVENUE_CODES = [C.REVENUE_SHIPPING.code, C.REVENUE_COD_FEES.code, C.REVENUE_RETURNS.code, C.REVENUE_OTHER.code];
const EXPENSE_CODES = [C.EXPENSE_COURIER_PAY.code, C.EXPENSE_OPERATIONS.code, C.EXPENSE_CASH_VARIANCE.code];

/** Finance reports over the double-entry ledger. */
@Injectable()
export class FinanceReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ledger: LedgerService,
  ) {}

  /** Trial balance with owner names; Σ debits must equal Σ credits. */
  async trialBalance(includeZero = false) {
    const tb = await this.ledger.trialBalance();
    const accounts = includeZero ? tb.accounts : tb.accounts.filter((a) => a.debits !== 0 || a.credits !== 0 || a.balanceCents !== 0);
    const brandRows = await this.db
      .select({ accountId: ledgerAccounts.id, brandId: ledgerAccounts.brandId, courierId: ledgerAccounts.courierId })
      .from(ledgerAccounts)
      .where(or(isNotNull(ledgerAccounts.brandId), isNotNull(ledgerAccounts.courierId)));
    const heroIds = [...new Set(brandRows.map((r) => r.courierId).filter((v): v is string => !!v))];
    const [brandMap, courierRows] = await Promise.all([
      loadByIds(this.db, brands, brands.id, brandRows.map((r) => r.brandId)),
      heroIds.length
        ? this.db.select({ id: couriers.id, code: couriers.code, name: users.name }).from(couriers).innerJoin(users, eq(users.id, couriers.userId)).where(inArray(couriers.id, heroIds))
        : Promise.resolve([] as Array<{ id: string; code: string; name: string }>),
    ]);
    const heroMap = new Map(courierRows.map((c) => [c.id, c]));
    const owners = new Map(brandRows.map((r) => {
      const b = r.brandId ? brandMap.get(r.brandId) : null;
      const h = r.courierId ? heroMap.get(r.courierId) : null;
      return [r.accountId, b ? { kind: 'brand', id: b.id, code: b.code, name: b.name } : h ? { kind: 'hero', id: h.id, code: h.code, name: h.name } : null];
    }));
    const byType: Record<LedgerAccountType, { debits: number; credits: number; balanceCents: number }> = {
      ASSET: { debits: 0, credits: 0, balanceCents: 0 }, LIABILITY: { debits: 0, credits: 0, balanceCents: 0 }, EQUITY: { debits: 0, credits: 0, balanceCents: 0 },
      REVENUE: { debits: 0, credits: 0, balanceCents: 0 }, EXPENSE: { debits: 0, credits: 0, balanceCents: 0 },
    };
    for (const a of tb.accounts) {
      byType[a.type].debits += a.debits;
      byType[a.type].credits += a.credits;
      byType[a.type].balanceCents += a.balanceCents;
    }
    const left = byType.ASSET.balanceCents + byType.EXPENSE.balanceCents;
    const right = byType.LIABILITY.balanceCents + byType.EQUITY.balanceCents + byType.REVENUE.balanceCents;
    return {
      asOf: new Date(),
      balanced: tb.balanced,
      totalDebits: tb.totalDebits,
      totalCredits: tb.totalCredits,
      equation: { assetsPlusExpenses: left, liabilitiesEquityRevenue: right, balanced: left === right },
      byType,
      accounts: accounts.map((a) => ({
        ...a,
        normalSide: isDebitNormal(a.type) ? 'DEBIT' : 'CREDIT',
        computedBalanceCents: isDebitNormal(a.type) ? a.debits - a.credits : a.credits - a.debits,
        owner: owners.get(a.accountId) ?? null,
      })),
    };
  }

  /** Statement of any account in [from, to] (Cairo days), oldest first, with opening/closing and running balances. */
  async accountStatement(code: string, q: { from?: string; to?: string; page: number; pageSize: number }) {
    const [account] = await this.db.select().from(ledgerAccounts).where(eq(ledgerAccounts.code, code)).limit(1);
    if (!account) throw notFound('Ledger account', code);
    const range = resolveDayRange(q.from, q.to, 30, 3660);
    const sign = isDebitNormal(account.type) ? 1 : -1; // balance delta = sign × (debit − credit)
    const net = sql<number>`coalesce(sum(${ledgerEntries.debitCents} - ${ledgerEntries.creditCents}), 0)`.mapWith(Number);
    const inRange = and(eq(ledgerEntries.accountId, account.id), gte(ledgerEntries.createdAt, range.start), lt(ledgerEntries.createdAt, range.end));

    const [[opening], [period], [{ n }]] = await Promise.all([
      this.db.select({ net }).from(ledgerEntries).where(and(eq(ledgerEntries.accountId, account.id), lt(ledgerEntries.createdAt, range.start))),
      this.db
        .select({
          net,
          debits: sql<number>`coalesce(sum(${ledgerEntries.debitCents}), 0)`.mapWith(Number),
          credits: sql<number>`coalesce(sum(${ledgerEntries.creditCents}), 0)`.mapWith(Number),
        })
        .from(ledgerEntries)
        .where(inRange),
      this.db.select({ n: count() }).from(ledgerEntries).where(inRange),
    ]);
    const rows = await this.db
      .select({
        id: ledgerEntries.id, createdAt: ledgerEntries.createdAt, debitCents: ledgerEntries.debitCents, creditCents: ledgerEntries.creditCents,
        transactionId: ledgerTransactions.id, kind: ledgerTransactions.kind, reference: ledgerTransactions.reference, description: ledgerTransactions.description,
        orderId: ledgerTransactions.orderId, trackingNumber: orders.trackingNumber,
      })
      .from(ledgerEntries)
      .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
      .leftJoin(orders, eq(orders.id, ledgerTransactions.orderId))
      .where(inRange)
      .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    let before = 0;
    if (rows.length && q.page > 1) {
      const first = rows[0];
      const [b] = await this.db
        .select({ net })
        .from(ledgerEntries)
        .where(and(inRange, or(lt(ledgerEntries.createdAt, first.createdAt), and(eq(ledgerEntries.createdAt, first.createdAt), lt(ledgerEntries.id, first.id)))));
      before = toNumber(b?.net);
    }
    const openingBalance = sign * toNumber(opening?.net);
    let running = openingBalance + sign * before;
    const lines = rows.map((r) => {
      const amountCents = sign * (r.debitCents - r.creditCents);
      running += amountCents;
      return { ...r, amountCents, balanceCents: running };
    });
    const total = Number(n);
    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type, brandId: account.brandId, courierId: account.courierId, balanceCents: account.balanceCents },
      from: range.from,
      to: range.to,
      openingBalanceCents: openingBalance,
      closingBalanceCents: openingBalance + sign * toNumber(period?.net),
      totals: { debitsCents: toNumber(period?.debits), creditsCents: toNumber(period?.credits) },
      data: lines,
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    };
  }

  /** CSV of a whole statement range (max 20k lines). */
  async statementCsv(code: string, q: { from?: string; to?: string }, title: string) {
    const s = await this.accountStatement(code, { ...q, page: 1, pageSize: 20_000 });
    const rows = [
      csvRow([title]),
      csvRow(['Account', `${s.account.code} — ${s.account.name}`]),
      csvRow(['From', s.from]),
      csvRow(['To', s.to]),
      csvRow(['Opening balance (EGP)', egp(s.openingBalanceCents)]),
      csvRow(['Closing balance (EGP)', egp(s.closingBalanceCents)]),
      '',
      csvRow(['Date', 'Kind', 'Reference', 'Description', 'Tracking number', 'Debit (EGP)', 'Credit (EGP)', 'Balance (EGP)']),
      ...s.data.map((l) => csvRow([l.createdAt.toISOString(), l.kind, l.reference, l.description, l.trackingNumber ?? '', egp(l.debitCents), egp(l.creditCents), egp(l.balanceCents)])),
    ];
    return `﻿${rows.join('\r\n')}\r\n`;
  }

  /** Net movement per company account in [start, end), in each account's normal direction. */
  private async movements(start: Date, end: Date, codes: string[]) {
    const rows = await this.db
      .select({
        code: ledgerAccounts.code, name: ledgerAccounts.name, type: ledgerAccounts.type,
        debits: sql<number>`coalesce(sum(${ledgerEntries.debitCents}), 0)`.mapWith(Number),
        credits: sql<number>`coalesce(sum(${ledgerEntries.creditCents}), 0)`.mapWith(Number),
      })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .where(and(inArray(ledgerAccounts.code, codes), gte(ledgerEntries.createdAt, start), lt(ledgerEntries.createdAt, end)))
      .groupBy(ledgerAccounts.code, ledgerAccounts.name, ledgerAccounts.type);
    const map = new Map(rows.map((r) => [r.code, r]));
    return codes.map((code) => {
      const r = map.get(code);
      const meta = Object.values(C).find((a) => a.code === code)!;
      const debits = toNumber(r?.debits);
      const credits = toNumber(r?.credits);
      return { code, name: meta.name, amountCents: isDebitNormal(meta.type) ? debits - credits : credits - debits };
    });
  }

  /** Profit & loss with unit economics per finalised order. VAT is a liability, not revenue. */
  async pnl(from?: string, to?: string) {
    const range = resolveDayRange(from, to, 30, 3660);
    const [revenue, expenses, vat] = await Promise.all([
      this.movements(range.start, range.end, REVENUE_CODES),
      this.movements(range.start, range.end, EXPENSE_CODES),
      this.movements(range.start, range.end, [C.VAT_PAYABLE.code]),
    ]);
    const [[delivered], [returned]] = await Promise.all([
      this.db
        .select({ n: count(), cod: sql<number>`coalesce(sum(${orders.collectedCents}), 0)`.mapWith(Number) })
        .from(orders)
        .where(and(eq(orders.status, 'DELIVERED'), gte(orders.deliveredAt, range.start), lt(orders.deliveredAt, range.end))),
      this.db.select({ n: count() }).from(orders).where(and(eq(orders.status, 'RETURNED'), gte(orders.returnedAt, range.start), lt(orders.returnedAt, range.end))),
    ]);
    const totalRevenue = revenue.reduce((s, r) => s + r.amountCents, 0);
    const heroPay = expenses.find((e) => e.code === C.EXPENSE_COURIER_PAY.code)!.amountCents;
    const totalExpenses = expenses.reduce((s, r) => s + r.amountCents, 0);
    const grossMargin = totalRevenue - heroPay;
    const deliveredN = Number(delivered?.n ?? 0);
    const returnedN = Number(returned?.n ?? 0);
    const finalOrders = deliveredN + returnedN;
    const perOrder = (v: number) => (finalOrders ? Math.round(v / finalOrders) : 0);
    return {
      from: range.from,
      to: range.to,
      revenue: { lines: revenue, totalCents: totalRevenue },
      expenses: { lines: expenses, heroPayCents: heroPay, otherCents: totalExpenses - heroPay, totalCents: totalExpenses },
      grossMarginCents: grossMargin,
      grossMarginPct: percent(grossMargin, totalRevenue),
      netIncomeCents: totalRevenue - totalExpenses,
      netMarginPct: percent(totalRevenue - totalExpenses, totalRevenue),
      vatCollectedCents: vat[0].amountCents,
      volume: { deliveredOrders: deliveredN, returnedOrders: returnedN, finalOrders, codCollectedCents: toNumber(delivered?.cod) },
      unitEconomics: {
        revenuePerOrderCents: perOrder(totalRevenue),
        heroCostPerOrderCents: perOrder(heroPay),
        otherCostPerOrderCents: perOrder(totalExpenses - heroPay),
        contributionPerOrderCents: perOrder(grossMargin),
        netPerOrderCents: perOrder(totalRevenue - totalExpenses),
      },
    };
  }

  /** Where the money is right now. */
  async cashPosition() {
    const balanceOf = async (code: string) => {
      const [r] = await this.db.select({ b: ledgerAccounts.balanceCents }).from(ledgerAccounts).where(eq(ledgerAccounts.code, code)).limit(1);
      return r?.b ?? 0;
    };
    const split = async (prefix: string) => {
      const [r] = await this.db
        .select({
          pos: sql<number>`coalesce(sum(case when ${ledgerAccounts.balanceCents} > 0 then ${ledgerAccounts.balanceCents} else 0 end), 0)`.mapWith(Number),
          neg: sql<number>`coalesce(sum(case when ${ledgerAccounts.balanceCents} < 0 then -${ledgerAccounts.balanceCents} else 0 end), 0)`.mapWith(Number),
          n: sql<number>`coalesce(sum(case when ${ledgerAccounts.balanceCents} <> 0 then 1 else 0 end), 0)`.mapWith(Number),
        })
        .from(ledgerAccounts)
        .where(sql`${ledgerAccounts.code} like ${`${prefix}%`}`);
      return { positiveCents: toNumber(r?.pos), negativeCents: toNumber(r?.neg), accounts: toNumber(r?.n) };
    };
    const [treasury, bank, gateway, vat, custody, wallets, payables, [pending], [openSettlements], [openPayouts]] = await Promise.all([
      balanceOf(C.TREASURY.code),
      balanceOf(C.BANK.code),
      balanceOf(C.PAYMENT_GATEWAY.code),
      balanceOf(C.VAT_PAYABLE.code),
      split('1100:HERO:'),
      split('2100:BRAND:'),
      split('2200:HERO:'),
      this.db.select({ n: count(), s: sql<number>`coalesce(sum(${cashHandovers.declaredCents}), 0)`.mapWith(Number) }).from(cashHandovers).where(eq(cashHandovers.status, 'PENDING')),
      this.db.select({ n: count(), s: sql<number>`coalesce(sum(${settlements.netPayableCents}), 0)`.mapWith(Number) }).from(settlements).where(inArray(settlements.status, ['DRAFT', 'APPROVED'])),
      this.db.select({ n: count(), s: sql<number>`coalesce(sum(${courierPayouts.netCents}), 0)`.mapWith(Number) }).from(courierPayouts).where(inArray(courierPayouts.status, ['DRAFT', 'APPROVED'])),
    ]);
    const liquid = treasury + bank + gateway;
    const heroCustody = custody.positiveCents - custody.negativeCents;
    const brandPayables = wallets.positiveCents;
    const heroPayables = payables.positiveCents;
    return {
      asOf: new Date(),
      assets: { treasuryCents: treasury, bankCents: bank, paymentGatewayCents: gateway, liquidCents: liquid, heroCustodyCents: heroCustody, brandReceivablesCents: wallets.negativeCents, heroReceivablesCents: payables.negativeCents },
      liabilities: { brandPayablesCents: brandPayables, heroPayablesCents: heroPayables, vatPayableCents: vat, totalCents: brandPayables + heroPayables + vat },
      netPositionCents: liquid + heroCustody + wallets.negativeCents + payables.negativeCents - brandPayables - heroPayables - vat,
      liquidityGapCents: liquid - brandPayables - heroPayables - vat,
      pipeline: {
        pendingHandovers: { count: Number(pending?.n ?? 0), declaredCents: toNumber(pending?.s) },
        openSettlements: { count: Number(openSettlements?.n ?? 0), netPayableCents: toNumber(openSettlements?.s) },
        openPayouts: { count: Number(openPayouts?.n ?? 0), netCents: toNumber(openPayouts?.s) },
      },
      counts: { heroesHoldingCash: custody.accounts, brandWallets: wallets.accounts, heroPayables: payables.accounts },
    };
  }

  /** Daily finance summary for a Cairo day. */
  async daily(date?: string) {
    const day = date ? assertDay(date) : cairoToday();
    const { start, end } = cairoDayRange(day);
    const [byKind, revenue, expenses, vat, [delivered], [returned], [failed], [handovers], [settled], [paidOut]] = await Promise.all([
      this.db
        .select({
          kind: ledgerTransactions.kind,
          n: sql<number>`count(distinct ${ledgerTransactions.id})`.mapWith(Number),
          amount: sql<number>`coalesce(sum(${ledgerEntries.debitCents}), 0)`.mapWith(Number),
        })
        .from(ledgerTransactions)
        .innerJoin(ledgerEntries, eq(ledgerEntries.transactionId, ledgerTransactions.id))
        .where(and(gte(ledgerTransactions.createdAt, start), lt(ledgerTransactions.createdAt, end)))
        .groupBy(ledgerTransactions.kind),
      this.movements(start, end, REVENUE_CODES),
      this.movements(start, end, EXPENSE_CODES),
      this.movements(start, end, [C.VAT_PAYABLE.code]),
      this.db
        .select({ n: count(), cod: sql<number>`coalesce(sum(${orders.collectedCents}), 0)`.mapWith(Number) })
        .from(orders)
        .where(and(eq(orders.status, 'DELIVERED'), gte(orders.deliveredAt, start), lt(orders.deliveredAt, end))),
      this.db.select({ n: count() }).from(orders).where(and(eq(orders.status, 'RETURNED'), gte(orders.returnedAt, start), lt(orders.returnedAt, end))),
      this.db.select({ n: count() }).from(deliveryAttempts).where(and(eq(deliveryAttempts.success, false), gte(deliveryAttempts.createdAt, start), lt(deliveryAttempts.createdAt, end))),
      this.db
        .select({
          n: count(),
          received: sql<number>`coalesce(sum(${cashHandovers.receivedCents}), 0)`.mapWith(Number),
          variance: sql<number>`coalesce(sum(${cashHandovers.varianceCents}), 0)`.mapWith(Number),
        })
        .from(cashHandovers)
        .where(and(eq(cashHandovers.status, 'CONFIRMED'), gte(cashHandovers.confirmedAt, start), lt(cashHandovers.confirmedAt, end))),
      this.db
        .select({ n: count(), s: sql<number>`coalesce(sum(${settlements.netPayableCents}), 0)`.mapWith(Number) })
        .from(settlements)
        .where(and(eq(settlements.status, 'PAID'), gte(settlements.paidAt, start), lt(settlements.paidAt, end))),
      this.db
        .select({ n: count(), s: sql<number>`coalesce(sum(${courierPayouts.netCents}), 0)`.mapWith(Number) })
        .from(courierPayouts)
        .where(and(eq(courierPayouts.status, 'PAID'), gte(courierPayouts.paidAt, start), lt(courierPayouts.paidAt, end))),
    ]);
    const kinds = Object.fromEntries(byKind.map((k) => [k.kind, { transactions: toNumber(k.n), amountCents: toNumber(k.amount) }]));
    const totalRevenue = revenue.reduce((s, r) => s + r.amountCents, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.amountCents, 0);
    return {
      date: day,
      orders: { delivered: Number(delivered?.n ?? 0), returned: Number(returned?.n ?? 0), failedAttempts: Number(failed?.n ?? 0), codCollectedCents: toNumber(delivered?.cod) },
      revenue: { lines: revenue, totalCents: totalRevenue },
      expenses: { lines: expenses, totalCents: totalExpenses },
      netIncomeCents: totalRevenue - totalExpenses,
      vatCents: vat[0].amountCents,
      cash: { handoversConfirmed: Number(handovers?.n ?? 0), receivedCents: toNumber(handovers?.received), varianceCents: toNumber(handovers?.variance) },
      settlementsPaid: { count: Number(settled?.n ?? 0), amountCents: toNumber(settled?.s) },
      payoutsPaid: { count: Number(paidOut?.n ?? 0), amountCents: toNumber(paidOut?.s) },
      ledgerByKind: kinds,
    };
  }
}
