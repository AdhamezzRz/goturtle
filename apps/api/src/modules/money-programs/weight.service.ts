import { ForbiddenException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { formatEgp, isValidTrackingNumber, normalizeTrackingNumber, type OrderStatus, type QuoteInput, type WeightDisputeStatus } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brands, ledgerTransactions, orders, tickets, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { actorFromPrincipal } from '../../common/actor';
import { brandScope, isStaff, principalUserId, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { OrderWorkflowService } from '../orders/order-workflow.service';
import type { OrderRow } from '../orders/order-factory.service';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TicketsService } from '../tickets/tickets.service';
import type { FinanceSettings } from '../settings/settings.registry';
import type { ListWeightQuery, ResolveWeightDisputeDto, WeighDto, WeightDisputeDto } from './money-programs.dto';

/** Too late to weigh: the fees are final. */
const NOT_WEIGHABLE: OrderStatus[] = ['DELIVERED', 'RETURNED', 'CANCELLED', 'LOST'];
const kg = (g: number) => `${(g / 1000).toFixed(2)} kg`;

/** Volumetric weight in grams: L × W × H (cm) / divisor gives kg. */
export function volumetricGrams(d: { l: number; w: number; h: number } | null | undefined, divisor: number): number {
  if (!d) return 0;
  return Math.ceil((d.l * d.w * d.h * 1000) / divisor);
}

/** Allowed excess over the declared weight before re-pricing: the larger of the gram and percentage tolerances. */
export function toleranceGrams(declaredGrams: number, fin: Pick<FinanceSettings, 'weightToleranceGrams' | 'weightTolerancePct'>): number {
  return Math.max(fin.weightToleranceGrams, Math.floor((declaredGrams * fin.weightTolerancePct) / 100));
}

/**
 * Hub weighing & weight disputes.
 *  weigh   → billable = max(actual, volumetric); beyond tolerance the order is
 *            re-quoted with the brand's rate card at the billable weight and
 *            the fee delta (incl. VAT) is posted as FEE_ADJUSTMENT.
 *  dispute → brand, within weightDisputeWindowHours: DISPUTED + WEIGHT_DISPUTE ticket.
 *  resolve → ops: ACCEPTED (kept) or REVERSED (exact mirror posting).
 */
@Injectable()
export class WeightService {
  private readonly log = new Logger('Weight');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly workflow: OrderWorkflowService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly postings: PostingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly tickets: TicketsService,
  ) {}

  private async byTracking(raw: string): Promise<OrderRow> {
    const tn = normalizeTrackingNumber(raw);
    if (!isValidTrackingNumber(tn)) throw new DomainError('INVALID_TRACKING_NUMBER', `${raw} is not a valid tracking number`, HttpStatus.BAD_REQUEST);
    const [o] = await this.db.select().from(orders).where(eq(orders.trackingNumber, tn)).limit(1);
    if (!o) throw notFound('Order', tn);
    return o;
  }

  /** Fee delta of re-quoting the order at `billableGrams` vs its declared weight (same rate card, same inputs). */
  async quoteDelta(tx: DbOrTx, o: OrderRow, billableGrams: number) {
    const [{ tier }] = await tx.select({ tier: zones.tier }).from(zones).where(eq(zones.id, o.zoneId)).limit(1);
    const { card } = await this.pricing.rateCardForBrand(o.brandId, tx);
    const base: QuoteInput = {
      tier, serviceLevel: o.serviceLevel, type: o.type, weightGrams: o.weightGrams, paymentMethod: o.paymentMethod,
      codAmountCents: o.codAmountCents, declaredValueCents: o.declaredValueCents, feesPaidBy: o.feesPaidBy,
    };
    const declared = this.pricing.computeQuote(card, base);
    const billable = this.pricing.computeQuote(card, { ...base, weightGrams: billableGrams });
    return {
      feeCents: billable.subtotalCents - declared.subtotalCents,
      vatCents: billable.vatCents - declared.vatCents,
      totalCents: billable.totalFeesCents - declared.totalFeesCents,
      declaredQuote: declared,
      billableQuote: billable,
    };
  }

  async weigh(dto: WeighDto, p: Principal, meta: RequestMetaInfo) {
    const found = await this.byTracking(dto.trackingNumber);
    const fin = await this.settings.get('finance');
    if (p.kind === 'user' && p.hubId && found.hubId && found.hubId !== p.hubId) throw new ForbiddenException({ code: 'WRONG_HUB', message: 'This parcel belongs to another hub' });
    const result = await this.workflow.run(async (tx) => {
      const o = await this.workflow.lock(tx, found.id);
      if (o.actualWeightGrams !== null) return { order: o, alreadyWeighed: true, adjusted: o.weightStatus !== 'NONE', deltaCents: o.weightAdjustmentCents };
      if (NOT_WEIGHABLE.includes(o.status)) throw new DomainError('NOT_WEIGHABLE', `A ${o.status} parcel can no longer be re-weighed`, HttpStatus.CONFLICT, { status: o.status });
      const volumetric = volumetricGrams(dto.dimensionsCm, fin.volumetricDivisor);
      const billable = Math.max(dto.weightGrams, volumetric);
      const tolerance = toleranceGrams(o.weightGrams, fin);
      let delta = { feeCents: 0, vatCents: 0, totalCents: 0 };
      if (billable - o.weightGrams > tolerance) delta = await this.quoteDelta(tx, o, billable);
      const adjusted = delta.totalCents > 0;
      if (adjusted) await this.postings.weightAdjustment(tx, o, { feeCents: delta.feeCents, vatCents: delta.vatCents, billableGrams: billable }, principalUserId(p));
      const patch = {
        actualWeightGrams: dto.weightGrams,
        dimensionsCm: dto.dimensionsCm ? { l: dto.dimensionsCm.l, w: dto.dimensionsCm.w, h: dto.dimensionsCm.h } : null,
        weightStatus: (adjusted ? 'ADJUSTED' : 'NONE') as WeightDisputeStatus,
        weightAdjustmentCents: adjusted ? delta.totalCents : 0,
        metadata: { ...(o.metadata ?? {}), weighing: { billableGrams: billable, volumetricGrams: volumetric, toleranceGrams: tolerance, feeCents: delta.feeCents, vatCents: delta.vatCents, at: new Date().toISOString(), by: p.name } },
      };
      await tx.update(orders).set(patch).where(eq(orders.id, o.id));
      await this.workflow.addNote(tx, o, actorFromPrincipal(p), {
        reason: adjusted ? 'WEIGHT_ADJUSTED' : 'WEIGHED',
        note: adjusted ? `Weighed ${kg(billable)} billable (declared ${kg(o.weightGrams)}): +${formatEgp(delta.totalCents)} incl. VAT` : `Weighed ${kg(billable)} (declared ${kg(o.weightGrams)}) — within tolerance`,
        hubId: p.kind === 'user' ? p.hubId : null,
        metadata: { actualGrams: dto.weightGrams, volumetricGrams: volumetric, billableGrams: billable, deltaCents: delta.totalCents },
      });
      await this.audit.record(p, { action: 'order.weigh', entity: 'Order', entityId: o.id, before: { weightGrams: o.weightGrams }, after: { actualWeightGrams: dto.weightGrams, billableGrams: billable, adjustmentCents: delta.totalCents } }, meta, tx);
      return { order: { ...o, ...patch } as OrderRow, alreadyWeighed: false, adjusted, deltaCents: delta.totalCents };
    });
    if (result.adjusted && !result.alreadyWeighed) {
      const w = result.order.metadata?.weighing as { billableGrams: number } | undefined;
      await this.notifications
        .notifyBrandOwners(
          result.order.brandId,
          'weight_adjusted',
          { tn: result.order.trackingNumber, billable: kg(w?.billableGrams ?? 0), declared: kg(result.order.weightGrams), amount: formatEgp(result.deltaCents, 'ar'), hours: fin.weightDisputeWindowHours },
          { orderId: result.order.id, data: { orderId: result.order.id, link: `/brand/orders/${result.order.id}` } },
        )
        .catch((err) => this.log.warn(`weight_adjusted notification failed: ${err instanceof Error ? err.message : err}`));
    }
    return { alreadyWeighed: result.alreadyWeighed, ...(await this.view(result.order, fin)) };
  }

  /** Weight panel of an order (staff or the owning brand). */
  async forOrder(orderId: string, p: Principal) {
    const scope = brandScope(p);
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o || (scope && o.brandId !== scope)) throw notFound('Order', orderId);
    return this.view(o, await this.settings.get('finance'));
  }

  private async adjustedAt(orderId: string, db: DbOrTx = this.db): Promise<Date | null> {
    const [t] = await db.select({ at: ledgerTransactions.createdAt }).from(ledgerTransactions).where(eq(ledgerTransactions.reference, `order:${orderId}:weight_adjustment`)).limit(1);
    return t?.at ?? null;
  }

  private async view(o: OrderRow, fin: FinanceSettings) {
    const w = (o.metadata?.weighing ?? null) as { billableGrams: number; volumetricGrams: number; toleranceGrams: number; feeCents: number; vatCents: number; at: string; by: string } | null;
    const dispute = (o.metadata?.weightDispute ?? null) as { note: string; evidence: string[]; at: string; ticketId: string | null; decision?: string; decisionNote?: string; decidedAt?: string } | null;
    const adjustedAt = o.weightStatus !== 'NONE' ? await this.adjustedAt(o.id) : null;
    const deadline = adjustedAt ? new Date(adjustedAt.getTime() + fin.weightDisputeWindowHours * 3_600_000) : null;
    const [ticket] = dispute?.ticketId ? await this.db.select({ id: tickets.id, code: tickets.code, status: tickets.status }).from(tickets).where(eq(tickets.id, dispute.ticketId)).limit(1) : [];
    return {
      orderId: o.id,
      trackingNumber: o.trackingNumber,
      brandId: o.brandId,
      status: o.weightStatus,
      declaredGrams: o.weightGrams,
      actualGrams: o.actualWeightGrams,
      dimensionsCm: o.dimensionsCm ?? null,
      volumetricGrams: w?.volumetricGrams ?? null,
      billableGrams: w?.billableGrams ?? null,
      toleranceGrams: w?.toleranceGrams ?? toleranceGrams(o.weightGrams, fin),
      adjustmentCents: o.weightAdjustmentCents,
      feeCents: w?.feeCents ?? 0,
      vatCents: w?.vatCents ?? 0,
      weighedAt: w?.at ?? null,
      weighedBy: w?.by ?? null,
      adjustedAt,
      disputeDeadline: deadline,
      canDispute: o.weightStatus === 'ADJUSTED' && !!deadline && deadline.getTime() > Date.now(),
      dispute: dispute ? { ...dispute, ticket: ticket ?? null } : null,
    };
  }

  // ------------------------------------------------------------------ disputes

  async dispute(dto: WeightDisputeDto, p: Principal, meta: RequestMetaInfo) {
    const scope = brandScope(p);
    if (!scope) throw new DomainError('BRAND_ONLY', 'Weight disputes are opened by the brand', HttpStatus.FORBIDDEN);
    const fin = await this.settings.get('finance');
    const disputed = await this.workflow.run(async (tx) => {
      const o = await this.workflow.lock(tx, dto.orderId).catch(() => null);
      if (!o || o.brandId !== scope) throw notFound('Order', dto.orderId);
      if (o.weightStatus !== 'ADJUSTED') throw new DomainError('NOT_DISPUTABLE', o.weightStatus === 'NONE' ? 'This order was not re-priced' : `The weight adjustment is already ${o.weightStatus}`, HttpStatus.CONFLICT, { status: o.weightStatus });
      const at = await this.adjustedAt(o.id, tx);
      if (!at || at.getTime() + fin.weightDisputeWindowHours * 3_600_000 < Date.now()) {
        throw new DomainError('DISPUTE_WINDOW_CLOSED', `Weight disputes must be opened within ${fin.weightDisputeWindowHours} hours`, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const dispute = { note: dto.note.trim(), evidence: dto.evidence ?? [], at: new Date().toISOString(), ticketId: null as string | null };
      await tx.update(orders).set({ weightStatus: 'DISPUTED', metadata: { ...(o.metadata ?? {}), weightDispute: dispute } }).where(eq(orders.id, o.id));
      await this.workflow.addNote(tx, o, actorFromPrincipal(p), { reason: 'WEIGHT_DISPUTED', note: dto.note.trim().slice(0, 1000), metadata: { evidence: dto.evidence ?? [] } });
      await this.audit.record(p, { action: 'order.weight_dispute', entity: 'Order', entityId: o.id, after: { note: dto.note } }, meta, tx);
      return o;
    });
    try {
      const ticket = await this.tickets.create(
        p,
        {
          subject: `Weight dispute — ${disputed.trackingNumber}`, category: 'WEIGHT_DISPUTE', priority: 'MEDIUM', orderId: disputed.id,
          body: `${dto.note.trim()}\n\nDeclared ${kg(disputed.weightGrams)}, adjustment ${formatEgp(disputed.weightAdjustmentCents)}.`, attachments: dto.evidence,
        },
        meta,
      );
      await this.db.transaction(async (tx) => {
        const [o] = await tx.select({ metadata: orders.metadata }).from(orders).where(eq(orders.id, disputed.id)).for('update');
        const d = (o?.metadata?.weightDispute ?? {}) as Record<string, unknown>;
        await tx.update(orders).set({ metadata: { ...(o?.metadata ?? {}), weightDispute: { ...d, ticketId: ticket.id } } }).where(eq(orders.id, disputed.id));
      });
    } catch (err) {
      // The dispute stands even if the ticket could not be opened; ops sees it in the weight queue.
      this.log.error(`weight dispute ticket for ${disputed.trackingNumber} failed: ${err instanceof Error ? err.message : err}`);
    }
    return this.forOrder(disputed.id, p);
  }

  async resolve(orderId: string, dto: ResolveWeightDisputeDto, p: Principal, meta: RequestMetaInfo) {
    const resolved = await this.workflow.run(async (tx) => {
      const o = await this.workflow.lock(tx, orderId);
      if (o.weightStatus !== 'DISPUTED') throw new DomainError('NOT_DISPUTED', `There is no open weight dispute (status ${o.weightStatus})`, HttpStatus.CONFLICT, { status: o.weightStatus });
      if (dto.decision === 'REVERSED') await this.postings.weightAdjustmentReversal(tx, o, principalUserId(p));
      const d = (o.metadata?.weightDispute ?? {}) as Record<string, unknown>;
      const weightDispute = { ...d, decision: dto.decision, decisionNote: dto.note.trim(), decidedAt: new Date().toISOString(), decidedBy: p.name };
      await tx.update(orders).set({ weightStatus: dto.decision, metadata: { ...(o.metadata ?? {}), weightDispute } }).where(eq(orders.id, o.id));
      await this.workflow.addNote(tx, o, actorFromPrincipal(p), {
        reason: dto.decision === 'REVERSED' ? 'WEIGHT_ADJUSTMENT_REVERSED' : 'WEIGHT_ADJUSTMENT_KEPT',
        note: `${dto.decision === 'REVERSED' ? `Refunded ${formatEgp(o.weightAdjustmentCents)}` : 'Adjustment kept'}: ${dto.note.trim()}`.slice(0, 1000),
      });
      await this.audit.record(p, { action: 'order.weight_resolve', entity: 'Order', entityId: o.id, before: { weightStatus: o.weightStatus }, after: { weightStatus: dto.decision, note: dto.note } }, meta, tx);
      return { order: o, ticketId: (d.ticketId as string | null) ?? null };
    });
    if (resolved.ticketId) {
      await this.tickets
        .reply(p, resolved.ticketId, { body: `${dto.decision === 'REVERSED' ? 'Dispute upheld — the weight fee was refunded to your wallet.' : 'The weight adjustment was confirmed.'}\n${dto.note.trim()}` }, meta)
        .then(() => this.tickets.setStatus(p, resolved.ticketId!, 'RESOLVED', meta))
        .catch((err) => this.log.warn(`weight dispute ticket update failed: ${err instanceof Error ? err.message : err}`));
    }
    const decision = dto.decision === 'REVERSED' ? `تم رد ${formatEgp(resolved.order.weightAdjustmentCents, 'ar')}` : 'تم تثبيت التعديل';
    await this.notifications
      .notifyBrandOwners(resolved.order.brandId, 'weight_dispute_resolved', { tn: resolved.order.trackingNumber, decision, note: dto.note.trim() }, { orderId, data: { orderId, link: `/brand/orders/${orderId}` } })
      .catch((err) => this.log.warn(`weight_dispute_resolved notification failed: ${err instanceof Error ? err.message : err}`));
    return this.forOrder(orderId, p);
  }

  /** Re-priced / disputed orders (ops queue, or a brand's own). */
  async list(q: ListWeightQuery, p: Principal) {
    const scope = brandScope(p);
    const conds: Array<SQL | undefined> = [
      ne(orders.weightStatus, 'NONE'),
      scope ? eq(orders.brandId, scope) : q.brandId ? eq(orders.brandId, q.brandId) : undefined,
      q.status ? eq(orders.weightStatus, q.status) : undefined,
    ];
    const where = and(...conds);
    const [rows, [{ n }], counts] = await Promise.all([
      this.db
        .select({
          id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, brandId: orders.brandId, brandName: brands.name,
          weightGrams: orders.weightGrams, actualWeightGrams: orders.actualWeightGrams, weightStatus: orders.weightStatus,
          weightAdjustmentCents: orders.weightAdjustmentCents, metadata: orders.metadata, updatedAt: orders.updatedAt,
        })
        .from(orders)
        .innerJoin(brands, eq(brands.id, orders.brandId))
        .where(where)
        .orderBy(desc(orders.updatedAt), desc(orders.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(orders).where(where),
      isStaff(p)
        ? this.db.select({ status: orders.weightStatus, n: count() }).from(orders).where(inArray(orders.weightStatus, ['ADJUSTED', 'DISPUTED'])).groupBy(orders.weightStatus)
        : Promise.resolve([]),
    ]);
    return {
      ...paginate(
        rows.map(({ metadata, ...r }) => ({
          ...r,
          billableGrams: ((metadata?.weighing ?? null) as { billableGrams?: number } | null)?.billableGrams ?? null,
          dispute: (metadata?.weightDispute ?? null) as { note: string; at: string } | null,
        })),
        Number(n),
        q,
      ),
      counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    };
  }
}
