import { HttpStatus, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { brands, ledgerAccounts, ledgerEntries, ledgerTransactions, orders, settlements } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { describeRef } from '../../core/ledger/accounts';
import { DomainError, notFound } from '../../common/errors';
import { brandScope, type Principal } from '../../common/principal';
import { cairoToday } from '../../db/helpers';
import { addDays, cairoDayStart, monthStartOf, toNumber } from '../couriers/workforce.util';
import { nextSettlementDay, SettlementsService } from './settlements.service';
import { FinanceReportsService } from './finance-reports.service';

/** The brand portal's view of its money: wallet, pending COD, settlements and statement. */
@Injectable()
export class BrandFinanceService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settlements: SettlementsService,
    private readonly reports: FinanceReportsService,
  ) {}

  /** Brand users are pinned to their brand; staff must say which brand they look at. */
  resolveBrand(principal: Principal, requested?: string): string {
    const scoped = brandScope(principal);
    if (scoped) return scoped;
    if (!requested) throw new DomainError('BRAND_REQUIRED', 'Pass brandId to view a brand’s finance', HttpStatus.BAD_REQUEST);
    return requested;
  }

  async summary(brandId: string) {
    const [brand] = await this.db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
    if (!brand) throw notFound('Brand', brandId);
    const walletCode = describeRef({ brandWallet: brandId }).code;
    const today = cairoToday();
    const monthStart = cairoDayStart(monthStartOf(today));
    const [[wallet], [pending], [fees], [lastPaid], openTotal, [dueToday]] = await Promise.all([
      this.db.select({ b: ledgerAccounts.balanceCents }).from(ledgerAccounts).where(eq(ledgerAccounts.code, walletCode)).limit(1),
      this.db
        .select({ n: count(), cod: sql<number>`coalesce(sum(${orders.collectedCents}), 0)`.mapWith(Number) })
        .from(orders)
        .where(and(eq(orders.brandId, brandId), eq(orders.status, 'DELIVERED'), isNull(orders.settlementId))),
      this.db
        .select({ s: sql<number>`coalesce(sum(${ledgerEntries.debitCents}), 0)`.mapWith(Number) })
        .from(ledgerEntries)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
        .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
        .where(and(eq(ledgerAccounts.code, walletCode), eq(ledgerTransactions.kind, 'ORDER_FEES'), gte(ledgerEntries.createdAt, monthStart))),
      this.db
        .select({ id: settlements.id, code: settlements.code, netPayableCents: settlements.netPayableCents, paidAt: settlements.paidAt, method: settlements.method })
        .from(settlements)
        .where(and(eq(settlements.brandId, brandId), eq(settlements.status, 'PAID')))
        .orderBy(desc(settlements.paidAt))
        .limit(1),
      this.settlements.openTotal(brandId),
      this.db.select({ id: settlements.id }).from(settlements).where(and(eq(settlements.brandId, brandId), eq(settlements.periodEnd, cairoDayStart(today)))).limit(1),
    ]);
    const nextFrom = dueToday ? addDays(today, 1) : today;
    return {
      brand: { id: brand.id, code: brand.code, name: brand.name },
      walletBalanceCents: wallet?.b ?? 0,
      pendingCodCents: toNumber(pending?.cod),
      pendingOrders: Number(pending?.n ?? 0),
      inSettlementCents: openTotal,
      feesThisMonthCents: toNumber(fees?.s),
      settlementCycle: brand.settlementCycle,
      payoutMethod: brand.payoutMethod,
      nextSettlementDate: nextSettlementDay(brand.settlementCycle, nextFrom),
      lastPaidSettlement: lastPaid ?? null,
    };
  }

  statement(brandId: string, q: { from?: string; to?: string; page: number; pageSize: number }) {
    return this.reports.accountStatement(describeRef({ brandWallet: brandId }).code, q).catch((err) => {
      // A brand without any wallet movement yet has no ledger account.
      if (err instanceof DomainError && err.code === 'NOT_FOUND') {
        return { account: null, from: q.from ?? null, to: q.to ?? null, openingBalanceCents: 0, closingBalanceCents: 0, totals: { debitsCents: 0, creditsCents: 0 }, data: [], meta: { page: q.page, pageSize: q.pageSize, total: 0, totalPages: 1 } };
      }
      throw err;
    });
  }

  async statementCsv(brandId: string, q: { from?: string; to?: string }) {
    const [brand] = await this.db.select({ name: brands.name, code: brands.code }).from(brands).where(eq(brands.id, brandId)).limit(1);
    if (!brand) throw notFound('Brand', brandId);
    try {
      return await this.reports.statementCsv(describeRef({ brandWallet: brandId }).code, q, `GoTurtle wallet statement — ${brand.name} (${brand.code})`);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'NOT_FOUND') return `﻿GoTurtle wallet statement — ${brand.name} (${brand.code})\r\nNo movements yet\r\n`;
      throw err;
    }
  }
}
