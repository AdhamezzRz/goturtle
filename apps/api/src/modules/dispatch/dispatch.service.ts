import { ForbiddenException, HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, eq, gte, inArray, isNull, like, lt, lte, ne, not, notInArray, or, sql } from 'drizzle-orm';
import { canTransition, isValidTrackingNumber, normalizeTrackingNumber, TERMINAL_STATUSES, type OrderStatus } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { brands, couriers, orderEvents, orders, runsheets, users, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { JobsService } from '../../core/jobs.service';
import { AuditService } from '../../core/audit.service';
import { DomainError, notFound } from '../../common/errors';
import type { ActorContext } from '../../common/actor';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { cairoToday } from '../../db/helpers';
import { NetworkService } from '../network/network.service';
import { OrderWorkflowService } from '../orders/order-workflow.service';
import type { OrderRow } from '../orders/order-factory.service';
import { auditPrincipal, startOfCairoDay, withTag } from '../orders/ops-kit';
import { AssignmentService } from './assignment.service';

/** Statuses an inbound scan can move to RECEIVED_AT_HUB. */
const SLA_AT_RISK_MS = 2 * 3_600_000;
const SLA_BATCH = 100;
const SLA_MAX_BATCHES = 10;

/**
 * Hub operations (inbound / outbound / return scans), returns dispatch, the
 * live control tower and the SLA breach job.
 */
@Injectable()
export class DispatchService implements OnModuleInit {
  private readonly log = new Logger('Dispatch');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly network: NetworkService,
    private readonly workflow: OrderWorkflowService,
    private readonly assignment: AssignmentService,
  ) {}

  onModuleInit() {
    this.jobs.register({ name: 'dispatch.sla', everySeconds: 300, timeoutSeconds: 60, run: () => this.tagSlaBreaches() });
  }

  // ------------------------------------------------------------------ scans

  private async byTracking(raw: string): Promise<OrderRow> {
    const tn = normalizeTrackingNumber(raw);
    if (!isValidTrackingNumber(tn)) throw new DomainError('INVALID_TRACKING_NUMBER', `${raw} is not a valid tracking number`, HttpStatus.BAD_REQUEST);
    const [order] = await this.db.select().from(orders).where(eq(orders.trackingNumber, tn)).limit(1);
    if (!order) throw notFound('Order', tn);
    return order;
  }

  private assertHub(p: Principal, hubId: string) {
    if (p.kind === 'user' && p.hubId && p.hubId !== hubId) throw new ForbiddenException({ code: 'WRONG_HUB', message: 'You can only scan at your own hub' });
  }

  /** Parcel arrives at a hub (from a pickup, a transfer or a failed delivery). Returns sorting info. */
  async inboundScan(hubId: string, rawTn: string, p: Principal, actor: ActorContext, meta: RequestMetaInfo) {
    this.assertHub(p, hubId);
    const hub = await this.network.hub(hubId);
    if (!hub.isActive) throw new DomainError('HUB_INACTIVE', 'This hub is inactive', HttpStatus.UNPROCESSABLE_ENTITY);
    const found = await this.byTracking(rawTn);
    let alreadyScanned = false;
    let action: 'RECEIVED' | 'TRANSFERRED' | 'RETURN_RECEIVED' | 'ALREADY_SCANNED' = 'RECEIVED';

    const order = await this.workflow.run(async (tx, fx) => {
      const o = await this.workflow.lock(tx, found.id);
      if (o.status === 'RECEIVED_AT_HUB') {
        if (o.hubId === hubId) {
          alreadyScanned = true;
          action = 'ALREADY_SCANNED';
          return o;
        }
        await tx.update(orders).set({ hubId }).where(eq(orders.id, o.id));
        await this.workflow.addNote(tx, o, actor, { reason: 'HUB_TRANSFER', note: `Transferred to ${hub.code}`, hubId, isPublic: true });
        action = 'TRANSFERRED';
        return { ...o, hubId };
      }
      if (o.status === 'RETURN_PENDING' || o.status === 'RETURN_OUT') {
        let cur = o;
        if (o.status === 'RETURN_OUT') cur = await this.workflow.apply(tx, fx, o.id, 'RETURN_PENDING', actor, { reason: 'RETURN_BACK_AT_HUB', hubId, meta });
        await tx.update(orders).set({ hubId, courierId: null }).where(eq(orders.id, o.id));
        await this.workflow.addNote(tx, cur, actor, { reason: 'RETURN_RECEIVED_AT_HUB', note: `Return received at ${hub.code}`, hubId, isPublic: false });
        action = 'RETURN_RECEIVED';
        return { ...cur, hubId, courierId: null };
      }
      if (!canTransition(o.status, 'RECEIVED_AT_HUB')) {
        throw new DomainError('INVALID_TRANSITION', `${o.trackingNumber} is ${o.status} and cannot be received at a hub`, HttpStatus.CONFLICT, { from: o.status, to: 'RECEIVED_AT_HUB' });
      }
      return this.workflow.apply(tx, fx, o.id, 'RECEIVED_AT_HUB', actor, { hubId, clearRunsheet: o.status === 'ASSIGNED', meta });
    });

    const zone = await this.network.zoneById(order.zoneId);
    const correctHub = !zone!.hubId || zone!.hubId === hubId;
    const suggestion = order.status === 'RECEIVED_AT_HUB' && correctHub ? await this.assignment.bestFor(order, zone!) : null;
    const now = Date.now();
    return {
      action,
      alreadyScanned,
      order: { id: order.id, trackingNumber: order.trackingNumber, status: order.status, type: order.type, collectCents: order.collectCents, recipientName: order.recipientName, brandId: order.brandId, attempts: order.attempts },
      sort: {
        bin: zone!.code,
        zone: this.network.zoneSummary(zone!),
        isReturn: order.status === 'RETURN_PENDING',
        isCorrectHub: correctHub,
        transferTo: correctHub ? null : zone!.hubCode,
        suggestedHero: suggestion ? { ...suggestion.courier, score: suggestion.score } : null,
        promisedBy: order.promisedBy,
        slaAtRisk: !!order.promisedBy && order.promisedBy.getTime() - now < SLA_AT_RISK_MS,
        scheduledDate: order.scheduledDate,
      },
    };
  }

  /** Hero loading at the hub: confirms the parcel belongs to the runsheet. */
  async outboundScan(runsheetId: string, rawTn: string, actor: ActorContext) {
    const [rs] = await this.db.select().from(runsheets).where(eq(runsheets.id, runsheetId)).limit(1);
    if (!rs) throw notFound('Runsheet', runsheetId);
    const order = await this.byTracking(rawTn);
    if (order.runsheetId !== rs.id || !['ASSIGNED', 'OUT_FOR_DELIVERY'].includes(order.status)) {
      throw new DomainError('ORDER_NOT_ON_RUNSHEET', `${order.trackingNumber} is not on ${rs.code} — put it aside`, HttpStatus.UNPROCESSABLE_ENTITY, { trackingNumber: order.trackingNumber, status: order.status, runsheetId: order.runsheetId });
    }
    const stopIds = (await this.db.select({ id: orders.id }).from(orders).where(and(eq(orders.runsheetId, rs.id), inArray(orders.status, ['ASSIGNED', 'OUT_FOR_DELIVERY'])))).map((r) => r.id);
    const loadedRows = await this.db
      .select({ orderId: orderEvents.orderId })
      .from(orderEvents)
      .where(and(inArray(orderEvents.orderId, stopIds), eq(orderEvents.reason, 'LOADED'), like(orderEvents.note, `%${rs.code}%`)));
    const loaded = new Set(loadedRows.map((r) => r.orderId));
    const alreadyLoaded = loaded.has(order.id);
    if (!alreadyLoaded) {
      await this.db.transaction((tx) => this.workflow.addNote(tx, order, actor, { reason: 'LOADED', note: `Loaded on ${rs.code}`, hubId: rs.hubId, metadata: { runsheetId: rs.id } }));
      loaded.add(order.id);
    }
    return { ok: true, alreadyLoaded, trackingNumber: order.trackingNumber, routeSequence: order.routeSequence, progress: { loaded: loaded.size, total: stopIds.length } };
  }

  /** Brand collects a returned parcel at the hub counter (RETURN_PENDING → RETURNED, return fee charged). */
  async returnToBrand(rawTn: string, dto: { receivedBy?: string; note?: string }, actor: ActorContext, meta: RequestMetaInfo) {
    const order = await this.byTracking(rawTn);
    if (order.status !== 'RETURN_PENDING' && order.status !== 'RETURN_OUT') {
      throw new DomainError('INVALID_TRANSITION', `${order.trackingNumber} is ${order.status}, not a pending return`, HttpStatus.CONFLICT, { from: order.status, to: 'RETURNED' });
    }
    const updated = await this.workflow.transition(order.id, 'RETURNED', actor, {
      note: [dto.receivedBy && `Received by ${dto.receivedBy}`, dto.note].filter(Boolean).join(' — ') || 'Handed back to the brand at the hub',
      delivery: { receivedBy: dto.receivedBy ?? null },
      meta,
    });
    return { id: updated.id, trackingNumber: updated.trackingNumber, status: updated.status, returnFee: (updated.metadata as { returnFee?: unknown } | null)?.returnFee ?? null };
  }

  /** Sends pending returns back to their brands with a hero (RETURN_PENDING → RETURN_OUT). */
  async assignReturns(courierId: string, orderIds: string[], actor: ActorContext, meta: RequestMetaInfo) {
    const [courier] = await this.db.select({ id: couriers.id, status: couriers.status }).from(couriers).where(eq(couriers.id, courierId)).limit(1);
    if (!courier) throw notFound('Hero', courierId);
    if (courier.status !== 'ACTIVE') throw new DomainError('COURIER_INACTIVE', 'This hero is not active', HttpStatus.UNPROCESSABLE_ENTITY);
    const results = await this.workflow.run(async (tx, fx) => {
      const out = [];
      for (const id of [...new Set(orderIds)].sort()) {
        const o = await this.workflow.lock(tx, id);
        if (o.status !== 'RETURN_PENDING') throw new DomainError('INVALID_TRANSITION', `${o.trackingNumber} is ${o.status}, not RETURN_PENDING`, HttpStatus.CONFLICT, { orderId: id, from: o.status, to: 'RETURN_OUT' });
        if (o.courierId && o.courierId !== courierId) throw new DomainError('RETURN_WITH_OTHER_HERO', `${o.trackingNumber} is still with another hero — scan it in at the hub first`, HttpStatus.CONFLICT, { orderId: id });
        const u = await this.workflow.apply(tx, fx, id, 'RETURN_OUT', actor, { courierId, meta, note: 'Out for return to the brand' });
        out.push({ id: u.id, trackingNumber: u.trackingNumber, status: u.status });
      }
      await this.audit.record(auditPrincipal(actor), { action: 'returns.assign', entity: 'Courier', entityId: courierId, after: { orderIds } }, meta, tx);
      return out;
    });
    return { courierId, orders: results };
  }

  // ------------------------------------------------------------------ control tower

  /** Cheap snapshot for the ops map (poll every ~10 s). */
  async live(hubId?: string) {
    const today = cairoToday();
    const now = new Date();
    const dayStart = startOfCairoDay(today);
    const heroRows = await this.db
      .select({
        id: couriers.id, code: couriers.code, name: users.name, phone: users.phone, availability: couriers.availability, vehicleType: couriers.vehicleType,
        lat: couriers.lastLat, lng: couriers.lastLng, lastSeenAt: couriers.lastSeenAt, cashOnHandCents: couriers.cashOnHandCents, cashLimitCents: couriers.cashLimitCents,
        homeHubId: couriers.homeHubId,
      })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(and(eq(couriers.status, 'ACTIVE'), hubId ? eq(couriers.homeHubId, hubId) : undefined));
    const sheets = await this.db
      .select({ id: runsheets.id, code: runsheets.code, status: runsheets.status, courierId: runsheets.courierId, expectedCodCents: runsheets.expectedCodCents, collectedCents: runsheets.collectedCents })
      .from(runsheets)
      .where(and(eq(runsheets.date, today), inArray(runsheets.status, ['DRAFT', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED'])));
    const sheetIds = sheets.map((s) => s.id);
    const progressRows = sheetIds.length
      ? await this.db.select({ id: orders.runsheetId, status: orders.status, n: count() }).from(orders).where(inArray(orders.runsheetId, sheetIds)).groupBy(orders.runsheetId, orders.status)
      : [];
    const progress = new Map<string, { total: number; delivered: number; failed: number; pending: number }>();
    for (const r of progressRows) {
      const p = progress.get(r.id!) ?? { total: 0, delivered: 0, failed: 0, pending: 0 };
      p.total += Number(r.n);
      if (r.status === 'DELIVERED') p.delivered += Number(r.n);
      else if (['FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_PENDING'].includes(r.status)) p.failed += Number(r.n);
      else if (r.status === 'ASSIGNED' || r.status === 'OUT_FOR_DELIVERY') p.pending += Number(r.n);
      progress.set(r.id!, p);
    }
    const sheetByCourier = new Map<string, (typeof sheets)[number][]>();
    for (const s of sheets) sheetByCourier.set(s.courierId, [...(sheetByCourier.get(s.courierId) ?? []), s]);
    const heroes = heroRows
      .filter((h) => h.availability !== 'OFFLINE' || sheetByCourier.has(h.id))
      .map((h) => {
        const list = sheetByCourier.get(h.id) ?? [];
        const active = list.find((s) => s.status === 'IN_PROGRESS') ?? list.find((s) => s.status === 'DISPATCHED') ?? list[0] ?? null;
        return {
          ...h,
          online: h.availability !== 'OFFLINE',
          stale: !h.lastSeenAt || now.getTime() - h.lastSeenAt.getTime() > 15 * 60_000,
          cashUsage: h.cashLimitCents ? Math.round((h.cashOnHandCents / h.cashLimitCents) * 100) : 0,
          runsheet: active ? { ...active, progress: progress.get(active.id) ?? { total: 0, delivered: 0, failed: 0, pending: 0 } } : null,
        };
      });

    const hubCond = hubId ? eq(orders.hubId, hubId) : undefined;
    const active = await this.db
      .select({
        id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, courierId: orders.courierId, lat: orders.lat, lng: orders.lng,
        zoneCode: zones.code, zoneLat: zones.centerLat, zoneLng: zones.centerLng, promisedBy: orders.promisedBy, collectCents: orders.collectCents, routeSequence: orders.routeSequence,
      })
      .from(orders)
      .innerJoin(zones, eq(zones.id, orders.zoneId))
      .where(and(inArray(orders.status, ['OUT_FOR_DELIVERY']), hubCond))
      .limit(2000);
    const slaRows = await this.db
      .select({
        id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, promisedBy: orders.promisedBy, courierId: orders.courierId,
        zoneCode: zones.code, brandCode: brands.code, courierCode: couriers.code,
      })
      .from(orders)
      .innerJoin(zones, eq(zones.id, orders.zoneId))
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .leftJoin(couriers, eq(couriers.id, orders.courierId))
      .where(and(lte(orders.promisedBy, new Date(now.getTime() + SLA_AT_RISK_MS)), notInArray(orders.status, [...TERMINAL_STATUSES, 'RETURN_PENDING', 'RETURN_OUT']), hubCond))
      .orderBy(asc(orders.promisedBy))
      .limit(100);
    const counters = await this.db
      .select({ status: orders.status, n: count() })
      .from(orders)
      .where(and(inArray(orders.status, ['RECEIVED_AT_HUB', 'ASSIGNED', 'OUT_FOR_DELIVERY']), hubCond))
      .groupBy(orders.status);
    const [today_] = await this.db
      .select({
        delivered: sql<number>`coalesce(sum(case when ${orders.status} = 'DELIVERED' and ${orders.deliveredAt} >= ${dayStart} then 1 else 0 end), 0)`.mapWith(Number),
        collectedCents: sql<number>`coalesce(sum(case when ${orders.status} = 'DELIVERED' and ${orders.deliveredAt} >= ${dayStart} then ${orders.collectedCents} else 0 end), 0)`.mapWith(Number),
      })
      .from(orders)
      .where(and(gte(orders.updatedAt, dayStart), hubCond));
    const [failedToday] = await this.db
      .select({ n: count() })
      .from(orderEvents)
      .where(and(eq(orderEvents.status, 'FAILED_ATTEMPT'), ne(orderEvents.fromStatus, 'FAILED_ATTEMPT'), gte(orderEvents.createdAt, dayStart)));
    const c = Object.fromEntries(counters.map((r) => [r.status, Number(r.n)])) as Partial<Record<OrderStatus, number>>;
    return {
      serverTime: now,
      date: today,
      counters: {
        heroesOnline: heroes.filter((h) => h.online).length,
        atHub: c.RECEIVED_AT_HUB ?? 0,
        assigned: c.ASSIGNED ?? 0,
        outForDelivery: c.OUT_FOR_DELIVERY ?? 0,
        deliveredToday: today_?.delivered ?? 0,
        collectedTodayCents: today_?.collectedCents ?? 0,
        failedToday: Number(failedToday?.n ?? 0),
        slaAtRisk: slaRows.length,
      },
      heroes,
      orders: active.map((o) => ({ id: o.id, trackingNumber: o.trackingNumber, status: o.status, courierId: o.courierId, lat: o.lat ?? o.zoneLat, lng: o.lng ?? o.zoneLng, approximate: o.lat == null, zoneCode: o.zoneCode, promisedBy: o.promisedBy, collectCents: o.collectCents, routeSequence: o.routeSequence })),
      slaAtRisk: slaRows.map((o) => ({ ...o, overdue: !!o.promisedBy && o.promisedBy.getTime() < now.getTime(), minutesLeft: o.promisedBy ? Math.round((o.promisedBy.getTime() - now.getTime()) / 60_000) : null })),
    };
  }

  // ------------------------------------------------------------------ jobs

  /** Tags overdue, non-final orders with SLA_BREACH once (batched, ≤ 1,000 per run). */
  async tagSlaBreaches(): Promise<string> {
    let tagged = 0;
    const now = new Date();
    const since = new Date(now.getTime() - 14 * 86_400_000);
    for (let batch = 0; batch < SLA_MAX_BATCHES; batch++) {
      const rows = await this.db
        .select({ id: orders.id, tags: orders.tags })
        .from(orders)
        .where(
          and(
            lt(orders.promisedBy, now),
            gte(orders.promisedBy, since),
            notInArray(orders.status, [...TERMINAL_STATUSES]),
            or(isNull(orders.tags), not(like(orders.tags, '%"SLA_BREACH"%'))),
          ),
        )
        .limit(SLA_BATCH);
      if (!rows.length) break;
      for (const r of rows) {
        await this.db.update(orders).set({ tags: withTag(r.tags, 'SLA_BREACH') }).where(eq(orders.id, r.id));
        tagged++;
      }
      if (rows.length < SLA_BATCH) break;
    }
    if (tagged) this.log.log(`tagged ${tagged} SLA breach(es)`);
    return `tagged ${tagged}`;
  }
}
