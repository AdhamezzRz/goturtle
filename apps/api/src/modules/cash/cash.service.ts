import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, like, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { normalizeEgyptPhone, type HandoverMethod } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brands, cashHandovers, courierAdjustments, couriers, hubs, orders, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { SequenceService } from '../../core/sequence.service';
import { LedgerService } from '../../core/ledger/ledger.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { DomainEvents, type CashHandoverConfirmedEvent } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import type { Principal } from '../../common/principal';
import { principalUserId } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { cairoToday, likeEscape, loadByIds } from '../../db/helpers';
import { assertDay, cairoDayRange, cashWarning, hoursBetween, percent, resolveDayRange, toNumber } from '../couriers/workforce.util';
import { AdjustmentsService, REVERSAL_PREFIX } from '../finance/adjustments.service';
import type { CustodyQuery, DeclareHandoverDto, ListHandoversQuery, RecordHandoverDto, ShortageDto } from './dto/cash.dto';

type HandoverRow = typeof cashHandovers.$inferSelect;

const NON_CASH: HandoverMethod[] = ['INSTAPAY', 'VODAFONE_CASH', 'BANK_TRANSFER', 'FAWRY'];

/**
 * Delivered orders whose money the hero holds as cash: cash collections and
 * digital ones finance rejected (InstaPay / wallet / card / payment-link
 * collections never enter custody — see the money-programs module).
 */
const HERO_OWES_CASH = or(isNull(orders.collectionMethod), eq(orders.collectionMethod, 'CASH'), eq(orders.collectionStatus, 'REJECTED'))!;

/** Hub operators only see their own hub's cash desk. */
export function hubScope(p: Principal): string | null {
  return p.kind === 'user' && p.role === 'HUB_OPERATOR' && p.hubId ? p.hubId : null;
}

/**
 * Cash custody: COD the heroes hold, their handovers (declared by the hero or
 * recorded at the hub desk) and finance confirmation. Custody only moves
 * through PostingsService (cash handover, cash shortage) and never goes negative.
 */
@Injectable()
export class CashService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly ledger: LedgerService,
    private readonly postings: PostingsService,
    private readonly adjustments: AdjustmentsService,
    private readonly events: EventEmitter2,
  ) {}

  // ------------------------------------------------------------- handovers

  private validateMethod(dto: { method: HandoverMethod; reference?: string }) {
    if (NON_CASH.includes(dto.method) && !dto.reference?.trim()) {
      throw new DomainError('REFERENCE_REQUIRED', 'Enter the transfer reference for non-cash handovers', HttpStatus.BAD_REQUEST);
    }
  }

  private async pendingDeclared(tx: DbOrTx, courierId: string): Promise<number> {
    const [r] = await tx
      .select({ s: sql<number>`coalesce(sum(${cashHandovers.declaredCents}), 0)`.mapWith(Number) })
      .from(cashHandovers)
      .where(and(eq(cashHandovers.courierId, courierId), eq(cashHandovers.status, 'PENDING')));
    return toNumber(r?.s);
  }

  private async assertHub(tx: DbOrTx, hubId: string) {
    const [h] = await tx.select({ id: hubs.id }).from(hubs).where(eq(hubs.id, hubId)).limit(1);
    if (!h) throw new DomainError('INVALID_HUB', 'Hub not found', HttpStatus.BAD_REQUEST);
  }

  /** Hero declares a handover (PENDING until finance confirms). Declared ≤ custody − other pending declarations. */
  async declare(courierId: string, dto: DeclareHandoverDto) {
    this.validateMethod(dto);
    const id = await this.db.transaction(async (tx) => {
      const [hero] = await this.ledger.lockCouriers(tx, [courierId]);
      if (!hero) throw notFound('Hero', courierId);
      const available = hero.cashOnHandCents - (await this.pendingDeclared(tx, courierId));
      if (dto.amountCents > available) {
        throw new DomainError('HANDOVER_EXCEEDS_CUSTODY', 'You cannot hand over more than the cash you hold', HttpStatus.UNPROCESSABLE_ENTITY, { cashOnHandCents: hero.cashOnHandCents, availableCents: Math.max(0, available) });
      }
      const hubId = dto.hubId ?? (dto.method === 'CASH_AT_HUB' ? hero.homeHubId : null);
      if (hubId) await this.assertHub(tx, hubId);
      const code = await this.sequences.code('HO', 'handover', 6, tx);
      const [row] = await tx
        .insert(cashHandovers)
        .values({ code, courierId, hubId, method: dto.method, declaredCents: dto.amountCents, reference: dto.reference?.trim() || null, proofUrl: dto.proofUrl ?? null, notes: dto.notes ?? null, status: 'PENDING' })
        .$returningId();
      return row.id;
    });
    return this.get(id);
  }

  /** Hub desk records cash received directly from a hero: created and confirmed in one step. */
  async record(dto: RecordHandoverDto, principal: Principal, meta: RequestMetaInfo) {
    this.validateMethod(dto);
    const { id, event } = await this.db.transaction(async (tx) => {
      const [hero] = await this.ledger.lockCouriers(tx, [dto.courierId]);
      if (!hero) throw new DomainError('INVALID_COURIER', 'Hero not found', HttpStatus.BAD_REQUEST);
      const hubId = dto.hubId ?? hubScope(principal) ?? (dto.method === 'CASH_AT_HUB' ? hero.homeHubId : null);
      if (hubId) await this.assertHub(tx, hubId);
      const code = await this.sequences.code('HO', 'handover', 6, tx);
      const [row] = await tx
        .insert(cashHandovers)
        .values({ code, courierId: hero.id, hubId, method: dto.method, declaredCents: dto.amountCents, reference: dto.reference?.trim() || null, proofUrl: dto.proofUrl ?? null, notes: dto.notes ?? null, status: 'PENDING' })
        .$returningId();
      const [h] = await tx.select().from(cashHandovers).where(eq(cashHandovers.id, row.id)).for('update');
      const event = await this.confirmInTx(tx, h, dto.amountCents, dto.notes ?? null, principal, meta);
      return { id: row.id, event };
    });
    this.events.emit(DomainEvents.CashHandoverConfirmed, event);
    return this.get(id);
  }

  async confirm(id: string, dto: { receivedCents: number; notes?: string }, principal: Principal, meta: RequestMetaInfo) {
    const event = await this.db.transaction(async (tx) => {
      const [h] = await tx.select().from(cashHandovers).where(eq(cashHandovers.id, id)).for('update');
      if (!h) throw notFound('Handover', id);
      const scope = hubScope(principal);
      if (scope && h.hubId && h.hubId !== scope) throw notFound('Handover', id);
      if (h.status !== 'PENDING') throw new DomainError('INVALID_STATE', `This handover is already ${h.status}`, HttpStatus.CONFLICT, { status: h.status });
      return this.confirmInTx(tx, h, dto.receivedCents, dto.notes ?? null, principal, meta);
    });
    this.events.emit(DomainEvents.CashHandoverConfirmed, event);
    return this.get(id);
  }

  /**
   * Confirms a locked PENDING handover: posts the custody movement for what was
   * actually received, records the variance and links the hero's oldest
   * unlinked COD orders that the settled cash covers.
   */
  private async confirmInTx(tx: DbOrTx, h: HandoverRow, receivedCents: number, notes: string | null, principal: Principal, meta: RequestMetaInfo): Promise<CashHandoverConfirmedEvent> {
    const [hero] = await this.ledger.lockCouriers(tx, [h.courierId]);
    if (receivedCents > hero.cashOnHandCents) {
      throw new DomainError('HANDOVER_EXCEEDS_CUSTODY', 'Received amount exceeds the cash the hero holds', HttpStatus.UNPROCESSABLE_ENTITY, { cashOnHandCents: hero.cashOnHandCents });
    }
    await this.postings.cashHandover(tx, { id: h.id, code: h.code, courierId: h.courierId, method: h.method, receivedCents }, principalUserId(principal));
    const variance = receivedCents - h.declaredCents;
    const now = new Date();
    await tx
      .update(cashHandovers)
      .set({ status: 'CONFIRMED', receivedCents, varianceCents: variance, receivedById: principalUserId(principal), confirmedAt: now, notes: notes ? [h.notes, notes].filter(Boolean).join('\n').slice(-1000) : h.notes })
      .where(eq(cashHandovers.id, h.id));
    const linked = await this.linkOrders(tx, h.courierId, h.id);
    await this.audit.record(principal, { action: 'cash.handover.confirm', entity: 'CashHandover', entityId: h.id, before: { status: h.status, declaredCents: h.declaredCents }, after: { status: 'CONFIRMED', receivedCents, varianceCents: variance, linkedOrders: linked } }, meta, tx);
    return { handoverId: h.id, courierId: h.courierId, receivedCents, varianceCents: variance };
  }

  /**
   * Links unlinked delivered COD orders (oldest first) to this handover while
   * they fit in the cash the hero has settled so far (all confirmed handovers +
   * shortages written off − orders already linked), so leftovers carry over.
   */
  private async linkOrders(tx: DbOrTx, courierId: string, handoverId: string): Promise<number> {
    const [[received], [shortage], [linked]] = await Promise.all([
      tx.select({ s: sql<number>`coalesce(sum(${cashHandovers.receivedCents}), 0)`.mapWith(Number) }).from(cashHandovers).where(and(eq(cashHandovers.courierId, courierId), eq(cashHandovers.status, 'CONFIRMED'))),
      tx
        .select({ s: sql<number>`coalesce(sum(case when ${courierAdjustments.reason} like ${`${REVERSAL_PREFIX}%`} then -${courierAdjustments.amountCents} else ${courierAdjustments.amountCents} end), 0)`.mapWith(Number) })
        .from(courierAdjustments)
        .where(and(eq(courierAdjustments.courierId, courierId), eq(courierAdjustments.type, 'CASH_SHORTAGE'))),
      tx.select({ s: sql<number>`coalesce(sum(${orders.collectedCents}), 0)`.mapWith(Number) }).from(orders).where(and(eq(orders.courierId, courierId), isNotNull(orders.cashHandoverId))),
    ]);
    let budget = toNumber(received?.s) + toNumber(shortage?.s) - toNumber(linked?.s);
    if (budget <= 0) return 0;
    const candidates = await tx
      .select({ id: orders.id, collectedCents: orders.collectedCents })
      .from(orders)
      .where(and(eq(orders.courierId, courierId), eq(orders.status, 'DELIVERED'), sql`${orders.collectedCents} > 0`, HERO_OWES_CASH, isNull(orders.cashHandoverId)))
      .orderBy(asc(orders.deliveredAt), asc(orders.id))
      .limit(2000)
      .for('update');
    const ids: string[] = [];
    for (const o of candidates) {
      if (o.collectedCents > budget) break;
      budget -= o.collectedCents;
      ids.push(o.id);
    }
    for (let i = 0; i < ids.length; i += 500) await tx.update(orders).set({ cashHandoverId: handoverId }).where(inArray(orders.id, ids.slice(i, i + 500)));
    return ids.length;
  }

  async reject(id: string, reason: string, principal: Principal, meta: RequestMetaInfo) {
    const h = await this.getRow(id);
    const scope = hubScope(principal);
    if (scope && h.hubId && h.hubId !== scope) throw notFound('Handover', id);
    if (h.status !== 'PENDING') throw new DomainError('INVALID_STATE', `This handover is already ${h.status}`, HttpStatus.CONFLICT);
    const [res] = (await this.db
      .update(cashHandovers)
      .set({ status: 'REJECTED', receivedById: principalUserId(principal), notes: [h.notes, `REJECTED: ${reason}`].filter(Boolean).join('\n').slice(-1000) })
      .where(and(eq(cashHandovers.id, id), eq(cashHandovers.status, 'PENDING')))) as unknown as [{ affectedRows: number }];
    if (res.affectedRows !== 1) throw new DomainError('INVALID_STATE', 'The handover changed meanwhile', HttpStatus.CONFLICT);
    await this.audit.record(principal, { action: 'cash.handover.reject', entity: 'CashHandover', entityId: id, before: { status: 'PENDING' }, after: { status: 'REJECTED', reason } }, meta);
    return this.get(id);
  }

  // -------------------------------------------------------------- shortages

  /** Negative variances of confirmed handovers not yet converted to CASH_SHORTAGE adjustments (capped by custody). */
  async outstandingShortage(courierId: string, tx: DbOrTx = this.db): Promise<number> {
    const [[variance], [converted], [hero]] = await Promise.all([
      tx
        .select({ s: sql<number>`coalesce(sum(case when ${cashHandovers.varianceCents} < 0 then -${cashHandovers.varianceCents} else 0 end), 0)`.mapWith(Number) })
        .from(cashHandovers)
        .where(and(eq(cashHandovers.courierId, courierId), eq(cashHandovers.status, 'CONFIRMED'))),
      tx
        .select({ s: sql<number>`coalesce(sum(case when ${courierAdjustments.reason} like ${`${REVERSAL_PREFIX}%`} then -${courierAdjustments.amountCents} else ${courierAdjustments.amountCents} end), 0)`.mapWith(Number) })
        .from(courierAdjustments)
        .where(and(eq(courierAdjustments.courierId, courierId), eq(courierAdjustments.type, 'CASH_SHORTAGE'))),
      tx.select({ cash: couriers.cashOnHandCents }).from(couriers).where(eq(couriers.id, courierId)).limit(1),
    ]);
    return Math.max(0, Math.min(hero?.cash ?? 0, toNumber(variance?.s) - toNumber(converted?.s)));
  }

  /** Converts a shortage into a CASH_SHORTAGE adjustment: custody goes down, the amount is deducted from the hero's pay. */
  async recordShortage(dto: ShortageDto, principal: Principal, meta: RequestMetaInfo) {
    const adj = await this.db.transaction(async (tx) => {
      const [hero] = await this.ledger.lockCouriers(tx, [dto.courierId]);
      if (!hero) throw new DomainError('INVALID_COURIER', 'Hero not found', HttpStatus.BAD_REQUEST);
      const outstanding = await this.outstandingShortage(dto.courierId, tx);
      const amount = dto.amountCents ?? outstanding;
      if (amount <= 0) throw new DomainError('NO_SHORTAGE', 'This hero has no outstanding shortage', HttpStatus.UNPROCESSABLE_ENTITY);
      if (amount > hero.cashOnHandCents) {
        throw new DomainError('HANDOVER_EXCEEDS_CUSTODY', 'A shortage cannot exceed the cash the hero holds', HttpStatus.UNPROCESSABLE_ENTITY, { cashOnHandCents: hero.cashOnHandCents });
      }
      const row = await this.adjustments.createInTx(tx, { courierId: dto.courierId, type: 'CASH_SHORTAGE', amountCents: amount, reason: dto.reason }, principalUserId(principal));
      await this.audit.record(principal, { action: 'cash.shortage', entity: 'CourierAdjustment', entityId: row.id, after: { courierId: dto.courierId, amountCents: amount, outstandingBefore: outstanding } }, meta, tx);
      return row;
    });
    return { adjustment: await this.adjustments.get(adj.id), outstandingShortageCents: await this.outstandingShortage(dto.courierId) };
  }

  // ---------------------------------------------------------------- reading

  async getRow(id: string): Promise<HandoverRow> {
    const [h] = await this.db.select().from(cashHandovers).where(eq(cashHandovers.id, id)).limit(1);
    if (!h) throw notFound('Handover', id);
    return h;
  }

  async get(id: string, scope: { courierId?: string; hubId?: string | null } = {}) {
    const h = await this.getRow(id);
    if (scope.courierId && h.courierId !== scope.courierId) throw notFound('Handover', id);
    if (scope.hubId && h.hubId && h.hubId !== scope.hubId) throw notFound('Handover', id);
    const [view] = await this.present([h]);
    const linkedOrders = await this.db
      .select({ id: orders.id, trackingNumber: orders.trackingNumber, brandName: brands.name, collectedCents: orders.collectedCents, deliveredAt: orders.deliveredAt })
      .from(orders)
      .leftJoin(brands, eq(brands.id, orders.brandId))
      .where(eq(orders.cashHandoverId, id))
      .orderBy(asc(orders.deliveredAt));
    return { ...view, linkedOrders, linkedTotalCents: linkedOrders.reduce((s, o) => s + o.collectedCents, 0) };
  }

  async present(rows: HandoverRow[]) {
    const heroIds = [...new Set(rows.map((r) => r.courierId))];
    const [heroes, hubMap, receivers] = await Promise.all([
      heroIds.length
        ? this.db.select({ id: couriers.id, code: couriers.code, name: users.name, phone: users.phone }).from(couriers).innerJoin(users, eq(users.id, couriers.userId)).where(inArray(couriers.id, heroIds))
        : Promise.resolve([]),
      loadByIds(this.db, hubs, hubs.id, rows.map((r) => r.hubId)),
      loadByIds(this.db, users, users.id, rows.map((r) => r.receivedById)),
    ]);
    const heroMap = new Map(heroes.map((h) => [h.id, h]));
    return rows.map((r) => {
      const hub = r.hubId ? hubMap.get(r.hubId) : null;
      const by = r.receivedById ? receivers.get(r.receivedById) : null;
      return { ...r, courier: heroMap.get(r.courierId) ?? null, hub: hub ? { id: hub.id, code: hub.code, name: hub.name } : null, receivedBy: by ? { id: by.id, name: by.name } : null };
    });
  }

  async list(q: ListHandoversQuery, scope: { courierId?: string; hubId?: string | null } = {}) {
    const conds: Array<SQL | undefined> = [
      scope.courierId ? eq(cashHandovers.courierId, scope.courierId) : q.courierId ? eq(cashHandovers.courierId, q.courierId) : undefined,
      scope.hubId ? eq(cashHandovers.hubId, scope.hubId) : q.hubId ? eq(cashHandovers.hubId, q.hubId) : undefined,
      q.status ? eq(cashHandovers.status, q.status) : undefined,
      q.method ? eq(cashHandovers.method, q.method) : undefined,
    ];
    if (q.from || q.to) {
      const r = resolveDayRange(q.from, q.to, 30, 3660);
      conds.push(gte(cashHandovers.createdAt, r.start), lt(cashHandovers.createdAt, r.end));
    }
    if (q.q?.trim()) {
      const term = `%${likeEscape(q.q.trim())}%`;
      conds.push(or(like(cashHandovers.code, term), like(cashHandovers.reference, term), like(couriers.code, term), like(users.name, term)));
    }
    const where = and(...conds);
    const dir = q.order === 'asc' ? asc : desc;
    const base = () => this.db.select({ h: cashHandovers }).from(cashHandovers).innerJoin(couriers, eq(couriers.id, cashHandovers.courierId)).innerJoin(users, eq(users.id, couriers.userId));
    const [rows, [{ n }], [sum]] = await Promise.all([
      base().where(where).orderBy(dir(cashHandovers.createdAt), dir(cashHandovers.id)).limit(q.pageSize).offset(offsetOf(q)),
      this.db.select({ n: count() }).from(cashHandovers).innerJoin(couriers, eq(couriers.id, cashHandovers.courierId)).innerJoin(users, eq(users.id, couriers.userId)).where(where),
      this.db
        .select({
          declared: sql<number>`coalesce(sum(${cashHandovers.declaredCents}), 0)`.mapWith(Number),
          received: sql<number>`coalesce(sum(${cashHandovers.receivedCents}), 0)`.mapWith(Number),
          variance: sql<number>`coalesce(sum(${cashHandovers.varianceCents}), 0)`.mapWith(Number),
        })
        .from(cashHandovers)
        .innerJoin(couriers, eq(couriers.id, cashHandovers.courierId))
        .innerJoin(users, eq(users.id, couriers.userId))
        .where(where),
    ]);
    return {
      ...paginate(await this.present(rows.map((r) => r.h)), Number(n), q),
      totals: { declaredCents: toNumber(sum?.declared), receivedCents: toNumber(sum?.received), varianceCents: toNumber(sum?.variance) },
    };
  }

  /** Every hero's custody vs limit, oldest unhanded COD and pending handovers. */
  async custody(q: CustodyQuery, scope: { hubId?: string | null } = {}) {
    const hubId = scope.hubId ?? q.hubId;
    const conds: Array<SQL | undefined> = [
      or(ne(couriers.status, 'OFFBOARDED'), sql`${couriers.cashOnHandCents} <> 0`),
      hubId ? eq(couriers.homeHubId, hubId) : undefined,
      q.onlyWithCash === 'true' ? sql`${couriers.cashOnHandCents} > 0` : undefined,
    ];
    if (q.q?.trim()) {
      const term = `%${likeEscape(q.q.trim())}%`;
      const phone = normalizeEgyptPhone(q.q);
      conds.push(or(like(users.name, term), like(couriers.code, term), phone ? eq(users.phone, phone) : undefined));
    }
    const heroes = await this.db
      .select({
        courierId: couriers.id, code: couriers.code, name: users.name, phone: users.phone, status: couriers.status, availability: couriers.availability,
        employmentType: couriers.employmentType, homeHubId: couriers.homeHubId, cashOnHandCents: couriers.cashOnHandCents, cashLimitCents: couriers.cashLimitCents,
      })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(and(...conds))
      .limit(5000);
    const ids = heroes.map((h) => h.courierId);
    const [unhanded, pending, variances, shortages, hubMap] = await Promise.all([
      ids.length
        ? this.db
            .select({ courierId: orders.courierId, n: count(), oldest: sql<Date | null>`min(${orders.deliveredAt})`, total: sql<number>`coalesce(sum(${orders.collectedCents}), 0)`.mapWith(Number) })
            .from(orders)
            .where(and(inArray(orders.courierId, ids), eq(orders.status, 'DELIVERED'), sql`${orders.collectedCents} > 0`, HERO_OWES_CASH, isNull(orders.cashHandoverId)))
            .groupBy(orders.courierId)
        : Promise.resolve([]),
      ids.length
        ? this.db
            .select({ courierId: cashHandovers.courierId, n: count(), s: sql<number>`coalesce(sum(${cashHandovers.declaredCents}), 0)`.mapWith(Number) })
            .from(cashHandovers)
            .where(and(inArray(cashHandovers.courierId, ids), eq(cashHandovers.status, 'PENDING')))
            .groupBy(cashHandovers.courierId)
        : Promise.resolve([]),
      ids.length
        ? this.db
            .select({ courierId: cashHandovers.courierId, s: sql<number>`coalesce(sum(case when ${cashHandovers.varianceCents} < 0 then -${cashHandovers.varianceCents} else 0 end), 0)`.mapWith(Number) })
            .from(cashHandovers)
            .where(and(inArray(cashHandovers.courierId, ids), eq(cashHandovers.status, 'CONFIRMED')))
            .groupBy(cashHandovers.courierId)
        : Promise.resolve([]),
      ids.length
        ? this.db
            .select({ courierId: courierAdjustments.courierId, s: sql<number>`coalesce(sum(case when ${courierAdjustments.reason} like ${`${REVERSAL_PREFIX}%`} then -${courierAdjustments.amountCents} else ${courierAdjustments.amountCents} end), 0)`.mapWith(Number) })
            .from(courierAdjustments)
            .where(and(inArray(courierAdjustments.courierId, ids), eq(courierAdjustments.type, 'CASH_SHORTAGE')))
            .groupBy(courierAdjustments.courierId)
        : Promise.resolve([]),
      loadByIds(this.db, hubs, hubs.id, heroes.map((h) => h.homeHubId)),
    ]);
    const now = new Date();
    const uMap = new Map(unhanded.map((u) => [u.courierId!, u]));
    const pMap = new Map(pending.map((p) => [p.courierId, p]));
    const vMap = new Map(variances.map((v) => [v.courierId, toNumber(v.s)]));
    const sMap = new Map(shortages.map((s) => [s.courierId, toNumber(s.s)]));
    const rows = heroes.map((h) => {
      const u = uMap.get(h.courierId);
      const p = pMap.get(h.courierId);
      const oldest = u?.oldest ? new Date(u.oldest) : null;
      const hub = h.homeHubId ? hubMap.get(h.homeHubId) : null;
      return {
        ...h,
        hub: hub ? { id: hub.id, code: hub.code, name: hub.name } : null,
        usedPct: percent(h.cashOnHandCents, h.cashLimitCents),
        warning: cashWarning(h.cashOnHandCents, h.cashLimitCents),
        unhandedOrders: Number(u?.n ?? 0),
        unhandedCents: toNumber(u?.total),
        oldestUnhandedAt: oldest,
        oldestUnhandedHours: oldest ? hoursBetween(oldest, now) : null,
        pendingHandovers: Number(p?.n ?? 0),
        pendingDeclaredCents: toNumber(p?.s),
        outstandingShortageCents: Math.max(0, Math.min(h.cashOnHandCents, (vMap.get(h.courierId) ?? 0) - (sMap.get(h.courierId) ?? 0))),
      };
    });
    const sort = q.sort ?? 'cash';
    const asc_ = q.order === 'asc' ? 1 : -1;
    const key: Record<typeof sort, (r: (typeof rows)[number]) => number | string> = {
      cash: (r) => r.cashOnHandCents,
      usedPct: (r) => r.usedPct,
      oldest: (r) => r.oldestUnhandedHours ?? -1,
      code: (r) => r.code,
      name: (r) => r.name,
    };
    rows.sort((a, b) => {
      const ka = key[sort](a);
      const kb = key[sort](b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * asc_ || a.code.localeCompare(b.code);
    });
    const start = offsetOf(q);
    return {
      ...paginate(rows.slice(start, start + q.pageSize), rows.length, q),
      totals: {
        heroes: rows.length,
        custodyCents: rows.reduce((s, r) => s + r.cashOnHandCents, 0),
        overLimit: rows.filter((r) => r.warning === 'OVER_LIMIT').length,
        nearLimit: rows.filter((r) => r.warning === 'NEAR_LIMIT').length,
        pendingHandovers: rows.reduce((s, r) => s + r.pendingHandovers, 0),
        pendingDeclaredCents: rows.reduce((s, r) => s + r.pendingDeclaredCents, 0),
        outstandingShortageCents: rows.reduce((s, r) => s + r.outstandingShortageCents, 0),
      },
    };
  }

  /** Hub cash desk: what was received on a Cairo day, per hub and per method. */
  async hubSummary(date: string | undefined, hubFilter: string | null) {
    const day = date ? assertDay(date) : cairoToday();
    const { start, end } = cairoDayRange(day);
    const where = and(eq(cashHandovers.status, 'CONFIRMED'), gte(cashHandovers.confirmedAt, start), lt(cashHandovers.confirmedAt, end), hubFilter ? eq(cashHandovers.hubId, hubFilter) : undefined);
    const [rows, pending] = await Promise.all([
      this.db
        .select({
          hubId: cashHandovers.hubId, method: cashHandovers.method, n: count(),
          received: sql<number>`coalesce(sum(${cashHandovers.receivedCents}), 0)`.mapWith(Number),
          declared: sql<number>`coalesce(sum(${cashHandovers.declaredCents}), 0)`.mapWith(Number),
          variance: sql<number>`coalesce(sum(${cashHandovers.varianceCents}), 0)`.mapWith(Number),
        })
        .from(cashHandovers)
        .where(where)
        .groupBy(cashHandovers.hubId, cashHandovers.method),
      this.db
        .select({ hubId: cashHandovers.hubId, n: count(), s: sql<number>`coalesce(sum(${cashHandovers.declaredCents}), 0)`.mapWith(Number) })
        .from(cashHandovers)
        .where(and(eq(cashHandovers.status, 'PENDING'), hubFilter ? eq(cashHandovers.hubId, hubFilter) : undefined))
        .groupBy(cashHandovers.hubId),
    ]);
    const hubMap = await loadByIds(this.db, hubs, hubs.id, [...rows.map((r) => r.hubId), ...pending.map((p) => p.hubId)]);
    type HubLine = { hubId: string | null; code: string | null; name: string; handovers: number; receivedCents: number; declaredCents: number; varianceCents: number; byMethod: Record<string, { handovers: number; receivedCents: number }>; pendingHandovers: number; pendingDeclaredCents: number };
    const byHub = new Map<string, HubLine>();
    const line = (hubId: string | null): HubLine => {
      const k = hubId ?? 'REMOTE';
      let l = byHub.get(k);
      if (!l) {
        const h = hubId ? hubMap.get(hubId) : null;
        l = { hubId, code: h?.code ?? null, name: h?.name ?? 'Remote (transfers & wallets)', handovers: 0, receivedCents: 0, declaredCents: 0, varianceCents: 0, byMethod: {}, pendingHandovers: 0, pendingDeclaredCents: 0 };
        byHub.set(k, l);
      }
      return l;
    };
    const byMethod: Record<string, { handovers: number; receivedCents: number }> = {};
    for (const r of rows) {
      const l = line(r.hubId);
      const n = Number(r.n);
      l.handovers += n;
      l.receivedCents += toNumber(r.received);
      l.declaredCents += toNumber(r.declared);
      l.varianceCents += toNumber(r.variance);
      l.byMethod[r.method] = { handovers: (l.byMethod[r.method]?.handovers ?? 0) + n, receivedCents: (l.byMethod[r.method]?.receivedCents ?? 0) + toNumber(r.received) };
      byMethod[r.method] = { handovers: (byMethod[r.method]?.handovers ?? 0) + n, receivedCents: (byMethod[r.method]?.receivedCents ?? 0) + toNumber(r.received) };
    }
    for (const p of pending) {
      const l = line(p.hubId);
      l.pendingHandovers += Number(p.n);
      l.pendingDeclaredCents += toNumber(p.s);
    }
    const hubsOut = [...byHub.values()].sort((a, b) => b.receivedCents - a.receivedCents);
    return {
      date: day,
      hubs: hubsOut,
      byMethod,
      totals: {
        handovers: hubsOut.reduce((s, h) => s + h.handovers, 0),
        receivedCents: hubsOut.reduce((s, h) => s + h.receivedCents, 0),
        varianceCents: hubsOut.reduce((s, h) => s + h.varianceCents, 0),
        pendingHandovers: hubsOut.reduce((s, h) => s + h.pendingHandovers, 0),
      },
    };
  }

  /** Hero wallet: custody vs limit and the delivered COD orders not yet covered by a confirmed handover. */
  async wallet(courierId: string) {
    const [hero] = await this.db.select().from(couriers).where(eq(couriers.id, courierId)).limit(1);
    if (!hero) throw notFound('Hero', courierId);
    const now = new Date();
    const [items, [{ n, total }], pendingDeclared, outstandingShortage] = await Promise.all([
      this.db
        .select({ id: orders.id, trackingNumber: orders.trackingNumber, brandName: brands.name, recipientName: orders.recipientName, collectedCents: orders.collectedCents, deliveredAt: orders.deliveredAt })
        .from(orders)
        .leftJoin(brands, eq(brands.id, orders.brandId))
        .where(and(eq(orders.courierId, courierId), eq(orders.status, 'DELIVERED'), sql`${orders.collectedCents} > 0`, HERO_OWES_CASH, isNull(orders.cashHandoverId)))
        .orderBy(asc(orders.deliveredAt), asc(orders.id))
        .limit(200),
      this.db
        .select({ n: count(), total: sql<number>`coalesce(sum(${orders.collectedCents}), 0)`.mapWith(Number) })
        .from(orders)
        .where(and(eq(orders.courierId, courierId), eq(orders.status, 'DELIVERED'), sql`${orders.collectedCents} > 0`, HERO_OWES_CASH, isNull(orders.cashHandoverId))),
      this.pendingDeclared(this.db, courierId),
      this.outstandingShortage(courierId),
    ]);
    return {
      cashOnHandCents: hero.cashOnHandCents,
      cashLimitCents: hero.cashLimitCents,
      usedPct: percent(hero.cashOnHandCents, hero.cashLimitCents),
      warning: cashWarning(hero.cashOnHandCents, hero.cashLimitCents),
      pendingDeclaredCents: pendingDeclared,
      availableToDeclareCents: Math.max(0, hero.cashOnHandCents - pendingDeclared),
      outstandingShortageCents: outstandingShortage,
      unhandedOrders: Number(n),
      unhandedCents: toNumber(total),
      oldestUnhandedHours: items[0]?.deliveredAt ? hoursBetween(items[0].deliveredAt, now) : null,
      orders: items.map((o) => ({ ...o, ageHours: o.deliveredAt ? hoursBetween(o.deliveredAt, now) : null })),
    };
  }
}
