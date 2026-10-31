import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { applyBp, formatEgp, type AdvanceStatus, type AdvanceType, type OrderStatus } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brandAdvances, brands, ledgerAccounts, ledgerEntries, ledgerTransactions, orders, settlements, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { SequenceService } from '../../core/sequence.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { CompanyAccounts, describeRef } from '../../core/ledger/accounts';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { brandScope, principalUserId, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { loadByIds } from '../../db/helpers';
import { cairoDayStart, monthStartOf, toNumber } from '../couriers/workforce.util';
import { cairoToday } from '../../db/helpers';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { config } from '../../config';
import type { ListAdvancesQuery, PayAdvanceDto, RequestAdvanceDto } from './money-programs.dto';

type AdvanceRow = typeof brandAdvances.$inferSelect;

/** Parcels whose COD can be advanced (picked up and still moving towards the recipient). */
export const IN_TRANSIT: OrderStatus[] = ['PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'OUT_FOR_DELIVERY'];
/** Requests that still reserve eligibility. */
const RESERVING: AdvanceStatus[] = ['REQUESTED', 'APPROVED'];
const LABEL: Record<AdvanceType, { ar: string; en: string }> = {
  EARLY_PAYOUT: { ar: 'دفعة مبكرة', en: 'Early payout' },
  COD_ADVANCE: { ar: 'سلفة على التحصيل', en: 'COD advance' },
};
const STATUS_LABEL: Record<AdvanceStatus, { ar: string; en: string }> = {
  REQUESTED: { ar: 'قيد المراجعة', en: 'under review' },
  APPROVED: { ar: 'تمت الموافقة', en: 'approved' },
  PAID: { ar: 'تم التحويل', en: 'paid' },
  REJECTED: { ar: 'مرفوض', en: 'rejected' },
  RECOVERED: { ar: 'تم الاسترداد', en: 'recovered' },
  CANCELLED: { ar: 'ملغي', en: 'cancelled' },
};

/** Largest amount a so that a + fee(a) ≤ available (fee = applyBp(a, bp)). */
export function maxAmountWithFee(availableCents: number, feeBp: number): number {
  if (availableCents <= 0) return 0;
  let a = Math.floor((availableCents * 10_000) / (10_000 + feeBp));
  while (a > 0 && a + applyBp(a, feeBp) > availableCents) a--;
  while (a + 1 + applyBp(a + 1, feeBp) <= availableCents) a++;
  return a;
}

/**
 * Brand cash speed: early payouts of the wallet balance and advances against
 * in-transit COD. REQUESTED → APPROVED → PAID (→ RECOVERED for COD advances,
 * at settlement generation) or REJECTED / CANCELLED.
 *
 * Eligibility (always re-checked under the brand row lock):
 *  - early payout  = wallet − open settlements − unpaid requests (amount + fee)
 *                    − money of parcels still in transit (online prepayments)
 *  - COD advance   = in-transit COD × max rate − outstanding COD advances
 */
@Injectable()
export class AdvancesService {
  private readonly log = new Logger('Advances');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly postings: PostingsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  resolveBrand(p: Principal, requested?: string): string {
    const scoped = brandScope(p);
    if (scoped) return scoped;
    if (!requested) throw new DomainError('BRAND_REQUIRED', 'Pass brandId to look at a brand', HttpStatus.BAD_REQUEST);
    return requested;
  }

  // ------------------------------------------------------------------ eligibility

  async eligibility(brandId: string, previewAmountCents?: number, db: DbOrTx = this.db, excludeAdvanceId?: string) {
    const fin = await this.settings.get('finance');
    const walletCode = describeRef({ brandWallet: brandId }).code;
    const [wallet] = await db.select({ id: ledgerAccounts.id, balance: ledgerAccounts.balanceCents }).from(ledgerAccounts).where(eq(ledgerAccounts.code, walletCode)).limit(1);
    const notThis = excludeAdvanceId ? ne(brandAdvances.id, excludeAdvanceId) : undefined;
    const [[open], reserved, [transit], [inTransitWallet], [outstanding]] = await Promise.all([
      db
        .select({ s: sql<number>`coalesce(sum(${settlements.netPayableCents}), 0)`.mapWith(Number) })
        .from(settlements)
        .where(and(eq(settlements.brandId, brandId), inArray(settlements.status, ['DRAFT', 'APPROVED']))),
      db
        .select({ type: brandAdvances.type, amount: sql<number>`coalesce(sum(${brandAdvances.amountCents}), 0)`.mapWith(Number), fee: sql<number>`coalesce(sum(${brandAdvances.feeCents}), 0)`.mapWith(Number) })
        .from(brandAdvances)
        .where(and(eq(brandAdvances.brandId, brandId), inArray(brandAdvances.status, RESERVING), notThis))
        .groupBy(brandAdvances.type),
      db
        .select({ n: count(), cod: sql<number>`coalesce(sum(${orders.collectCents}), 0)`.mapWith(Number) })
        .from(orders)
        .where(and(eq(orders.brandId, brandId), inArray(orders.status, IN_TRANSIT), eq(orders.paymentMethod, 'COD'))),
      // Wallet money attached to parcels that are not final yet (e.g. paid online before delivery) cannot be paid early.
      wallet
        ? db
            .select({ net: sql<number>`coalesce(sum(${ledgerEntries.creditCents}) - sum(${ledgerEntries.debitCents}), 0)`.mapWith(Number) })
            .from(ledgerEntries)
            .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
            .innerJoin(orders, eq(orders.id, ledgerTransactions.orderId))
            .where(and(eq(ledgerEntries.accountId, wallet.id), isNull(orders.settlementId), notInArray(orders.status, ['DELIVERED', 'RETURNED', 'LOST', 'CANCELLED'])))
        : Promise.resolve([{ net: 0 }]),
      db
        .select({ s: sql<number>`coalesce(sum(${brandAdvances.amountCents} - ${brandAdvances.recoveredCents}), 0)`.mapWith(Number) })
        .from(brandAdvances)
        .where(and(eq(brandAdvances.brandId, brandId), eq(brandAdvances.type, 'COD_ADVANCE'), inArray(brandAdvances.status, ['REQUESTED', 'APPROVED', 'PAID']), notThis)),
    ]);
    const walletCents = wallet?.balance ?? 0;
    const openSettlementsCents = toNumber(open?.s);
    const pendingEarly = reserved.find((r) => r.type === 'EARLY_PAYOUT');
    const pendingCod = reserved.find((r) => r.type === 'COD_ADVANCE');
    const pendingRequestsCents = toNumber(pendingEarly?.amount) + toNumber(pendingEarly?.fee) + toNumber(pendingCod?.fee);
    const inTransitWalletCents = Math.max(0, toNumber(inTransitWallet?.net));
    const earlyAvailable = Math.max(0, walletCents - openSettlementsCents - pendingRequestsCents - inTransitWalletCents);

    const inTransitCodCents = toNumber(transit?.cod);
    const codCap = Math.floor((inTransitCodCents * fin.codAdvanceMaxRateBp) / 10_000);
    const outstandingCents = toNumber(outstanding?.s);
    const codAvailable = Math.max(0, codCap - outstandingCents);

    const preview = (bp: number) =>
      previewAmountCents !== undefined && previewAmountCents > 0 ? { amountCents: previewAmountCents, feeCents: applyBp(previewAmountCents, bp), totalCents: previewAmountCents + applyBp(previewAmountCents, bp) } : null;
    const earlyMax = maxAmountWithFee(earlyAvailable, fin.earlyPayoutFeeBp);
    return {
      brandId,
      minAmountCents: fin.advanceMinCents,
      earlyPayout: {
        walletCents,
        openSettlementsCents,
        pendingRequestsCents,
        inTransitWalletCents,
        availableCents: earlyAvailable,
        /** Amount the brand can receive; the fee is deducted from the wallet on top. */
        maxAmountCents: earlyMax,
        feeBp: fin.earlyPayoutFeeBp,
        eligible: earlyMax >= fin.advanceMinCents,
        preview: preview(fin.earlyPayoutFeeBp),
      },
      codAdvance: {
        inTransitOrders: Number(transit?.n ?? 0),
        inTransitCodCents,
        maxRateBp: fin.codAdvanceMaxRateBp,
        capCents: codCap,
        outstandingCents,
        availableCents: codAvailable,
        maxAmountCents: codAvailable,
        feeBp: fin.codAdvanceFeeBp,
        eligible: codAvailable >= fin.advanceMinCents,
        preview: preview(fin.codAdvanceFeeBp),
      },
    };
  }

  private assertFits(type: AdvanceType, amountCents: number, feeCents: number, e: Awaited<ReturnType<AdvancesService['eligibility']>>) {
    if (amountCents < e.minAmountCents) throw new DomainError('ADVANCE_TOO_SMALL', `The minimum is ${formatEgp(e.minAmountCents)}`, HttpStatus.UNPROCESSABLE_ENTITY, { minAmountCents: e.minAmountCents });
    if (type === 'EARLY_PAYOUT' && amountCents + feeCents > e.earlyPayout.availableCents) {
      throw new DomainError('ADVANCE_NOT_ELIGIBLE', `You can receive at most ${formatEgp(e.earlyPayout.maxAmountCents)} now`, HttpStatus.UNPROCESSABLE_ENTITY, { maxAmountCents: e.earlyPayout.maxAmountCents });
    }
    if (type === 'COD_ADVANCE' && amountCents > e.codAdvance.availableCents) {
      throw new DomainError('ADVANCE_NOT_ELIGIBLE', `You can receive at most ${formatEgp(e.codAdvance.maxAmountCents)} now`, HttpStatus.UNPROCESSABLE_ENTITY, { maxAmountCents: e.codAdvance.maxAmountCents });
    }
  }

  // ------------------------------------------------------------------ brand

  async request(p: Principal, dto: RequestAdvanceDto, meta: RequestMetaInfo) {
    const brandId = brandScope(p);
    if (!brandId || p.kind !== 'user' || p.role !== 'BRAND_OWNER') throw new DomainError('OWNER_ONLY', 'Only the brand owner can request payouts and advances', HttpStatus.FORBIDDEN);
    const fin = await this.settings.get('finance');
    const feeCents = applyBp(dto.amountCents, dto.type === 'EARLY_PAYOUT' ? fin.earlyPayoutFeeBp : fin.codAdvanceFeeBp);
    const created = await this.db.transaction(async (tx) => {
      const [brand] = await tx.select().from(brands).where(eq(brands.id, brandId)).for('update');
      if (!brand || brand.status !== 'ACTIVE') throw new DomainError('BRAND_NOT_ACTIVE', 'Your account must be active', HttpStatus.FORBIDDEN);
      this.assertFits(dto.type, dto.amountCents, feeCents, await this.eligibility(brandId, undefined, tx));
      const code = await this.sequences.code('ADV', 'brand_advance', 6, tx);
      const [row] = await tx
        .insert(brandAdvances)
        .values({ code, brandId, type: dto.type, status: 'REQUESTED', amountCents: dto.amountCents, feeCents, notes: dto.notes?.trim() || null, requestedById: principalUserId(p) })
        .$returningId();
      await this.audit.record(p, { action: 'advance.request', entity: 'BrandAdvance', entityId: row.id, after: { code, type: dto.type, amountCents: dto.amountCents, feeCents } }, meta, tx);
      return { id: row.id, code, brandName: brand.name };
    });
    await this.notifications
      .notifyRoles(['FINANCE', 'SUPER_ADMIN'], 'advance_requested', { type: LABEL[dto.type].en, code: created.code, brand: created.brandName, amount: formatEgp(dto.amountCents) }, { data: { advanceId: created.id, link: '/ops/finance/advances' } })
      .catch((err) => this.log.warn(`advance_requested notification failed: ${err instanceof Error ? err.message : err}`));
    return this.get(created.id);
  }

  async cancelOwn(p: Principal, id: string, meta: RequestMetaInfo) {
    const brandId = brandScope(p);
    if (!brandId || p.kind !== 'user' || p.role !== 'BRAND_OWNER') throw new DomainError('OWNER_ONLY', 'Only the brand owner can cancel requests', HttpStatus.FORBIDDEN);
    return this.transition(id, ['REQUESTED'], 'CANCELLED', p, meta, { brandId, note: 'Cancelled by the brand' });
  }

  // ------------------------------------------------------------------ finance

  approve(id: string, p: Principal, meta: RequestMetaInfo) {
    return this.transition(id, ['REQUESTED'], 'APPROVED', p, meta, { recheck: true });
  }

  reject(id: string, note: string, p: Principal, meta: RequestMetaInfo) {
    return this.transition(id, ['REQUESTED', 'APPROVED'], 'REJECTED', p, meta, { note });
  }

  cancel(id: string, note: string, p: Principal, meta: RequestMetaInfo) {
    return this.transition(id, ['REQUESTED', 'APPROVED'], 'CANCELLED', p, meta, { note });
  }

  async pay(id: string, dto: PayAdvanceDto, p: Principal, meta: RequestMetaInfo) {
    const paid = await this.db.transaction(async (tx) => {
      const pre = await this.getRow(id, null, tx);
      await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, pre.brandId)).for('update');
      const [a] = await tx.select().from(brandAdvances).where(eq(brandAdvances.id, id)).for('update');
      if (a.status !== 'APPROVED') throw new DomainError('INVALID_STATE', `A ${a.status} request cannot be paid (approve it first)`, HttpStatus.CONFLICT, { status: a.status });
      // Balances may have moved since approval (returns, other payouts): the money must still be there.
      this.assertFits(a.type, a.amountCents, a.feeCents, await this.eligibility(a.brandId, undefined, tx, a.id));
      const [brand] = await tx.select({ payoutMethod: brands.payoutMethod }).from(brands).where(eq(brands.id, a.brandId)).limit(1);
      const method = dto.method ?? brand.payoutMethod;
      await this.postings.brandAdvancePaid(tx, { id: a.id, code: a.code, brandId: a.brandId, type: a.type, amountCents: a.amountCents, feeCents: a.feeCents, method }, principalUserId(p));
      const paidAt = new Date();
      await tx.update(brandAdvances).set({ status: 'PAID', method, paymentReference: dto.reference, paidAt }).where(eq(brandAdvances.id, id));
      await this.audit.record(p, { action: 'advance.pay', entity: 'BrandAdvance', entityId: id, before: { status: a.status }, after: { status: 'PAID', method, reference: dto.reference, amountCents: a.amountCents, feeCents: a.feeCents } }, meta, tx);
      return a;
    });
    await this.notifyBrand(paid, 'PAID', `Ref ${dto.reference}`);
    return this.get(id);
  }

  private async transition(
    id: string,
    from: AdvanceStatus[],
    to: AdvanceStatus,
    p: Principal,
    meta: RequestMetaInfo,
    opts: { note?: string; recheck?: boolean; brandId?: string } = {},
  ) {
    const row = await this.db.transaction(async (tx) => {
      const pre = await this.getRow(id, opts.brandId ?? null, tx);
      await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, pre.brandId)).for('update');
      const [a] = await tx.select().from(brandAdvances).where(eq(brandAdvances.id, id)).for('update');
      if (!from.includes(a.status)) throw new DomainError('INVALID_STATE', `A ${a.status} request cannot become ${to}`, HttpStatus.CONFLICT, { status: a.status });
      if (opts.recheck) this.assertFits(a.type, a.amountCents, a.feeCents, await this.eligibility(a.brandId, undefined, tx, a.id));
      const notes = opts.note ? `${a.notes ? `${a.notes}\n` : ''}${to}: ${opts.note}`.slice(-1000) : a.notes;
      await tx
        .update(brandAdvances)
        .set({ status: to, notes, ...(to === 'APPROVED' ? { approvedById: principalUserId(p), approvedAt: new Date() } : {}) })
        .where(eq(brandAdvances.id, id));
      await this.audit.record(p, { action: `advance.${to.toLowerCase()}`, entity: 'BrandAdvance', entityId: id, before: { status: a.status }, after: { status: to, note: opts.note ?? null } }, meta, tx);
      return a;
    });
    if (to !== 'CANCELLED' || !opts.brandId) await this.notifyBrand(row, to, opts.note ?? '');
    return this.get(id);
  }

  private async notifyBrand(a: AdvanceRow, status: AdvanceStatus, note: string) {
    await this.notifications
      .notifyBrandOwners(
        a.brandId,
        'advance_update',
        { code: a.code, type: LABEL[a.type].ar, amount: formatEgp(a.amountCents, 'ar'), status: STATUS_LABEL[status].ar, note, link: `${config.appUrl}/brand/finance` },
        { email: status === 'PAID', data: { advanceId: a.id, link: '/brand/finance' } },
      )
      .catch((err) => this.log.warn(`advance_update notification failed: ${err instanceof Error ? err.message : err}`));
  }

  // ------------------------------------------------------------------ reading

  async getRow(id: string, brandId: string | null, db: DbOrTx = this.db): Promise<AdvanceRow> {
    const [a] = await db.select().from(brandAdvances).where(eq(brandAdvances.id, id)).limit(1);
    if (!a || (brandId && a.brandId !== brandId)) throw notFound('Advance', id);
    return a;
  }

  async get(id: string, brandId: string | null = null) {
    const [view] = await this.present([await this.getRow(id, brandId)]);
    return view;
  }

  async list(q: ListAdvancesQuery, brandId: string | null) {
    const scope = brandId ?? q.brandId;
    const where = and(
      ...([scope ? eq(brandAdvances.brandId, scope) : undefined, q.status ? eq(brandAdvances.status, q.status) : undefined, q.type ? eq(brandAdvances.type, q.type) : undefined] as Array<SQL | undefined>),
    );
    const [rows, [{ n }]] = await Promise.all([
      this.db.select().from(brandAdvances).where(where).orderBy(desc(brandAdvances.createdAt), desc(brandAdvances.id)).limit(q.pageSize).offset(offsetOf(q)),
      this.db.select({ n: count() }).from(brandAdvances).where(where),
    ]);
    return paginate(await this.present(rows), Number(n), q);
  }

  async present(rows: AdvanceRow[]) {
    const brandMap = await loadByIds(this.db, brands, brands.id, rows.map((r) => r.brandId));
    const userMap = await loadByIds(this.db, users, users.id, rows.flatMap((r) => [r.requestedById, r.approvedById]));
    return rows.map((r) => {
      const b = brandMap.get(r.brandId);
      return {
        ...r,
        outstandingCents: r.type === 'COD_ADVANCE' && (r.status === 'PAID' || r.status === 'RECOVERED') ? r.amountCents - r.recoveredCents : 0,
        totalCents: r.amountCents + r.feeCents,
        brand: b ? { id: b.id, code: b.code, name: b.name, payoutMethod: b.payoutMethod, payoutDetails: b.payoutDetails } : null,
        requestedBy: r.requestedById ? userMap.get(r.requestedById)?.name ?? null : null,
        approvedBy: r.approvedById ? userMap.get(r.approvedById)?.name ?? null : null,
      };
    });
  }

  /** Ops overview: queue counts, outstanding COD advances per brand, finance-fee revenue. */
  async overview() {
    const monthStart = cairoDayStart(monthStartOf(cairoToday()));
    const revenueCode = CompanyAccounts.REVENUE_FINANCE.code;
    const [queue, outstanding, [revenue], [revenueMonth]] = await Promise.all([
      this.db
        .select({ status: brandAdvances.status, type: brandAdvances.type, n: count(), cents: sql<number>`coalesce(sum(${brandAdvances.amountCents}), 0)`.mapWith(Number) })
        .from(brandAdvances)
        .where(inArray(brandAdvances.status, ['REQUESTED', 'APPROVED']))
        .groupBy(brandAdvances.status, brandAdvances.type),
      this.db
        .select({ brandId: brandAdvances.brandId, n: count(), cents: sql<number>`coalesce(sum(${brandAdvances.amountCents} - ${brandAdvances.recoveredCents}), 0)`.mapWith(Number) })
        .from(brandAdvances)
        .where(and(eq(brandAdvances.type, 'COD_ADVANCE'), eq(brandAdvances.status, 'PAID')))
        .groupBy(brandAdvances.brandId),
      this.db.select({ b: ledgerAccounts.balanceCents }).from(ledgerAccounts).where(eq(ledgerAccounts.code, revenueCode)).limit(1),
      this.db
        .select({ s: sql<number>`coalesce(sum(${ledgerEntries.creditCents}) - sum(${ledgerEntries.debitCents}), 0)`.mapWith(Number) })
        .from(ledgerEntries)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
        .where(and(eq(ledgerAccounts.code, revenueCode), gte(ledgerEntries.createdAt, monthStart))),
    ]);
    const brandMap = await loadByIds(this.db, brands, brands.id, outstanding.map((o) => o.brandId));
    return {
      queue: queue.map((q) => ({ status: q.status, type: q.type, n: Number(q.n), cents: toNumber(q.cents) })),
      outstandingByBrand: outstanding
        .map((o) => ({ brand: { id: o.brandId, code: brandMap.get(o.brandId)?.code ?? '', name: brandMap.get(o.brandId)?.name ?? '' }, advances: Number(o.n), outstandingCents: toNumber(o.cents) }))
        .filter((o) => o.outstandingCents > 0)
        .sort((a, b) => b.outstandingCents - a.outstandingCents),
      outstandingTotalCents: outstanding.reduce((s, o) => s + toNumber(o.cents), 0),
      feeRevenueCents: revenue?.b ?? 0,
      feeRevenueMonthCents: toNumber(revenueMonth?.s),
    };
  }
}
