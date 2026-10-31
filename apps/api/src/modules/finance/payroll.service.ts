import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PayoutMethod, PayoutStatus } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { courierAdjustments, courierPayouts, couriers, ledgerAccounts, ledgerEntries, ledgerTransactions, shifts, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { LedgerService } from '../../core/ledger/ledger.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { SequenceService } from '../../core/sequence.service';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import type { Principal } from '../../common/principal';
import { principalUserId } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { cairoToday } from '../../db/helpers';
import { addDays, daysInMonth, monthStartOf, resolveDayRange, toNumber } from '../couriers/workforce.util';
import { HeroLedgerService, payoutBreakdown } from './hero-ledger.service';
import { AdjustmentsService } from './adjustments.service';
import type { GeneratePayoutsDto, ListPayoutsQuery } from './dto/finance.dto';

type PayoutRow = typeof courierPayouts.$inferSelect;
const OPEN: PayoutStatus[] = ['DRAFT', 'APPROVED'];
export const MAX_PAYROLL_DAYS = 93;

/** Monthly salary prorated by calendar days for each month the period touches (exact for whole months). */
export function salaryForPeriod(monthlyCents: number, fromDay: string, toDay: string): number {
  if (monthlyCents <= 0 || fromDay > toDay) return 0;
  let total = 0;
  let cursor = fromDay;
  while (cursor <= toDay) {
    const monthEnd = addDays(monthStartOf(addDays(monthStartOf(cursor), 32)), -1);
    const segmentEnd = monthEnd < toDay ? monthEnd : toDay;
    const days = Math.round((Date.parse(`${segmentEnd}T00:00:00Z`) - Date.parse(`${cursor}T00:00:00Z`)) / 86_400_000) + 1;
    total += (monthlyCents * days) / daysInMonth(cursor);
    cursor = addDays(segmentEnd, 1);
  }
  return Math.round(total);
}

/**
 * Hero payroll. A payout snapshots what we owe the hero right now (the
 * payable ledger balance) with a breakdown of the period's ledger lines, and
 * links the period's completed shifts and adjustments. Paying posts
 * Dr 2200 Hero payable / Cr Bank|Treasury.
 */
@Injectable()
export class PayrollService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly postings: PostingsService,
    private readonly sequences: SequenceService,
    private readonly heroLedger: HeroLedgerService,
    private readonly adjustments: AdjustmentsService,
  ) {}

  async generate(dto: GeneratePayoutsDto, principal: Principal | null, meta: RequestMetaInfo | null) {
    const range = resolveDayRange(dto.periodStart, dto.periodEnd, 30, MAX_PAYROLL_DAYS);
    if (range.to > cairoToday()) throw new DomainError('PERIOD_IN_FUTURE', 'periodEnd cannot be after today', HttpStatus.BAD_REQUEST);
    const periodEndAt = new Date(range.end.getTime() - 1);

    let candidateIds: string[];
    if (dto.courierIds?.length) {
      const found = await this.db.select({ id: couriers.id }).from(couriers).where(inArray(couriers.id, dto.courierIds));
      const missing = dto.courierIds.filter((id) => !found.some((f) => f.id === id));
      if (missing.length) throw new DomainError('INVALID_COURIER', 'Some heroes do not exist', HttpStatus.BAD_REQUEST, { courierIds: missing });
      candidateIds = dto.courierIds;
    } else {
      const rows = await this.db
        .select({ id: couriers.id })
        .from(couriers)
        .leftJoin(ledgerAccounts, eq(ledgerAccounts.code, sql`concat('2200:HERO:', ${couriers.id})`))
        .where(
          or(
            gt(ledgerAccounts.balanceCents, 0),
            dto.includeSalary ? and(eq(couriers.employmentType, 'FULL_TIME'), gt(couriers.monthlySalaryCents, 0), ne(couriers.status, 'OFFBOARDED')) : undefined,
          ),
        )
        .orderBy(asc(couriers.code));
      candidateIds = rows.map((r) => r.id);
    }

    const created: string[] = [];
    const skipped: Array<{ courierId: string; reason: string; payableCents?: number }> = [];
    for (const courierId of candidateIds) {
      const outcome = await this.db.transaction(async (tx) => {
        const [hero] = await this.ledger.lockCouriers(tx, [courierId]);
        const [open] = await tx.select({ id: courierPayouts.id, code: courierPayouts.code }).from(courierPayouts).where(and(eq(courierPayouts.courierId, courierId), inArray(courierPayouts.status, OPEN))).limit(1);
        if (open) return { skip: 'PAYOUT_PENDING' as const };
        if (dto.includeSalary && hero.employmentType === 'FULL_TIME' && hero.monthlySalaryCents > 0 && hero.status !== 'OFFBOARDED') {
          const salary = salaryForPeriod(hero.monthlySalaryCents, range.from, range.to);
          await this.postings.courierEarning(tx, courierId, salary, `salary:${courierId}:${range.from}:${range.to}`, `Salary ${range.from} → ${range.to}`);
        }
        const balance = await this.heroLedger.balance(courierId, tx);
        if (balance <= 0) return { skip: 'NOTHING_PAYABLE' as const, payableCents: balance };
        const breakdown = payoutBreakdown(await this.heroLedger.totals(courierId, range.start, range.end, tx));
        // The period's salary belongs to this payout even when it is posted after the period ends.
        const [salaryTx] = await tx
          .select({ at: ledgerTransactions.createdAt, amount: sql<number>`coalesce(sum(${ledgerEntries.creditCents}), 0)`.mapWith(Number) })
          .from(ledgerTransactions)
          .innerJoin(ledgerEntries, eq(ledgerEntries.transactionId, ledgerTransactions.id))
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
          .where(and(eq(ledgerTransactions.reference, `salary:${courierId}:${range.from}:${range.to}`), eq(ledgerAccounts.code, this.heroLedger.payableCode(courierId))))
          .groupBy(ledgerTransactions.id, ledgerTransactions.createdAt);
        if (salaryTx && (salaryTx.at < range.start || salaryTx.at >= range.end)) breakdown.salaryCents += toNumber(salaryTx.amount);
        const shiftRows = await tx
          .select({ id: shifts.id, workedMinutes: shifts.workedMinutes })
          .from(shifts)
          .where(and(eq(shifts.courierId, courierId), eq(shifts.status, 'COMPLETED'), isNull(shifts.payoutId), lt(shifts.startAt, range.end)));
        const adjRows = await tx
          .select({ id: courierAdjustments.id })
          .from(courierAdjustments)
          .where(and(eq(courierAdjustments.courierId, courierId), isNull(courierAdjustments.payoutId), lt(courierAdjustments.createdAt, range.end)));
        const code = await this.sequences.code('PAY', 'payout', 6, tx);
        const [row] = await tx
          .insert(courierPayouts)
          .values({
            code, courierId, periodStart: range.start, periodEnd: periodEndAt, status: 'DRAFT',
            deliveriesCount: breakdown.deliveriesCount, pickupsCount: breakdown.pickupsCount, failedAttemptsCount: breakdown.failedAttemptsCount,
            workedMinutes: shiftRows.reduce((s, r) => s + r.workedMinutes, 0),
            deliveryEarningsCents: breakdown.deliveryEarningsCents, hourlyEarningsCents: breakdown.hourlyEarningsCents, salaryCents: breakdown.salaryCents,
            bonusesCents: breakdown.bonusesCents, deductionsCents: breakdown.deductionsCents, netCents: balance,
          })
          .$returningId();
        if (shiftRows.length) await tx.update(shifts).set({ payoutId: row.id }).where(inArray(shifts.id, shiftRows.map((r) => r.id)));
        if (adjRows.length) await tx.update(courierAdjustments).set({ payoutId: row.id }).where(inArray(courierAdjustments.id, adjRows.map((r) => r.id)));
        await this.audit.record(principal, { action: 'payout.generate', entity: 'CourierPayout', entityId: row.id, after: { code, courierId, netCents: balance, period: [range.from, range.to] } }, meta, tx);
        return { id: row.id };
      });
      if (outcome.id) created.push(outcome.id);
      else skipped.push({ courierId, reason: outcome.skip ?? 'NOTHING_PAYABLE', ...(outcome.payableCents !== undefined ? { payableCents: outcome.payableCents } : {}) });
    }
    const rows = created.length ? await this.db.select().from(courierPayouts).where(inArray(courierPayouts.id, created)).orderBy(asc(courierPayouts.code)) : [];
    const views = await this.present(rows);
    return { periodStart: range.from, periodEnd: range.to, created: views, skipped, totalNetCents: views.reduce((s, v) => s + v.netCents, 0) };
  }

  private async lock(tx: DbOrTx, id: string, allowed: PayoutStatus[], verb: string) {
    const [p] = await tx.select().from(courierPayouts).where(eq(courierPayouts.id, id)).for('update');
    if (!p) throw notFound('Payout', id);
    if (!allowed.includes(p.status)) throw new DomainError('INVALID_STATE', `A ${p.status} payout cannot be ${verb}`, HttpStatus.CONFLICT, { status: p.status });
    return p;
  }

  async approve(id: string, principal: Principal, meta: RequestMetaInfo) {
    await this.db.transaction(async (tx) => {
      const p = await this.lock(tx, id, ['DRAFT'], 'approved');
      await tx.update(courierPayouts).set({ status: 'APPROVED', approvedById: principalUserId(principal) }).where(eq(courierPayouts.id, id));
      await this.audit.record(principal, { action: 'payout.approve', entity: 'CourierPayout', entityId: id, before: { status: p.status }, after: { status: 'APPROVED' } }, meta, tx);
    });
    return this.detail(id);
  }

  /** Pays an APPROVED payout. Refused when the payable dropped below the snapshot (e.g. a penalty after generation). */
  async pay(id: string, dto: { method: PayoutMethod; paymentReference?: string }, principal: Principal, meta: RequestMetaInfo) {
    await this.db.transaction(async (tx) => {
      const p = await this.lock(tx, id, ['APPROVED'], 'paid (approve it first)');
      await this.ledger.lockCouriers(tx, [p.courierId]);
      const balance = await this.heroLedger.balance(p.courierId, tx);
      if (balance < p.netCents) {
        throw new DomainError('PAYABLE_CHANGED', 'The hero’s payable balance dropped since this payout was generated. Cancel and regenerate it.', HttpStatus.CONFLICT, { payableCents: balance, netCents: p.netCents });
      }
      await this.postings.courierPayout(tx, { id: p.id, code: p.code, courierId: p.courierId, netCents: p.netCents, method: dto.method }, principalUserId(principal));
      await tx.update(courierPayouts).set({ status: 'PAID', method: dto.method, paymentReference: dto.paymentReference ?? null, paidAt: new Date() }).where(eq(courierPayouts.id, id));
      await this.audit.record(principal, { action: 'payout.pay', entity: 'CourierPayout', entityId: id, before: { status: p.status }, after: { status: 'PAID', method: dto.method, netCents: p.netCents } }, meta, tx);
    });
    return this.detail(id);
  }

  async cancel(id: string, reason: string, principal: Principal, meta: RequestMetaInfo) {
    await this.db.transaction(async (tx) => {
      const p = await this.lock(tx, id, OPEN, 'cancelled');
      await tx.update(shifts).set({ payoutId: null }).where(eq(shifts.payoutId, id));
      await tx.update(courierAdjustments).set({ payoutId: null }).where(eq(courierAdjustments.payoutId, id));
      await tx.update(courierPayouts).set({ status: 'CANCELLED' }).where(eq(courierPayouts.id, id));
      await this.audit.record(principal, { action: 'payout.cancel', entity: 'CourierPayout', entityId: id, before: { status: p.status }, after: { status: 'CANCELLED', reason } }, meta, tx);
    });
    return this.detail(id);
  }

  // ---------------------------------------------------------------- reading

  async list(q: ListPayoutsQuery, scope: { courierId?: string } = {}) {
    const conds: Array<SQL | undefined> = [
      scope.courierId ? eq(courierPayouts.courierId, scope.courierId) : q.courierId ? eq(courierPayouts.courierId, q.courierId) : undefined,
      q.status ? eq(courierPayouts.status, q.status) : undefined,
    ];
    if (q.from || q.to) {
      const r = resolveDayRange(q.from, q.to, 30, 3660);
      conds.push(gte(courierPayouts.periodEnd, r.start), lt(courierPayouts.periodEnd, r.end));
    }
    const where = and(...conds);
    const [rows, [{ n }], [sum]] = await Promise.all([
      this.db.select().from(courierPayouts).where(where).orderBy(desc(courierPayouts.createdAt), desc(courierPayouts.code)).limit(q.pageSize).offset(offsetOf(q)),
      this.db.select({ n: count() }).from(courierPayouts).where(where),
      this.db.select({ s: sql<number>`coalesce(sum(${courierPayouts.netCents}), 0)`.mapWith(Number) }).from(courierPayouts).where(where),
    ]);
    return { ...paginate(await this.present(rows), Number(n), q), totals: { netCents: toNumber(sum?.s) } };
  }

  async present(rows: PayoutRow[]) {
    const ids = [...new Set(rows.map((r) => r.courierId))];
    const heroes = ids.length
      ? await this.db
          .select({ id: couriers.id, code: couriers.code, name: users.name, employmentType: couriers.employmentType, walletPhone: couriers.walletPhone })
          .from(couriers)
          .innerJoin(users, eq(users.id, couriers.userId))
          .where(inArray(couriers.id, ids))
      : [];
    const map = new Map(heroes.map((h) => [h.id, h]));
    return rows.map((r) => {
      const periodNet = r.deliveryEarningsCents + r.hourlyEarningsCents + r.salaryCents + r.bonusesCents - r.deductionsCents;
      return { ...r, periodNetCents: periodNet, carryOverCents: r.netCents - periodNet, courier: map.get(r.courierId) ?? null };
    });
  }

  async detail(id: string, scope: { courierId?: string } = {}) {
    const [p] = await this.db.select().from(courierPayouts).where(eq(courierPayouts.id, id)).limit(1);
    if (!p || (scope.courierId && p.courierId !== scope.courierId)) throw notFound('Payout', id);
    const [view] = await this.present([p]);
    const [linkedShifts, linkedAdjustments, payableNow] = await Promise.all([
      this.db
        .select({ id: shifts.id, startAt: shifts.startAt, endAt: shifts.endAt, workedMinutes: shifts.workedMinutes, overtimeMinutes: shifts.overtimeMinutes, lateMinutes: shifts.lateMinutes, hourlyRateCents: shifts.hourlyRateCents })
        .from(shifts)
        .where(eq(shifts.payoutId, id))
        .orderBy(asc(shifts.startAt)),
      this.db.select().from(courierAdjustments).where(eq(courierAdjustments.payoutId, id)).orderBy(asc(courierAdjustments.createdAt)),
      this.heroLedger.balance(p.courierId),
    ]);
    const periodEndExclusive = new Date(p.periodEnd.getTime() + 1);
    return {
      ...view,
      payableNowCents: payableNow,
      categories: await this.heroLedger.totals(p.courierId, p.periodStart, periodEndExclusive),
      shifts: linkedShifts.map((s) => ({ ...s, earnedCents: Math.round((s.hourlyRateCents * s.workedMinutes) / 60) })),
      adjustments: await this.adjustments.present(linkedAdjustments),
    };
  }
}
