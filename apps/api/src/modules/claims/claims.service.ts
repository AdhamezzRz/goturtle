import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, like, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  formatEgp, isValidTrackingNumber, normalizeTrackingNumber, type ClaimStatus, type ClaimType, type OrderStatus,
} from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { auditLogs, brands, claims, couriers, orderEvents, orders, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { SequenceService } from '../../core/sequence.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { brandScope, isStaff, principalUserId, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { likeEscape, loadByIds } from '../../db/helpers';
import { config } from '../../config';
import { AdjustmentsService } from '../finance/adjustments.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { FinanceSettings } from '../settings/settings.registry';
import type { ApproveClaimDto, CreateClaimDto, ListClaimsQuery } from './claims.dto';

type ClaimRow = typeof claims.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

/** A parcel with no movement for this long counts as stuck (a LOST claim may be filed). */
export const STUCK_AFTER_HOURS = 120;
/** Statuses during which a parcel can get stuck in the network. */
const STUCK_CANDIDATES: OrderStatus[] = ['PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED', 'ON_HOLD', 'RETURN_PENDING', 'RETURN_OUT'];
const STATUS_AR: Record<ClaimStatus, string> = { OPEN: 'مفتوحة', UNDER_REVIEW: 'قيد المراجعة', APPROVED: 'مقبولة', REJECTED: 'مرفوضة', PAID: 'تم الصرف' };
const TYPE_EN: Record<ClaimType, string> = { LOST: 'Lost parcel', DAMAGED: 'Damaged parcel', MISSING_ITEMS: 'Missing items', WRONG_ITEM: 'Wrong item', DELAYED: 'Delayed delivery' };

/**
 * Claims for lost / damaged / missing / wrong items and late deliveries.
 * OPEN → UNDER_REVIEW → APPROVED → PAID (CLAIM_PAYOUT into the brand wallet,
 * paid out with the next settlement) or REJECTED. The liability is capped at
 * the declared value (or the default cap when nothing was declared); the
 * responsible hero can be charged through a PENALTY adjustment.
 */
@Injectable()
export class ClaimsService {
  private readonly log = new Logger('Claims');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly postings: PostingsService,
    private readonly adjustments: AdjustmentsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ rules

  /** Liability cap: what was declared, else the default cap; never more than claimed. */
  static capFor(order: Pick<OrderRow, 'declaredValueCents'>, claimedCents: number, fin: Pick<FinanceSettings, 'claimDefaultCapCents'>): number {
    const limit = order.declaredValueCents > 0 ? order.declaredValueCents : fin.claimDefaultCapCents;
    return Math.min(claimedCents, limit);
  }

  /** Throws CLAIM_NOT_ELIGIBLE unless the order qualifies for this claim type now. */
  private async assertEligible(tx: DbOrTx, o: OrderRow, type: ClaimType, fin: FinanceSettings, now: Date) {
    const refuse = (message: string, details?: Record<string, unknown>) => {
      throw new DomainError('CLAIM_NOT_ELIGIBLE', message, HttpStatus.UNPROCESSABLE_ENTITY, { type, status: o.status, ...details });
    };
    const windowMs = fin.claimWindowHours * 3_600_000;
    const withinWindow = (d: Date | null) => !!d && now.getTime() - d.getTime() <= windowMs;
    switch (type) {
      case 'LOST': {
        if (o.status === 'LOST') return;
        if (!STUCK_CANDIDATES.includes(o.status)) refuse('A lost-parcel claim needs the parcel to be LOST or stuck in the network');
        const [last] = await tx.select({ at: sql<Date | null>`max(${orderEvents.createdAt})` }).from(orderEvents).where(eq(orderEvents.orderId, o.id));
        const lastMove = last?.at ? new Date(last.at) : o.updatedAt;
        if (now.getTime() - lastMove.getTime() < STUCK_AFTER_HOURS * 3_600_000) refuse(`The parcel moved in the last ${STUCK_AFTER_HOURS} hours — it is not stuck`, { lastMovementAt: lastMove });
        return;
      }
      case 'DAMAGED':
      case 'MISSING_ITEMS':
      case 'WRONG_ITEM': {
        // Damaged in our network (DAMAGED status) qualifies at any time; otherwise within the window after delivery / return.
        if (type === 'DAMAGED' && o.status === 'DAMAGED') return;
        const at = o.status === 'DELIVERED' ? o.deliveredAt : o.status === 'RETURNED' ? o.returnedAt : null;
        if (!at) refuse('This claim needs a delivered or returned parcel');
        if (!withinWindow(at)) refuse(`Claims must be filed within ${fin.claimWindowHours} hours of delivery or return`, { windowHours: fin.claimWindowHours });
        return;
      }
      case 'DELAYED': {
        if (!o.promisedBy) refuse('This order has no promised delivery time');
        if (o.status === 'CANCELLED') refuse('A cancelled order cannot be late');
        const reference = o.deliveredAt ?? now;
        if (reference.getTime() <= o.promisedBy!.getTime()) refuse('The parcel is not past its promised delivery time', { promisedBy: o.promisedBy });
        if (o.deliveredAt && !withinWindow(o.deliveredAt)) refuse(`Claims must be filed within ${fin.claimWindowHours} hours of delivery`, { windowHours: fin.claimWindowHours });
        return;
      }
    }
  }

  // ------------------------------------------------------------------ brand

  async create(p: Principal, dto: CreateClaimDto, meta: RequestMetaInfo) {
    const scope = brandScope(p);
    if (!dto.orderId && !dto.trackingNumber) throw new DomainError('ORDER_REQUIRED', 'Choose the shipment this claim is about', HttpStatus.BAD_REQUEST);
    let where: SQL;
    if (dto.orderId) where = eq(orders.id, dto.orderId);
    else {
      const tn = normalizeTrackingNumber(dto.trackingNumber!);
      if (!isValidTrackingNumber(tn)) throw new DomainError('INVALID_TRACKING_NUMBER', 'Tracking number is not valid', HttpStatus.BAD_REQUEST);
      where = eq(orders.trackingNumber, tn);
    }
    const fin = await this.settings.get('finance');
    const now = new Date();
    const created = await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(where).for('update').limit(1);
      if (!o || (scope && o.brandId !== scope)) throw new DomainError('INVALID_ORDER', 'Order not found', HttpStatus.BAD_REQUEST);
      await this.assertEligible(tx, o, dto.type, fin, now);
      const [dup] = await tx
        .select({ code: claims.code, status: claims.status })
        .from(claims)
        .where(and(eq(claims.orderId, o.id), eq(claims.type, dto.type), ne(claims.status, 'REJECTED')))
        .limit(1);
      if (dup) throw new DomainError('CLAIM_EXISTS', `Claim ${dup.code} for this parcel is already ${dup.status}`, HttpStatus.CONFLICT, { code: dup.code, status: dup.status });
      const liabilityCapCents = ClaimsService.capFor(o, dto.claimedCents, fin);
      const code = await this.sequences.code('CL', 'claim', 6, tx);
      const [row] = await tx
        .insert(claims)
        .values({
          code, orderId: o.id, brandId: o.brandId, type: dto.type, status: 'OPEN', claimedCents: dto.claimedCents, liabilityCapCents,
          description: dto.description.trim(), evidence: dto.evidence ?? [], courierId: o.courierId, createdById: principalUserId(p),
        })
        .$returningId();
      await this.audit.record(p, { action: 'claim.create', entity: 'Claim', entityId: row.id, after: { code, type: dto.type, claimedCents: dto.claimedCents, liabilityCapCents, orderId: o.id } }, meta, tx);
      return { id: row.id, code, order: o };
    });
    const [brand] = await this.db.select({ name: brands.name }).from(brands).where(eq(brands.id, created.order.brandId)).limit(1);
    await this.notifications
      .notifyRoles(['SUPPORT', 'OPS_MANAGER', 'FINANCE'], 'claim_filed', { code: created.code, brand: brand?.name ?? '', type: TYPE_EN[dto.type], tn: created.order.trackingNumber, amount: formatEgp(dto.claimedCents) }, {
        orderId: created.order.id,
        data: { claimId: created.id, link: `/ops/claims/${created.id}` },
      })
      .catch((err) => this.log.warn(`claim_filed notification failed: ${err instanceof Error ? err.message : err}`));
    return this.detail(p, created.id);
  }

  // ------------------------------------------------------------------ ops

  review(p: Principal, id: string, meta: RequestMetaInfo) {
    return this.decide(p, id, ['OPEN'], 'UNDER_REVIEW', meta, async () => ({}));
  }

  reject(p: Principal, id: string, note: string, meta: RequestMetaInfo) {
    return this.decide(p, id, ['OPEN', 'UNDER_REVIEW'], 'REJECTED', meta, async () => ({ decisionNote: note.trim(), decidedById: principalUserId(p), decidedAt: new Date() }), note);
  }

  approve(p: Principal, id: string, dto: ApproveClaimDto, meta: RequestMetaInfo) {
    return this.decide(
      p,
      id,
      ['OPEN', 'UNDER_REVIEW'],
      'APPROVED',
      meta,
      async (tx, c) => {
        if (dto.approvedCents > c.liabilityCapCents) {
          throw new DomainError('ABOVE_LIABILITY_CAP', `At most ${formatEgp(c.liabilityCapCents)} can be approved`, HttpStatus.UNPROCESSABLE_ENTITY, { liabilityCapCents: c.liabilityCapCents });
        }
        const charge = dto.chargeHeroCents ?? 0;
        let courierId = c.courierId;
        if (charge > 0) {
          if (charge > dto.approvedCents) throw new DomainError('CHARGE_ABOVE_APPROVED', 'The hero cannot be charged more than the approved amount', HttpStatus.UNPROCESSABLE_ENTITY);
          courierId = dto.courierId ?? c.courierId;
          if (!courierId) throw new DomainError('COURIER_REQUIRED', 'Choose the hero to charge', HttpStatus.BAD_REQUEST);
          await this.adjustments.createInTx(tx, { courierId, type: 'PENALTY', amountCents: charge, reason: `Claim ${c.code} (${TYPE_EN[c.type]})`, orderId: c.orderId }, principalUserId(p));
        }
        return { approvedCents: dto.approvedCents, decisionNote: dto.decisionNote.trim(), decidedById: principalUserId(p), decidedAt: new Date(), courierId, chargeHeroCents: charge };
      },
      dto.decisionNote,
    );
  }

  pay(p: Principal, id: string, meta: RequestMetaInfo) {
    return this.decide(p, id, ['APPROVED'], 'PAID', meta, async (tx, c) => {
      await this.postings.claimPayout(tx, { id: c.id, code: c.code, brandId: c.brandId, orderId: c.orderId, approvedCents: c.approvedCents }, principalUserId(p));
      return { paidAt: new Date() };
    }, 'Paid into your wallet — included in your next settlement.');
  }

  private async decide(
    p: Principal,
    id: string,
    from: ClaimStatus[],
    to: ClaimStatus,
    meta: RequestMetaInfo,
    apply: (tx: DbOrTx, c: ClaimRow) => Promise<Partial<ClaimRow> & { chargeHeroCents?: number }>,
    note?: string,
  ) {
    const c = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(claims).where(eq(claims.id, id)).for('update').limit(1);
      if (!row) throw notFound('Claim', id);
      if (!from.includes(row.status)) throw new DomainError('INVALID_STATE', `A ${row.status} claim cannot become ${to}`, HttpStatus.CONFLICT, { status: row.status });
      const { chargeHeroCents, ...patch } = await apply(tx, row);
      await tx.update(claims).set({ ...patch, status: to }).where(eq(claims.id, id));
      await this.audit.record(p, { action: `claim.${to.toLowerCase()}`, entity: 'Claim', entityId: id, before: { status: row.status }, after: { status: to, ...patch, ...(chargeHeroCents ? { chargeHeroCents } : {}) } }, meta, tx);
      return { ...row, ...patch, status: to } as ClaimRow;
    });
    const [o] = await this.db.select({ trackingNumber: orders.trackingNumber }).from(orders).where(eq(orders.id, c.orderId)).limit(1);
    const amount = to === 'APPROVED' || to === 'PAID' ? ` ${formatEgp(c.approvedCents, 'ar')}` : '';
    await this.notifications
      .notifyBrandOwners(c.brandId, 'claim_update', { code: c.code, tn: o?.trackingNumber ?? '', status: `${STATUS_AR[to]}${amount}`, note: note?.trim() ?? '', link: `${config.appUrl}/brand/claims?id=${c.id}` }, {
        email: to === 'APPROVED' || to === 'REJECTED' || to === 'PAID',
        orderId: c.orderId,
        data: { claimId: c.id, link: `/brand/claims?id=${c.id}` },
      })
      .catch((err) => this.log.warn(`claim_update notification failed: ${err instanceof Error ? err.message : err}`));
    return this.detail(p, id);
  }

  // ------------------------------------------------------------------ reading

  async list(p: Principal, q: ListClaimsQuery) {
    const scope = brandScope(p);
    const conds: Array<SQL | undefined> = [
      scope ? eq(claims.brandId, scope) : q.brandId ? eq(claims.brandId, q.brandId) : undefined,
      q.status ? eq(claims.status, q.status) : undefined,
      q.type ? eq(claims.type, q.type) : undefined,
      q.orderId ? eq(claims.orderId, q.orderId) : undefined,
    ];
    if (q.q?.trim()) {
      const term = `%${likeEscape(q.q.trim().toUpperCase())}%`;
      conds.push(or(like(claims.code, term), like(orders.trackingNumber, term)));
    }
    const where = and(...conds);
    const [rows, [{ n }], counts] = await Promise.all([
      this.db
        .select({ claim: claims })
        .from(claims)
        .innerJoin(orders, eq(orders.id, claims.orderId))
        .where(where)
        .orderBy(desc(claims.createdAt), desc(claims.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(claims).innerJoin(orders, eq(orders.id, claims.orderId)).where(where),
      this.db
        .select({ status: claims.status, n: count(), claimed: sql<number>`coalesce(sum(${claims.claimedCents}), 0)`.mapWith(Number), approved: sql<number>`coalesce(sum(${claims.approvedCents}), 0)`.mapWith(Number) })
        .from(claims)
        .where(scope ? eq(claims.brandId, scope) : undefined)
        .groupBy(claims.status),
    ]);
    const staff = isStaff(p);
    const data = (await this.present(rows.map((r) => r.claim))).map((c) => (staff ? c : { ...c, courierId: null, courier: null }));
    return {
      ...paginate(data, Number(n), q),
      counts: Object.fromEntries(counts.map((c) => [c.status, { n: Number(c.n), claimedCents: Number(c.claimed), approvedCents: Number(c.approved) }])),
    };
  }

  async present(rows: ClaimRow[]) {
    const [orderMap, brandMap] = await Promise.all([
      loadByIds(this.db, orders, orders.id, rows.map((r) => r.orderId)),
      loadByIds(this.db, brands, brands.id, rows.map((r) => r.brandId)),
    ]);
    const heroIds = [...new Set(rows.map((r) => r.courierId).filter((x): x is string => !!x))];
    const heroes = heroIds.length
      ? await this.db.select({ id: couriers.id, code: couriers.code, name: users.name }).from(couriers).innerJoin(users, eq(users.id, couriers.userId)).where(inArray(couriers.id, heroIds))
      : [];
    const heroMap = new Map(heroes.map((h) => [h.id, h]));
    return rows.map((r) => {
      const o = orderMap.get(r.orderId);
      const b = brandMap.get(r.brandId);
      return {
        ...r,
        order: o
          ? {
              id: o.id, trackingNumber: o.trackingNumber, status: o.status, recipientName: o.recipientName, declaredValueCents: o.declaredValueCents,
              codAmountCents: o.codAmountCents, deliveredAt: o.deliveredAt, returnedAt: o.returnedAt, promisedBy: o.promisedBy, packageDescription: o.packageDescription,
            }
          : null,
        brand: b ? { id: b.id, code: b.code, name: b.name } : null,
        courier: r.courierId ? heroMap.get(r.courierId) ?? null : null,
      };
    });
  }

  async detail(p: Principal, id: string) {
    const scope = brandScope(p);
    const [c] = await this.db.select().from(claims).where(eq(claims.id, id)).limit(1);
    if (!c || (scope && c.brandId !== scope)) throw notFound('Claim', id);
    const [view] = await this.present([c]);
    const log = await this.db
      .select({ action: auditLogs.action, actorType: auditLogs.actorType, actorId: auditLogs.actorId, after: auditLogs.after, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.entity, 'Claim'), eq(auditLogs.entityId, id)))
      .orderBy(asc(auditLogs.createdAt));
    const actorMap = await loadByIds(this.db, users, users.id, log.map((l) => l.actorId));
    const staff = isStaff(p);
    const timeline = log.map((l) => {
      const after = (l.after ?? {}) as Record<string, unknown>;
      return {
        action: l.action,
        status: (after.status as ClaimStatus | undefined) ?? 'OPEN',
        at: l.createdAt,
        // Brands see who acted on their side; GoTurtle staff appear as the team.
        actor: l.actorType === 'STAFF' && !staff ? 'GoTurtle' : (l.actorId ? actorMap.get(l.actorId)?.name : null) ?? 'GoTurtle',
        note: (after.decisionNote as string | undefined) ?? null,
        approvedCents: (after.approvedCents as number | undefined) ?? null,
        chargeHeroCents: staff ? ((after.chargeHeroCents as number | undefined) ?? null) : null,
      };
    });
    const fin = await this.settings.get('finance');
    return {
      ...view,
      courierId: staff ? view.courierId : null,
      courier: staff ? view.courier : null,
      timeline,
      defaultCapCents: fin.claimDefaultCapCents,
      capBasis: view.order && view.order.declaredValueCents > 0 ? 'DECLARED_VALUE' : 'DEFAULT_CAP',
    };
  }
}
