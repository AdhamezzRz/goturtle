import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, count, desc, eq, gte, inArray, isNull, like, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { SettlementCycle, SettlementStatus } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brands, orders, settlements } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { JobsService } from '../../core/jobs.service';
import { SequenceService } from '../../core/sequence.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { DomainEvents, type SettlementPaidEvent } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import type { Principal } from '../../common/principal';
import { principalUserId } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { cairoToday, likeEscape, loadByIds } from '../../db/helpers';
import { addDays, cairoDayStart, csvRow, dayDiff, egp, resolveDayRange, toNumber, weekdayOf } from '../couriers/workforce.util';
import type { ListSettlementsQuery } from './dto/finance.dto';
import { SettlementNettingService } from './settlement-netting.service';

type SettlementRow = typeof settlements.$inferSelect;
type BrandRow = typeof brands.$inferSelect;

/** A Sunday used to decide which Sundays are BIWEEKLY settlement days. */
export const BIWEEKLY_ANCHOR = '2026-01-04';
const OPEN: SettlementStatus[] = ['DRAFT', 'APPROVED'];

/** Is a settlement due for this cycle on this Cairo day? */
export function isSettlementDay(cycle: SettlementCycle, day: string): boolean {
  switch (cycle) {
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return weekdayOf(day) === 0;
    case 'BIWEEKLY':
      return weekdayOf(day) === 0 && Math.abs(Math.round(dayDiff(BIWEEKLY_ANCHOR, day) / 7)) % 2 === 0;
    case 'MONTHLY':
      return day.endsWith('-01');
  }
}

/** First settlement day on or after `day`. */
export function nextSettlementDay(cycle: SettlementCycle, day: string): string {
  let d = day;
  for (let i = 0; i < 62 && !isSettlementDay(cycle, d); i++) d = addDays(d, 1);
  return d;
}

/**
 * Brand settlements: COD collected minus fees (incl. VAT) for finalised orders,
 * computed from the ledger so the statement always equals the wallet movements.
 * DRAFT → APPROVED → PAID (posts the payout), or CANCELLED (orders released).
 */
@Injectable()
export class SettlementsService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly sequences: SequenceService,
    private readonly postings: PostingsService,
    private readonly events: EventEmitter2,
    private readonly netting: SettlementNettingService,
  ) {}

  onModuleInit() {
    this.jobs.register({ name: 'finance.settlements', everySeconds: 3600, timeoutSeconds: 100, run: () => this.runDue() });
  }

  // -------------------------------------------------------------- generation

  /** Generates DRAFT settlements for every active brand (or one brand) with unsettled final orders. */
  async generate(input: { brandId?: string; periodEnd?: Date }, principal: Principal | null, meta: RequestMetaInfo | null) {
    const periodEnd = input.periodEnd ?? new Date();
    if (Number.isNaN(periodEnd.getTime())) throw new DomainError('INVALID_DATE', 'periodEnd is not a valid date', HttpStatus.BAD_REQUEST);
    if (periodEnd.getTime() > Date.now() + 60_000) throw new DomainError('PERIOD_IN_FUTURE', 'periodEnd cannot be in the future', HttpStatus.BAD_REQUEST);
    let targets: BrandRow[];
    if (input.brandId) {
      const [b] = await this.db.select().from(brands).where(eq(brands.id, input.brandId)).limit(1);
      if (!b) throw notFound('Brand', input.brandId);
      targets = [b];
    } else {
      targets = await this.db.select().from(brands).where(eq(brands.status, 'ACTIVE')).orderBy(asc(brands.code));
    }
    const created: string[] = [];
    const skipped: Array<{ brandId: string; code: string; reason: string }> = [];
    for (const b of targets) {
      const id = await this.generateForBrand(b.id, periodEnd, principal, meta);
      if (id) created.push(id);
      else skipped.push({ brandId: b.id, code: b.code, reason: 'NO_UNSETTLED_ORDERS' });
    }
    const rows = created.length ? await this.db.select().from(settlements).where(inArray(settlements.id, created)) : [];
    return { periodEnd, created: await this.present(rows), skipped };
  }

  /** One brand, one transaction. Returns the new settlement id or null when there is nothing to settle. */
  async generateForBrand(brandId: string, periodEnd: Date, principal: Principal | null, meta: RequestMetaInfo | null): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).for('update');
      // Postings to this wallet wait for us, so balance, open settlements and pending orders are one consistent picture.
      const wallet = await this.netting.lockWallet(tx, brandId);
      const finalAt = sql`coalesce(${orders.deliveredAt}, ${orders.returnedAt}, ${orders.updatedAt})`;
      const candidates = await tx
        .select({ id: orders.id, deliveredAt: orders.deliveredAt, returnedAt: orders.returnedAt, updatedAt: orders.updatedAt })
        .from(orders)
        .where(and(eq(orders.brandId, brandId), inArray(orders.status, ['DELIVERED', 'RETURNED']), isNull(orders.settlementId), lte(finalAt, periodEnd)))
        .for('update');
      // Unpaid non-order movements (early payouts, claims, advance fees …) computed before the orders are linked.
      const { residualCents } = await this.netting.residual(tx, brandId, wallet);
      if (!candidates.length && residualCents <= 0) return null;

      const [previous] = await tx
        .select({ periodEnd: settlements.periodEnd })
        .from(settlements)
        .where(and(eq(settlements.brandId, brandId), ne(settlements.status, 'CANCELLED')))
        .orderBy(desc(settlements.periodEnd))
        .limit(1);
      const earliest = candidates.reduce((min, o) => {
        const t = o.deliveredAt ?? o.returnedAt ?? o.updatedAt;
        return t < min ? t : min;
      }, periodEnd);
      const periodStart = previous && previous.periodEnd < earliest ? previous.periodEnd : earliest;
      const year = cairoToday(periodEnd).slice(0, 4);
      const code = await this.sequences.code('SET', 'settlement', 6, tx);
      const invoiceNumber = await this.sequences.code(`INV-${year}`, `invoice:${year}`, 6, tx);
      const [row] = await tx
        .insert(settlements)
        .values({ code, brandId, periodStart, periodEnd, status: 'DRAFT', invoiceNumber })
        .$returningId();
      const ids = candidates.map((c) => c.id);
      for (let i = 0; i < ids.length; i += 500) {
        await tx.update(orders).set({ settlementId: row.id }).where(and(inArray(orders.id, ids.slice(i, i + 500)), isNull(orders.settlementId)));
      }
      const orderPart = await this.computeTotals(tx, row.id, brandId);
      // Outstanding COD advances come back first, within what this settlement can absorb.
      const recovered = await this.netting.recoverAdvances(tx, brandId, row.id, Math.max(0, orderPart.netPayableCents + residualCents), principalUserId(principal));
      const adjustmentsCents = SettlementNettingService.adjustmentFor(residualCents - recovered, orderPart.netPayableCents);
      const totals = { ...orderPart, adjustmentsCents, netPayableCents: orderPart.netPayableCents + adjustmentsCents };
      await tx.update(settlements).set(totals).where(eq(settlements.id, row.id));
      await this.audit.record(principal, { action: 'settlement.generate', entity: 'Settlement', entityId: row.id, after: { code, brandId, periodEnd, ...totals } }, meta, tx);
      return row.id;
    });
  }

  /**
   * Order part of the totals straight from the ledger: COD = brand-wallet
   * collection credits of the linked orders, fees = their wallet debits minus
   * any other credits (fee reversals), VAT = their 2300 credits. Adjustments
   * (early payouts, advance recoveries, claims …) are added by generation —
   * see SettlementNettingService.
   */
  async computeTotals(tx: DbOrTx, settlementId: string, brandId: string) {
    const o = await this.netting.orderTotals(tx, settlementId, brandId);
    return {
      ordersCount: o.ordersCount,
      codCollectedCents: o.codCollectedCents,
      feesCents: o.feesCents,
      vatCents: o.vatCents,
      adjustmentsCents: 0,
      netPayableCents: o.netCents,
    };
  }

  /**
   * Job `finance.settlements` (hourly): brands whose cycle is due today (Cairo:
   * DAILY every day, WEEKLY on Sunday, BIWEEKLY every other Sunday, MONTHLY on
   * the 1st) get a DRAFT settlement up to today 00:00 — once per period.
   */
  async runDue(now = new Date()): Promise<string> {
    const today = cairoToday(now);
    const periodEnd = cairoDayStart(today);
    const due = (await this.db.select().from(brands).where(eq(brands.status, 'ACTIVE')).orderBy(asc(brands.code))).filter((b) => isSettlementDay(b.settlementCycle, today));
    let created = 0;
    for (const b of due.slice(0, 100)) {
      const [exists] = await this.db.select({ id: settlements.id }).from(settlements).where(and(eq(settlements.brandId, b.id), eq(settlements.periodEnd, periodEnd))).limit(1);
      if (exists) continue;
      if (await this.generateForBrand(b.id, periodEnd, null, null)) created++;
    }
    return `${today}: ${due.length} brands due, ${created} settlements created`;
  }

  // ---------------------------------------------------------- state changes

  private async lockOpen(tx: DbOrTx, id: string, allowed: SettlementStatus[], verb: string) {
    const [s] = await tx.select().from(settlements).where(eq(settlements.id, id)).for('update');
    if (!s) throw notFound('Settlement', id);
    if (!allowed.includes(s.status)) throw new DomainError('INVALID_STATE', `A ${s.status} settlement cannot be ${verb}`, HttpStatus.CONFLICT, { status: s.status });
    return s;
  }

  async approve(id: string, principal: Principal, meta: RequestMetaInfo) {
    await this.db.transaction(async (tx) => {
      const s = await this.lockOpen(tx, id, ['DRAFT'], 'approved');
      // Re-derive the order part from the ledger in case postings changed after generation; adjustments stay as netted.
      const orderPart = await this.computeTotals(tx, id, s.brandId);
      const totals = { ...orderPart, adjustmentsCents: s.adjustmentsCents, netPayableCents: orderPart.netPayableCents + s.adjustmentsCents };
      await tx.update(settlements).set({ ...totals, status: 'APPROVED', approvedById: principalUserId(principal), approvedAt: new Date() }).where(eq(settlements.id, id));
      await this.audit.record(principal, { action: 'settlement.approve', entity: 'Settlement', entityId: id, before: { status: s.status, netPayableCents: s.netPayableCents }, after: { status: 'APPROVED', ...totals } }, meta, tx);
    });
    return this.detail(id);
  }

  async pay(id: string, dto: { method?: SettlementRow['method']; paymentReference: string }, principal: Principal, meta: RequestMetaInfo) {
    const paid = await this.db.transaction(async (tx) => {
      const s = await this.lockOpen(tx, id, ['APPROVED'], 'paid (approve it first)');
      const [brand] = await tx.select().from(brands).where(eq(brands.id, s.brandId)).limit(1);
      const method = dto.method ?? brand.payoutMethod;
      await this.postings.brandPayout(tx, { id: s.id, code: s.code, brandId: s.brandId, netPayableCents: s.netPayableCents, method }, principalUserId(principal));
      const paidAt = new Date();
      await tx.update(settlements).set({ status: 'PAID', method, paymentReference: dto.paymentReference, paidAt }).where(eq(settlements.id, id));
      await this.audit.record(principal, { action: 'settlement.pay', entity: 'Settlement', entityId: id, before: { status: s.status }, after: { status: 'PAID', method, paymentReference: dto.paymentReference, netPayableCents: s.netPayableCents } }, meta, tx);
      return s;
    });
    this.events.emit(DomainEvents.SettlementPaid, { settlementId: paid.id, brandId: paid.brandId, netPayableCents: paid.netPayableCents } satisfies SettlementPaidEvent);
    return this.detail(id);
  }

  async cancel(id: string, reason: string, principal: Principal, meta: RequestMetaInfo) {
    await this.db.transaction(async (tx) => {
      const s = await this.lockOpen(tx, id, OPEN, 'cancelled');
      const [res] = (await tx.update(orders).set({ settlementId: null }).where(eq(orders.settlementId, id))) as unknown as [{ affectedRows: number }];
      const notes = `${s.notes ? `${s.notes}\n` : ''}CANCELLED: ${reason}`.slice(-1000);
      await tx.update(settlements).set({ status: 'CANCELLED', notes }).where(eq(settlements.id, id));
      await this.audit.record(principal, { action: 'settlement.cancel', entity: 'Settlement', entityId: id, before: { status: s.status }, after: { status: 'CANCELLED', reason, releasedOrders: res.affectedRows } }, meta, tx);
    });
    return this.detail(id);
  }

  // ---------------------------------------------------------------- reading

  async list(q: ListSettlementsQuery, scope: { brandId?: string | null; excludeCancelled?: boolean } = {}) {
    const brandId = scope.brandId ?? q.brandId;
    const conds: Array<SQL | undefined> = [
      brandId ? eq(settlements.brandId, brandId) : undefined,
      q.status ? eq(settlements.status, q.status) : undefined,
      scope.excludeCancelled ? ne(settlements.status, 'CANCELLED') : undefined,
    ];
    if (q.from || q.to) {
      const r = resolveDayRange(q.from, q.to, 30, 3660);
      conds.push(gte(settlements.periodEnd, r.start), lt(settlements.periodEnd, r.end));
    }
    if (q.q?.trim()) {
      const term = `%${likeEscape(q.q.trim())}%`;
      conds.push(or(like(settlements.code, term), like(settlements.invoiceNumber, term), like(settlements.paymentReference, term)));
    }
    const where = and(...conds);
    const dir = q.order === 'asc' ? asc : desc;
    const [rows, [{ n }], [sum]] = await Promise.all([
      this.db.select().from(settlements).where(where).orderBy(dir(settlements.createdAt), dir(settlements.id)).limit(q.pageSize).offset(offsetOf(q)),
      this.db.select({ n: count() }).from(settlements).where(where),
      this.db
        .select({
          net: sql<number>`coalesce(sum(${settlements.netPayableCents}), 0)`.mapWith(Number),
          cod: sql<number>`coalesce(sum(${settlements.codCollectedCents}), 0)`.mapWith(Number),
          fees: sql<number>`coalesce(sum(${settlements.feesCents}), 0)`.mapWith(Number),
        })
        .from(settlements)
        .where(where),
    ]);
    return { ...paginate(await this.present(rows), Number(n), q), totals: { netPayableCents: toNumber(sum?.net), codCollectedCents: toNumber(sum?.cod), feesCents: toNumber(sum?.fees) } };
  }

  async present(rows: SettlementRow[]) {
    const brandMap = await loadByIds(this.db, brands, brands.id, rows.map((r) => r.brandId));
    return rows.map((r) => {
      const b = brandMap.get(r.brandId);
      return { ...r, brand: b ? { id: b.id, code: b.code, name: b.name, settlementCycle: b.settlementCycle, payoutMethod: b.payoutMethod } : null };
    });
  }

  async getRow(id: string, brandScope?: string | null) {
    const [s] = await this.db.select().from(settlements).where(eq(settlements.id, id)).limit(1);
    if (!s || (brandScope && s.brandId !== brandScope)) throw notFound('Settlement', id);
    return s;
  }

  /** Settlement with its order lines (fees per order from the ledger). */
  async detail(id: string, brandScope?: string | null) {
    const s = await this.getRow(id, brandScope);
    const [view] = await this.present([s]);
    const [brand] = await this.db.select({ payoutDetails: brands.payoutDetails, legalName: brands.legalName, taxId: brands.taxId }).from(brands).where(eq(brands.id, s.brandId)).limit(1);
    const [lines, adjustmentLines] = await Promise.all([this.lines(s), this.netting.adjustmentLines(this.db, s)]);
    return { ...view, brand: view.brand ? { ...view.brand, ...brand } : null, lines, linesCount: lines.length, adjustmentLines };
  }

  async lines(s: SettlementRow) {
    const [orderRows, money] = await Promise.all([
      this.db
        .select({
          id: orders.id, trackingNumber: orders.trackingNumber, brandReference: orders.brandReference, status: orders.status,
          recipientName: orders.recipientName, codAmountCents: orders.codAmountCents, collectedCents: orders.collectedCents,
          deliveredAt: orders.deliveredAt, returnedAt: orders.returnedAt,
        })
        .from(orders)
        .where(eq(orders.settlementId, s.id))
        .orderBy(asc(orders.deliveredAt), asc(orders.returnedAt), asc(orders.id))
        .limit(20_000),
      this.netting.orderLines(this.db, s.id, s.brandId),
    ]);
    return orderRows.map((o) => {
      const m = money.get(o.id) ?? { codCents: 0, feesCents: 0 };
      return { ...o, codCents: m.codCents, feesCents: m.feesCents, netCents: m.codCents - m.feesCents };
    });
  }

  /** CSV statement: summary block followed by one line per order. */
  async csv(id: string, brandScope?: string | null): Promise<{ filename: string; content: string }> {
    const d = await this.detail(id, brandScope);
    const rows: string[] = [
      csvRow(['Settlement', d.code]),
      csvRow(['Invoice', d.invoiceNumber ?? '']),
      csvRow(['Brand', `${d.brand?.name ?? ''} (${d.brand?.code ?? ''})`]),
      csvRow(['Period start', d.periodStart.toISOString()]),
      csvRow(['Period end', d.periodEnd.toISOString()]),
      csvRow(['Status', d.status]),
      csvRow(['Orders', d.ordersCount]),
      csvRow(['COD collected (EGP)', egp(d.codCollectedCents)]),
      csvRow(['Fees incl. VAT (EGP)', egp(d.feesCents)]),
      csvRow(['of which VAT (EGP)', egp(d.vatCents)]),
      csvRow(['Adjustments (EGP)', egp(d.adjustmentsCents)]),
      csvRow(['Net payable (EGP)', egp(d.netPayableCents)]),
      csvRow(['Payment reference', d.paymentReference ?? '']),
      '',
      csvRow(['Tracking number', 'Brand reference', 'Status', 'Recipient', 'Final at', 'COD collected (EGP)', 'Fees (EGP)', 'Net (EGP)']),
      ...d.lines.map((l) =>
        csvRow([l.trackingNumber, l.brandReference ?? '', l.status, l.recipientName, (l.deliveredAt ?? l.returnedAt)?.toISOString() ?? '', egp(l.codCents), egp(l.feesCents), egp(l.netCents)]),
      ),
      ...(d.adjustmentLines.length
        ? ['', csvRow(['Adjustment', 'Reference', 'Date', 'Amount (EGP)']), ...d.adjustmentLines.map((a) => csvRow([a.description, a.reference ?? '', a.createdAt?.toISOString() ?? '', egp(a.amountCents)]))]
        : []),
    ];
    return { filename: `${d.code}${d.invoiceNumber ? `_${d.invoiceNumber}` : ''}.csv`, content: `﻿${rows.join('\r\n')}\r\n` };
  }

  /** Open (DRAFT/APPROVED) settlement totals for a brand. */
  async openTotal(brandId: string): Promise<number> {
    const [row] = await this.db
      .select({ s: sql<number>`coalesce(sum(${settlements.netPayableCents}), 0)`.mapWith(Number) })
      .from(settlements)
      .where(and(eq(settlements.brandId, brandId), inArray(settlements.status, OPEN)));
    return toNumber(row?.s);
  }
}
