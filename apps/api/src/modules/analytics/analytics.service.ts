import { HttpStatus, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import Papa from 'papaparse';
import type { Db } from '../../db/client';
import { brands, couriers, deliveryAttempts, ledgerAccounts, ledgerEntries, orders, tickets, users, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { CompanyAccounts } from '../../core/ledger/accounts';
import { DomainError } from '../../common/errors';
import { cairoDateTime, cairoOffsetMinutes, cairoToday, loadByIds } from '../../db/helpers';
import type { AnalyticsRangeDto, ExportReport } from './analytics.dto';

/**
 * Operations & brand analytics.
 *
 * Definitions (all periods are Cairo business days, inclusive):
 *  - created: orders whose createdAt falls in the period.
 *  - delivered / returned / cancelled: orders whose deliveredAt / returnedAt /
 *    cancelledAt falls in the period (event time, not cohort).
 *  - failedAttempts: failed delivery attempts recorded in the period.
 *  - successRate = delivered / (delivered + returned).
 *  - firstAttemptSuccessRate = delivered without any failed attempt / (delivered + returned).
 *  - onTimeRate = delivered with deliveredAt ≤ promisedBy / delivered that had a promise.
 *  - revenue: credits − debits on the revenue accounts (4000/4010/4020/4900) in
 *    the period; when filtered by hub or brand it falls back to order fees excl. VAT.
 *  - zone & brand tables are cohorts: orders created in the period, by current status.
 *
 * Performance: every query is a range scan on orders.createdAt (or
 * brand+createdAt) — event-time KPIs are bounded by a look-back window on
 * createdAt so they stay index-friendly — aggregated in SQL, no N+1.
 * Day/hour buckets are aggregated per UTC hour in SQL and mapped to Cairo
 * days/hours in JS, which is exact across DST changes (no CONVERT_TZ needed).
 */
const LOOKBACK_DAYS = 120;
const MAX_RANGE_DAYS = 366;
const REVENUE_CODES = [CompanyAccounts.REVENUE_SHIPPING.code, CompanyAccounts.REVENUE_COD_FEES.code, CompanyAccounts.REVENUE_RETURNS.code, CompanyAccounts.REVENUE_OTHER.code];

export interface Range {
  from: string;
  to: string;
  fromUtc: Date;
  toUtc: Date;
  lookbackUtc: Date;
  days: string[];
}

export interface Scope {
  brandId?: string | null;
  hubId?: string | null;
}

const n = (col: SQL | MySqlColumn) => sql<number>`coalesce(${col}, 0)`.mapWith(Number);
const sumWhen = (cond: SQL, value: SQL | MySqlColumn | number = 1) => sql<number>`coalesce(sum(case when ${cond} then ${value} else 0 end), 0)`.mapWith(Number);
const inRange = (col: MySqlColumn, r: Range) => sql`(${col} >= ${r.fromUtc} and ${col} < ${r.toUtc})`;
const hourKey = (col: MySqlColumn) => sql<string>`date_format(${col}, '%Y-%m-%d %H')`;
const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 10_000) / 10_000 : null);

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function parseRange(q: { from?: string; to?: string }, today = cairoToday()): Range {
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -29);
  if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    throw new DomainError('INVALID_RANGE', 'Invalid date', HttpStatus.BAD_REQUEST);
  }
  if (from > to) throw new DomainError('INVALID_RANGE', '"from" must not be after "to"', HttpStatus.BAD_REQUEST);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(d);
    if (days.length > MAX_RANGE_DAYS) throw new DomainError('INVALID_RANGE', `The period can be at most ${MAX_RANGE_DAYS} days`, HttpStatus.BAD_REQUEST);
  }
  const fromUtc = cairoDateTime(from, '00:00');
  const toUtc = cairoDateTime(addDays(to, 1), '00:00');
  return { from, to, fromUtc, toUtc, lookbackUtc: new Date(fromUtc.getTime() - LOOKBACK_DAYS * 86_400_000), days };
}

/** "2026-10-30 21" (UTC hour) → Cairo day, hour and weekday (0 = Sunday). */
function cairoParts(utcHour: string) {
  const at = new Date(`${utcHour.replace(' ', 'T')}:00:00Z`);
  const local = new Date(at.getTime() + cairoOffsetMinutes(at) * 60_000);
  return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours(), weekday: local.getUTCDay() };
}

@Injectable()
export class AnalyticsService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Staff dashboard. */
  async opsOverview(q: AnalyticsRangeDto) {
    const r = parseRange(q);
    const scope: Scope = { brandId: q.brandId ?? null, hubId: q.hubId ?? null };
    const filtered = !!(scope.brandId || scope.hubId);
    const kpisP = this.kpis(r, scope);
    const [kpis, series, failures, byZone, topBrands, money, heroes, openTickets] = await Promise.all([
      kpisP,
      this.series(r, scope),
      this.failureReasons(r, scope),
      this.byZone(r, scope),
      scope.brandId ? Promise.resolve([]) : this.topBrands(r, scope),
      this.money(r, scope, filtered ? kpisP.then((k) => k.feesExVatCents) : null),
      this.heroActivity(r, scope),
      this.openTickets(scope.brandId ?? null),
    ]);
    return {
      range: { from: r.from, to: r.to, timezone: 'Africa/Cairo' },
      filters: scope,
      kpis: {
        ...kpis,
        failedAttempts: failures.total,
        revenueCents: money.revenueCents,
        revenueSource: money.revenueSource,
        heroPayCents: money.heroPayCents,
        cashInCustodyCents: money.cashInCustodyCents,
        activeHeroes: heroes,
        openTickets,
      },
      daily: series.daily,
      heatmap: series.heatmap,
      byZone,
      topBrands,
      failureReasons: failures.reasons,
    };
  }

  /** Brand portal dashboard: same shape, scoped to the brand, no internal money. */
  async brandOverview(brandId: string, q: AnalyticsRangeDto) {
    const r = parseRange(q);
    const scope: Scope = { brandId };
    const [kpis, series, failures, byZone, openTickets] = await Promise.all([
      this.kpis(r, scope),
      this.series(r, scope),
      this.failureReasons(r, scope),
      this.byZone(r, scope),
      this.openTickets(brandId),
    ]);
    const { feesCents, ...rest } = kpis;
    return {
      range: { from: r.from, to: r.to, timezone: 'Africa/Cairo' },
      filters: { brandId },
      kpis: { ...rest, failedAttempts: failures.total, feesCents, netCodCents: kpis.codCollectedCents - feesCents, openTickets },
      daily: series.daily,
      heatmap: series.heatmap,
      byZone,
      failureReasons: failures.reasons,
    };
  }

  // ------------------------------------------------------------------ pieces

  private orderScope(scope: Scope): SQL[] {
    const c: SQL[] = [];
    if (scope.brandId) c.push(eq(orders.brandId, scope.brandId));
    if (scope.hubId) c.push(eq(orders.hubId, scope.hubId));
    return c;
  }

  async kpis(r: Range, scope: Scope) {
    const base = this.orderScope(scope);
    const deliveredIn = sql`(${orders.status} = 'DELIVERED' and ${inRange(orders.deliveredAt, r)})`;
    const returnedIn = sql`(${orders.status} = 'RETURNED' and ${inRange(orders.returnedAt, r)})`;
    const cancelledIn = sql`(${orders.status} = 'CANCELLED' and ${inRange(orders.cancelledAt, r)})`;
    const noFailedAttempt = sql`not exists (select 1 from ${deliveryAttempts} da where da.orderId = ${orders.id} and da.success = 0)`;
    const [[created], [out]] = await Promise.all([
      this.db
        .select({ created: count(), codBookedCents: n(sql`sum(${orders.codAmountCents})`) })
        .from(orders)
        .where(and(...base, gte(orders.createdAt, r.fromUtc), lt(orders.createdAt, r.toUtc))),
      this.db
        .select({
          delivered: sumWhen(deliveredIn),
          returned: sumWhen(returnedIn),
          cancelled: sumWhen(cancelledIn),
          firstAttempt: sumWhen(sql`${deliveredIn} and ${noFailedAttempt}`),
          withPromise: sumWhen(sql`${deliveredIn} and ${orders.promisedBy} is not null`),
          onTime: sumWhen(sql`${deliveredIn} and ${orders.promisedBy} is not null and ${orders.deliveredAt} <= ${orders.promisedBy}`),
          deliveryMinutes: sumWhen(deliveredIn, sql`timestampdiff(minute, ${orders.createdAt}, ${orders.deliveredAt})`),
          codCollectedCents: sumWhen(deliveredIn, orders.collectedCents),
          feesCents: sumWhen(sql`(${deliveredIn} or ${returnedIn})`, orders.totalFeesCents),
          vatCents: sumWhen(sql`(${deliveredIn} or ${returnedIn})`, orders.vatCents),
        })
        .from(orders)
        .where(and(...base, gte(orders.createdAt, r.lookbackUtc), lt(orders.createdAt, r.toUtc))),
    ]);
    const finished = out.delivered + out.returned;
    return {
      ordersCreated: Number(created.created),
      codBookedCents: created.codBookedCents,
      delivered: out.delivered,
      returned: out.returned,
      cancelled: out.cancelled,
      successRate: rate(out.delivered, finished),
      firstAttemptSuccessRate: rate(out.firstAttempt, finished),
      onTimeRate: rate(out.onTime, out.withPromise),
      avgHoursToDeliver: out.delivered ? Math.round((out.deliveryMinutes / out.delivered / 60) * 10) / 10 : null,
      codCollectedCents: out.codCollectedCents,
      feesCents: out.feesCents,
      feesExVatCents: out.feesCents - out.vatCents,
    };
  }

  /** Daily series (Cairo days) + delivery heatmap (Cairo weekday × hour). */
  async series(r: Range, scope: Scope) {
    const base = this.orderScope(scope);
    const createdKey = hourKey(orders.createdAt);
    const deliveredKey = hourKey(orders.deliveredAt);
    const returnedKey = hourKey(orders.returnedAt);
    const attemptKey = hourKey(deliveryAttempts.createdAt);
    const [created, delivered, returned, failed] = await Promise.all([
      this.db
        .select({ h: createdKey, n: count() })
        .from(orders)
        .where(and(...base, gte(orders.createdAt, r.fromUtc), lt(orders.createdAt, r.toUtc)))
        .groupBy(createdKey),
      this.db
        .select({ h: deliveredKey, n: count(), cod: n(sql`sum(${orders.collectedCents})`) })
        .from(orders)
        .where(and(...base, eq(orders.status, 'DELIVERED'), gte(orders.createdAt, r.lookbackUtc), lt(orders.createdAt, r.toUtc), gte(orders.deliveredAt, r.fromUtc), lt(orders.deliveredAt, r.toUtc)))
        .groupBy(deliveredKey),
      this.db
        .select({ h: returnedKey, n: count() })
        .from(orders)
        .where(and(...base, eq(orders.status, 'RETURNED'), gte(orders.createdAt, r.lookbackUtc), lt(orders.createdAt, r.toUtc), gte(orders.returnedAt, r.fromUtc), lt(orders.returnedAt, r.toUtc)))
        .groupBy(returnedKey),
      this.db
        .select({ h: attemptKey, n: count() })
        .from(deliveryAttempts)
        .innerJoin(orders, eq(orders.id, deliveryAttempts.orderId))
        .where(and(...base, eq(deliveryAttempts.success, false), gte(orders.createdAt, r.lookbackUtc), lt(orders.createdAt, r.toUtc), gte(deliveryAttempts.createdAt, r.fromUtc), lt(deliveryAttempts.createdAt, r.toUtc)))
        .groupBy(attemptKey),
    ]);
    const daily = new Map(r.days.map((d) => [d, { date: d, created: 0, delivered: 0, failedAttempts: 0, returned: 0, codCollectedCents: 0 }]));
    const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    const add = (rows: Array<{ h: string; n: number }>, apply: (day: (typeof daily extends Map<string, infer V> ? V : never), row: { h: string; n: number; cod?: number }, parts: ReturnType<typeof cairoParts>) => void) => {
      for (const row of rows) {
        const parts = cairoParts(row.h);
        const day = daily.get(parts.day);
        if (day) apply(day, row, parts);
      }
    };
    add(created.map((x) => ({ h: x.h, n: Number(x.n) })), (d, x) => (d.created += x.n));
    add(delivered.map((x) => ({ h: x.h, n: Number(x.n), cod: x.cod })), (d, x, p) => {
      d.delivered += x.n;
      d.codCollectedCents += x.cod ?? 0;
      heat[p.weekday][p.hour] += x.n;
    });
    add(returned.map((x) => ({ h: x.h, n: Number(x.n) })), (d, x) => (d.returned += x.n));
    add(failed.map((x) => ({ h: x.h, n: Number(x.n) })), (d, x) => (d.failedAttempts += x.n));
    return {
      daily: [...daily.values()],
      heatmap: { metric: 'delivered', rows: 'weekday (0 = Sunday)', columns: 'hour (Cairo)', values: heat },
    };
  }

  async failureReasons(r: Range, scope: Scope) {
    const rows = await this.db
      .select({ reason: deliveryAttempts.failureReason, n: count() })
      .from(deliveryAttempts)
      .innerJoin(orders, eq(orders.id, deliveryAttempts.orderId))
      .where(
        and(
          ...this.orderScope(scope), eq(deliveryAttempts.success, false), gte(orders.createdAt, r.lookbackUtc), lt(orders.createdAt, r.toUtc),
          gte(deliveryAttempts.createdAt, r.fromUtc), lt(deliveryAttempts.createdAt, r.toUtc),
        ),
      )
      .groupBy(deliveryAttempts.failureReason);
    const total = rows.reduce((s, x) => s + Number(x.n), 0);
    const reasons = rows
      .map((x) => ({ reason: x.reason ?? 'OTHER', count: Number(x.n), share: rate(Number(x.n), total) }))
      .sort((a, b) => b.count - a.count);
    return { total, reasons };
  }

  async byZone(r: Range, scope: Scope) {
    const rows = await this.db
      .select({
        zoneId: orders.zoneId,
        created: count(),
        delivered: sumWhen(sql`${orders.status} = 'DELIVERED'`),
        returned: sumWhen(sql`${orders.status} = 'RETURNED'`),
        cancelled: sumWhen(sql`${orders.status} = 'CANCELLED'`),
        codCollectedCents: sumWhen(sql`${orders.status} = 'DELIVERED'`, orders.collectedCents),
      })
      .from(orders)
      .where(and(...this.orderScope(scope), gte(orders.createdAt, r.fromUtc), lt(orders.createdAt, r.toUtc)))
      .groupBy(orders.zoneId)
      .orderBy(desc(count()));
    const zoneMap = await loadByIds(this.db, zones, zones.id, rows.map((x) => x.zoneId));
    return rows.map((x) => {
      const z = zoneMap.get(x.zoneId);
      const created = Number(x.created);
      return {
        zoneId: x.zoneId, code: z?.code ?? null, nameEn: z?.nameEn ?? null, nameAr: z?.nameAr ?? null,
        created, delivered: x.delivered, returned: x.returned, cancelled: x.cancelled, inProgress: created - x.delivered - x.returned - x.cancelled,
        successRate: rate(x.delivered, x.delivered + x.returned), codCollectedCents: x.codCollectedCents,
      };
    });
  }

  async topBrands(r: Range, scope: Scope, limit = 10) {
    const rows = await this.db
      .select({
        brandId: orders.brandId,
        created: count(),
        delivered: sumWhen(sql`${orders.status} = 'DELIVERED'`),
        returned: sumWhen(sql`${orders.status} = 'RETURNED'`),
        codCollectedCents: sumWhen(sql`${orders.status} = 'DELIVERED'`, orders.collectedCents),
        feesCents: sumWhen(sql`${orders.status} in ('DELIVERED', 'RETURNED')`, orders.totalFeesCents),
      })
      .from(orders)
      .where(and(...this.orderScope(scope), gte(orders.createdAt, r.fromUtc), lt(orders.createdAt, r.toUtc)))
      .groupBy(orders.brandId)
      .orderBy(desc(count()))
      .limit(limit);
    const brandMap = await loadByIds(this.db, brands, brands.id, rows.map((x) => x.brandId));
    return rows.map((x) => ({
      brandId: x.brandId, code: brandMap.get(x.brandId)?.code ?? null, name: brandMap.get(x.brandId)?.name ?? null,
      created: Number(x.created), delivered: x.delivered, returned: x.returned, successRate: rate(x.delivered, x.delivered + x.returned),
      codCollectedCents: x.codCollectedCents, feesCents: x.feesCents,
    }));
  }

  /** Revenue, hero pay and cash in custody. */
  private async money(r: Range, scope: Scope, feesExVat: Promise<number> | null) {
    const entriesInRange = and(gte(ledgerEntries.createdAt, r.fromUtc), lt(ledgerEntries.createdAt, r.toUtc));
    let revenueCents: number;
    let revenueSource: 'ledger' | 'orders';
    if (!feesExVat) {
      const [row] = await this.db
        .select({ v: n(sql`sum(${ledgerEntries.creditCents} - ${ledgerEntries.debitCents})`) })
        .from(ledgerEntries)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
        .where(and(inArray(ledgerAccounts.code, REVENUE_CODES), entriesInRange));
      revenueCents = row.v;
      revenueSource = 'ledger';
    } else {
      revenueCents = await feesExVat;
      revenueSource = 'orders';
    }

    let heroPayCents: number | null = null;
    if (!scope.brandId) {
      if (!scope.hubId) {
        const [row] = await this.db
          .select({ v: n(sql`sum(${ledgerEntries.debitCents} - ${ledgerEntries.creditCents})`) })
          .from(ledgerEntries)
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
          .where(and(eq(ledgerAccounts.code, CompanyAccounts.EXPENSE_COURIER_PAY.code), entriesInRange));
        heroPayCents = row.v;
      } else {
        const [row] = await this.db
          .select({ v: n(sql`sum(${ledgerEntries.creditCents})`) })
          .from(ledgerEntries)
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
          .innerJoin(couriers, eq(couriers.id, ledgerAccounts.courierId))
          .where(and(sql`${ledgerAccounts.code} like '2200:HERO:%'`, eq(couriers.homeHubId, scope.hubId), entriesInRange));
        heroPayCents = row.v;
      }
    }

    let cashInCustodyCents: number | null = null;
    if (!scope.brandId) {
      const [row] = await this.db
        .select({ v: n(sql`sum(${couriers.cashOnHandCents})`) })
        .from(couriers)
        .where(scope.hubId ? eq(couriers.homeHubId, scope.hubId) : undefined);
      cashInCustodyCents = row.v;
    }
    return { revenueCents, revenueSource, heroPayCents, cashInCustodyCents };
  }

  private async heroActivity(r: Range, scope: Scope): Promise<number> {
    const [row] = await this.db
      .select({ v: sql<number>`count(distinct ${deliveryAttempts.courierId})`.mapWith(Number) })
      .from(deliveryAttempts)
      .innerJoin(orders, eq(orders.id, deliveryAttempts.orderId))
      .where(and(...this.orderScope(scope), gte(orders.createdAt, r.lookbackUtc), lt(orders.createdAt, r.toUtc), gte(deliveryAttempts.createdAt, r.fromUtc), lt(deliveryAttempts.createdAt, r.toUtc)));
    return row.v;
  }

  private async openTickets(brandId: string | null): Promise<number> {
    const [row] = await this.db
      .select({ v: count() })
      .from(tickets)
      .where(and(inArray(tickets.status, ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER']), brandId ? eq(tickets.brandId, brandId) : undefined));
    return Number(row.v);
  }

  /** Hero comparison table for the period. */
  async heroes(q: AnalyticsRangeDto) {
    const r = parseRange(q);
    // Fixed Cairo offset for the range, used only to count distinct active days.
    const offset = cairoOffsetMinutes(new Date((r.fromUtc.getTime() + r.toUtc.getTime()) / 2));
    const [activity, earnings, roster] = await Promise.all([
      this.db
        .select({
          courierId: deliveryAttempts.courierId,
          attempts: count(),
          delivered: sumWhen(sql`${deliveryAttempts.success} = 1`),
          failed: sumWhen(sql`${deliveryAttempts.success} = 0`),
          codCollectedCents: sumWhen(sql`${deliveryAttempts.success} = 1`, orders.collectedCents),
          activeDays: sql<number>`count(distinct date(date_add(${deliveryAttempts.createdAt}, interval ${sql.raw(String(offset))} minute)))`.mapWith(Number),
        })
        .from(deliveryAttempts)
        .innerJoin(orders, eq(orders.id, deliveryAttempts.orderId))
        .where(and(gte(orders.createdAt, r.lookbackUtc), lt(orders.createdAt, r.toUtc), gte(deliveryAttempts.createdAt, r.fromUtc), lt(deliveryAttempts.createdAt, r.toUtc)))
        .groupBy(deliveryAttempts.courierId),
      this.db
        .select({ courierId: ledgerAccounts.courierId, v: n(sql`sum(${ledgerEntries.creditCents})`) })
        .from(ledgerEntries)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
        .where(and(sql`${ledgerAccounts.code} like '2200:HERO:%'`, gte(ledgerEntries.createdAt, r.fromUtc), lt(ledgerEntries.createdAt, r.toUtc)))
        .groupBy(ledgerAccounts.courierId),
      this.db
        .select({
          id: couriers.id, code: couriers.code, name: users.name, employmentType: couriers.employmentType, status: couriers.status,
          homeHubId: couriers.homeHubId, rating: couriers.rating, cashOnHandCents: couriers.cashOnHandCents,
        })
        .from(couriers)
        .innerJoin(users, eq(users.id, couriers.userId))
        .where(q.hubId ? eq(couriers.homeHubId, q.hubId) : undefined),
    ]);
    const act = new Map(activity.map((a) => [a.courierId, a]));
    const pay = new Map(earnings.map((e) => [e.courierId, e.v]));
    const rows = roster
      .filter((c) => c.status === 'ACTIVE' || act.has(c.id))
      .map((c) => {
        const a = act.get(c.id);
        const delivered = a?.delivered ?? 0;
        const failed = a?.failed ?? 0;
        const activeDays = a?.activeDays ?? 0;
        return {
          courierId: c.id, code: c.code, name: c.name, employmentType: c.employmentType, homeHubId: c.homeHubId, rating: c.rating,
          attempts: Number(a?.attempts ?? 0), delivered, failedAttempts: failed, successRate: rate(delivered, delivered + failed),
          codCollectedCents: a?.codCollectedCents ?? 0, activeDays, deliveriesPerActiveDay: activeDays ? Math.round((delivered / activeDays) * 10) / 10 : null,
          earningsCents: pay.get(c.id) ?? 0, cashOnHandCents: c.cashOnHandCents,
        };
      })
      .sort((x, y) => y.delivered - x.delivered || x.code.localeCompare(y.code));
    return { range: { from: r.from, to: r.to, timezone: 'Africa/Cairo' }, filters: { hubId: q.hubId ?? null }, heroes: rows };
  }

  // ------------------------------------------------------------------ CSV

  async exportCsv(report: ExportReport, q: AnalyticsRangeDto, brandId: string | null): Promise<{ filename: string; csv: string }> {
    const r = parseRange(q);
    const scope: Scope = { brandId: brandId ?? q.brandId ?? null, hubId: brandId ? null : (q.hubId ?? null) };
    let rows: Array<Record<string, unknown>>;
    switch (report) {
      case 'daily':
        rows = (await this.series(r, scope)).daily;
        break;
      case 'zones':
        rows = await this.byZone(r, scope);
        break;
      case 'failure-reasons':
        rows = (await this.failureReasons(r, scope)).reasons;
        break;
      case 'brands':
        if (brandId) throw new DomainError('REPORT_NOT_AVAILABLE', 'This report is not available for brands', HttpStatus.FORBIDDEN);
        rows = await this.topBrands(r, scope, 1000);
        break;
      case 'heroes':
        if (brandId) throw new DomainError('REPORT_NOT_AVAILABLE', 'This report is not available for brands', HttpStatus.FORBIDDEN);
        rows = (await this.heroes(q)).heroes;
        break;
    }
    // Excel opens UTF-8 CSV with Arabic correctly only with a BOM.
    return { filename: `goturtle-${report}-${r.from}_${r.to}.csv`, csv: `﻿${Papa.unparse(rows, { header: true })}` };
  }
}
