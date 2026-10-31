import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { DomainEvents, optimizeRoute, ORDER_STATUS_LABELS, formatEgyptPhone, type OrderStatus } from '@goturtle/shared';
import type { Db, DbOrTx, Tx } from '../../db/client';
import { brands, couriers, hubs, orders, runsheets, users, zones, type RouteStopJson } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { SequenceService } from '../../core/sequence.service';
import { DomainError, notFound } from '../../common/errors';
import type { ActorContext } from '../../common/actor';
import type { RequestMetaInfo } from '../../common/decorators';
import { offsetOf, paginate } from '../../common/pagination';
import { cairoToday, whereAll } from '../../db/helpers';
import { newId } from '../../db/columns';
import { NetworkService } from '../network/network.service';
import { OrderWorkflowService } from '../orders/order-workflow.service';
import { OrdersService } from '../orders/orders.service';
import { assertDayInRange, auditPrincipal, mapsLink, round2, type PostCommit } from '../orders/ops-kit';
import type { RunsheetListQuery } from './dispatch.dto';

export type RunsheetRow = typeof runsheets.$inferSelect;

/** Statuses an order can be added to a runsheet from. */
const ADDABLE: OrderStatus[] = ['RECEIVED_AT_HUB', 'PICKED_UP', 'ASSIGNED'];
/** A stop still to be served today. */
const OPEN_STOP: OrderStatus[] = ['ASSIGNED', 'OUT_FOR_DELIVERY'];
/** Stops that prevent closing (parcel still with the hero / not back at the hub). */
const BLOCKS_CLOSE: OrderStatus[] = ['ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED', 'PICKED_UP', 'RETURN_OUT'];
const POSITION_FRESH_MS = 3 * 3_600_000;

export interface RunsheetDispatchedEvent {
  runsheetId: string;
  code: string;
  courierId: string;
  orderCount: number;
  expectedCodCents: number;
  override: boolean;
}

/**
 * Daily runsheets (delivery manifests): DRAFT → DISPATCHED (orders out for
 * delivery) → IN_PROGRESS (hero started) → COMPLETED (no open stop) → CLOSED
 * (reconciled at the hub).
 */
@Injectable()
export class RunsheetsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly network: NetworkService,
    private readonly workflow: OrderWorkflowService,
    private readonly orders: OrdersService,
  ) {}

  // ------------------------------------------------------------------ writes

  async create(dto: { courierId: string; date?: string; hubId?: string; orderIds?: string[] }, actor: ActorContext, meta: RequestMetaInfo) {
    const date = dto.date ?? cairoToday();
    assertDayInRange(date, { minOffset: 0, maxOffset: 7, field: 'date' });
    const courier = await this.activeCourier(dto.courierId);
    const hubId = dto.hubId ?? courier.homeHubId ?? null;
    if (hubId) await this.network.hub(hubId);
    const id = await this.workflow.run(async (tx, fx) => {
      const rs = await this.insertDraft(tx, courier.id, date, hubId, actor);
      if (dto.orderIds?.length) await this.addInTx(tx, fx, rs, dto.orderIds, actor, meta);
      await this.audit.record(auditPrincipal(actor), { action: 'runsheet.create', entity: 'Runsheet', entityId: rs.id, after: { code: rs.code, courierId: courier.id, date, orders: dto.orderIds?.length ?? 0 } }, meta, tx);
      return rs.id;
    });
    return this.detail(id);
  }

  /** Auto-assignment: extend today's DRAFT runsheet of the hero (or open one). */
  async assignToDraft(courierId: string, date: string, orderIds: string[], actor: ActorContext, meta: RequestMetaInfo) {
    const courier = await this.activeCourier(courierId);
    return this.workflow.run(async (tx, fx) => {
      let [rs] = await tx
        .select()
        .from(runsheets)
        .where(and(eq(runsheets.courierId, courierId), eq(runsheets.date, date), eq(runsheets.status, 'DRAFT')))
        .orderBy(desc(runsheets.createdAt))
        .for('update')
        .limit(1);
      if (!rs) rs = await this.insertDraft(tx, courierId, date, courier.homeHubId ?? null, actor);
      await this.addInTx(tx, fx, rs, orderIds, actor, meta);
      await this.audit.record(auditPrincipal(actor), { action: 'runsheet.auto_assign', entity: 'Runsheet', entityId: rs.id, after: { added: orderIds.length } }, meta, tx);
      return rs;
    });
  }

  private async insertDraft(tx: DbOrTx, courierId: string, date: string, hubId: string | null, actor: ActorContext): Promise<RunsheetRow> {
    const id = newId();
    const code = await this.sequences.code('RS', 'runsheet', 6, tx);
    await tx.insert(runsheets).values({ id, code, courierId, hubId, date, status: 'DRAFT', createdById: actor.actorId });
    return (await tx.select().from(runsheets).where(eq(runsheets.id, id)).limit(1))[0];
  }

  async addOrders(id: string, orderIds: string[], actor: ActorContext, meta: RequestMetaInfo) {
    await this.workflow.run(async (tx, fx) => {
      const rs = await this.lock(tx, id);
      if (rs.status !== 'DRAFT') throw locked(rs);
      await this.addInTx(tx, fx, rs, orderIds, actor, meta);
      await this.audit.record(auditPrincipal(actor), { action: 'runsheet.add_orders', entity: 'Runsheet', entityId: id, after: { orderIds } }, meta, tx);
    });
    return this.detail(id);
  }

  private async addInTx(tx: Tx, fx: PostCommit, rs: RunsheetRow, orderIds: string[], actor: ActorContext, meta: RequestMetaInfo) {
    const touched = new Set<string>();
    for (const orderId of [...new Set(orderIds)].sort()) {
      const order = await this.workflow.lock(tx, orderId);
      if (order.runsheetId === rs.id && order.status === 'ASSIGNED') continue;
      if (!ADDABLE.includes(order.status)) {
        throw new DomainError('ORDER_NOT_DISPATCHABLE', `${order.trackingNumber} is ${order.status} and cannot be added to a runsheet`, HttpStatus.CONFLICT, { orderId, trackingNumber: order.trackingNumber, status: order.status });
      }
      if (order.status === 'ASSIGNED' && order.runsheetId && order.runsheetId !== rs.id) {
        const [other] = await tx.select({ id: runsheets.id, code: runsheets.code, status: runsheets.status }).from(runsheets).where(eq(runsheets.id, order.runsheetId)).limit(1);
        if (other && other.status !== 'DRAFT') {
          throw new DomainError('ORDER_ON_ACTIVE_RUNSHEET', `${order.trackingNumber} is on ${other.code} (${other.status})`, HttpStatus.CONFLICT, { orderId, runsheetId: other.id });
        }
        if (other) touched.add(other.id);
      }
      await this.workflow.apply(tx, fx, orderId, 'ASSIGNED', actor, { courierId: rs.courierId, runsheetId: rs.id, hubId: rs.hubId, meta, note: `Added to ${rs.code}` });
    }
    await tx.update(runsheets).set({ route: null, totalDistanceKm: null, totalMinutes: null }).where(eq(runsheets.id, rs.id));
    await this.orders.refreshRunsheetCod(tx, rs.id);
    for (const other of touched) await this.orders.refreshRunsheetCod(tx, other);
  }

  async removeOrders(id: string, orderIds: string[], actor: ActorContext, meta: RequestMetaInfo) {
    await this.workflow.run(async (tx, fx) => {
      const rs = await this.lock(tx, id);
      if (rs.status !== 'DRAFT') throw locked(rs);
      for (const orderId of [...new Set(orderIds)].sort()) {
        const order = await this.workflow.lock(tx, orderId);
        if (order.runsheetId !== rs.id) throw new DomainError('ORDER_NOT_ON_RUNSHEET', `${order.trackingNumber} is not on ${rs.code}`, HttpStatus.CONFLICT, { orderId });
        await this.workflow.apply(tx, fx, orderId, 'RECEIVED_AT_HUB', actor, { clearRunsheet: true, hubId: rs.hubId ?? order.hubId, reason: 'REMOVED_FROM_RUNSHEET', isPublic: false, note: `Removed from ${rs.code}`, meta });
      }
      await tx.update(runsheets).set({ route: null, totalDistanceKm: null, totalMinutes: null }).where(eq(runsheets.id, id));
      await this.orders.refreshRunsheetCod(tx, id);
      await this.audit.record(auditPrincipal(actor), { action: 'runsheet.remove_orders', entity: 'Runsheet', entityId: id, after: { orderIds } }, meta, tx);
    });
    return this.detail(id);
  }

  async optimize(id: string, actor: ActorContext) {
    await this.db.transaction(async (tx) => {
      const rs = await this.lock(tx, id);
      if (rs.status === 'CLOSED' || rs.status === 'COMPLETED') throw locked(rs);
      await this.optimizeInTx(tx, rs);
      await this.audit.record(auditPrincipal(actor), { action: 'runsheet.optimize', entity: 'Runsheet', entityId: id }, null, tx);
    });
    return this.detail(id);
  }

  /**
   * Nearest-neighbour + 2-opt over the open stops, starting at the hero's
   * fresh GPS position (once on the road) or the hub. Served stops keep their
   * place at the start of the route. ETAs are minutes after dispatch.
   */
  private async optimizeInTx(tx: DbOrTx, rs: RunsheetRow, now = new Date()) {
    const stops = await tx
      .select({ id: orders.id, status: orders.status, lat: orders.lat, lng: orders.lng, zoneId: orders.zoneId, routeSequence: orders.routeSequence })
      .from(orders)
      .where(eq(orders.runsheetId, rs.id));
    const [courier] = await tx.select().from(couriers).where(eq(couriers.id, rs.courierId)).limit(1);
    const hub = rs.hubId ? (await tx.select().from(hubs).where(eq(hubs.id, rs.hubId)).limit(1))[0] : courier.homeHubId ? (await tx.select().from(hubs).where(eq(hubs.id, courier.homeHubId)).limit(1))[0] : undefined;
    const fresh = rs.status !== 'DRAFT' && courier.lastLat != null && courier.lastLng != null && courier.lastSeenAt && now.getTime() - courier.lastSeenAt.getTime() < POSITION_FRESH_MS;
    const open = [];
    for (const s of stops.filter((x) => OPEN_STOP.includes(x.status))) {
      const zone = s.lat != null && s.lng != null ? null : await this.network.zoneById(s.zoneId);
      open.push({ id: s.id, lat: s.lat ?? zone!.centerLat, lng: s.lng ?? zone!.centerLng });
    }
    const start = fresh ? { lat: courier.lastLat!, lng: courier.lastLng! } : hub ? { lat: hub.lat, lng: hub.lng } : open[0] ?? { lat: 30.0444, lng: 31.2357 };
    const plan = optimizeRoute(start, open, { vehicle: courier.vehicleType });
    const offset = rs.dispatchedAt ? Math.max(0, Math.round((now.getTime() - rs.dispatchedAt.getTime()) / 60_000)) : 0;
    const previous = (rs.route ?? []).filter((r) => stops.some((s) => s.id === r.orderId && !OPEN_STOP.includes(s.status)));
    const route: RouteStopJson[] = [
      ...previous.map((r, i) => ({ ...r, seq: i + 1 })),
      ...plan.stops.map((p, i) => ({ orderId: p.id, seq: previous.length + i + 1, lat: p.lat, lng: p.lng, etaMinutes: p.etaMinutes + offset, legKm: p.legKm })),
    ];
    for (const r of route) await tx.update(orders).set({ routeSequence: r.seq }).where(eq(orders.id, r.orderId));
    await tx.update(runsheets).set({ route, totalDistanceKm: round2(plan.totalKm + previous.reduce((s, r) => s + r.legKm, 0)), totalMinutes: plan.totalMinutes + offset }).where(eq(runsheets.id, rs.id));
  }

  /** Dispatch: every ASSIGNED stop goes OUT_FOR_DELIVERY (OTP issued where required). */
  async dispatch(id: string, opts: { override?: boolean; canOverride: boolean }, actor: ActorContext, meta: RequestMetaInfo) {
    if (opts.override && !opts.canOverride) throw new DomainError('OVERRIDE_NOT_ALLOWED', 'Only operations managers can override the cash limit', HttpStatus.FORBIDDEN);
    await this.workflow.run(async (tx, fx) => {
      const rs = await this.lock(tx, id);
      if (rs.status !== 'DRAFT') throw locked(rs);
      const [courier] = await tx.select().from(couriers).where(eq(couriers.id, rs.courierId)).for('update').limit(1);
      if (courier.status !== 'ACTIVE') throw new DomainError('COURIER_INACTIVE', 'This hero is not active', HttpStatus.UNPROCESSABLE_ENTITY);
      const stops = await tx.select({ id: orders.id, collectCents: orders.collectCents }).from(orders).where(and(eq(orders.runsheetId, id), eq(orders.status, 'ASSIGNED'))).orderBy(asc(orders.id));
      if (!stops.length) throw new DomainError('RUNSHEET_EMPTY', 'Add orders before dispatching', HttpStatus.UNPROCESSABLE_ENTITY);
      const expected = stops.reduce((s, o) => s + o.collectCents, 0);
      const [{ out }] = await tx
        .select({ out: sql<number>`coalesce(sum(${orders.collectCents}), 0)`.mapWith(Number) })
        .from(orders)
        .where(and(eq(orders.courierId, courier.id), eq(orders.status, 'OUT_FOR_DELIVERY')));
      const exposure = courier.cashOnHandCents + out + expected;
      if (exposure > courier.cashLimitCents && !opts.override) {
        throw new DomainError('CASH_LIMIT_EXCEEDED', 'Dispatching this runsheet would put the hero over the cash custody limit — collect cash first or split the runsheet', HttpStatus.UNPROCESSABLE_ENTITY, {
          cashLimitCents: courier.cashLimitCents, cashOnHandCents: courier.cashOnHandCents, outForDeliveryCents: out, runsheetCodCents: expected, excessCents: exposure - courier.cashLimitCents,
        });
      }
      const now = new Date();
      if (!rs.route) await this.optimizeInTx(tx, rs, now);
      await tx.update(runsheets).set({ status: 'DISPATCHED', dispatchedAt: now, expectedCodCents: expected }).where(eq(runsheets.id, id));
      for (const s of stops) await this.workflow.apply(tx, fx, s.id, 'OUT_FOR_DELIVERY', actor, { runsheetId: id, note: `Dispatched on ${rs.code}`, meta, at: now });
      await this.audit.record(auditPrincipal(actor), { action: opts.override ? 'runsheet.dispatch_override' : 'runsheet.dispatch', entity: 'Runsheet', entityId: id, after: { orders: stops.length, expectedCodCents: expected, exposure, cashLimitCents: courier.cashLimitCents } }, meta, tx);
      fx.emit(DomainEvents.RunsheetDispatched, { runsheetId: id, code: rs.code, courierId: rs.courierId, orderCount: stops.length, expectedCodCents: expected, override: !!opts.override } satisfies RunsheetDispatchedEvent);
    });
    return this.detail(id);
  }

  /** Close at the hub: every stop final or back at the hub; reconciles expected vs collected cash. */
  async close(id: string, notes: string | undefined, actor: ActorContext, meta: RequestMetaInfo) {
    const reconciliation = await this.db.transaction(async (tx) => {
      const rs = await this.lock(tx, id);
      if (rs.status === 'CLOSED') throw locked(rs);
      const stops = await tx.select({ id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, courierId: orders.courierId, collectCents: orders.collectCents, collectedCents: orders.collectedCents }).from(orders).where(eq(orders.runsheetId, id));
      const open = stops.filter((s) => BLOCKS_CLOSE.includes(s.status) || (s.status === 'RETURN_PENDING' && s.courierId));
      if (open.length) {
        throw new DomainError('RUNSHEET_OPEN_STOPS', `${open.length} stop(s) are not final or not back at the hub yet`, HttpStatus.CONFLICT, { stops: open.map((s) => ({ orderId: s.id, trackingNumber: s.trackingNumber, status: s.status })) });
      }
      const delivered = stops.filter((s) => s.status === 'DELIVERED');
      const rec = {
        stops: stops.length,
        delivered: delivered.length,
        backAtHub: stops.filter((s) => s.status === 'RECEIVED_AT_HUB').length,
        returns: stops.filter((s) => ['RETURN_PENDING', 'RETURNED'].includes(s.status)).length,
        plannedCodCents: rs.expectedCodCents,
        expectedFromDeliveredCents: delivered.reduce((s, o) => s + o.collectCents, 0),
        collectedCents: delivered.reduce((s, o) => s + o.collectedCents, 0),
        varianceCents: 0,
      };
      rec.varianceCents = rec.collectedCents - rec.expectedFromDeliveredCents;
      const now = new Date();
      await tx.update(runsheets).set({ status: 'CLOSED', closedAt: now, completedAt: rs.completedAt ?? now, collectedCents: rec.collectedCents }).where(eq(runsheets.id, id));
      await this.audit.record(auditPrincipal(actor), { action: 'runsheet.close', entity: 'Runsheet', entityId: id, before: { status: rs.status }, after: { ...rec, notes: notes ?? null } }, meta, tx);
      return rec;
    });
    return { ...(await this.detail(id)), reconciliation };
  }

  /** Hero: start the day (DISPATCHED → IN_PROGRESS); stops added after dispatch go out too. */
  async heroStart(id: string, actor: ActorContext) {
    await this.workflow.run(async (tx, fx) => {
      const rs = await this.lock(tx, id);
      if (rs.courierId !== actor.courierId) throw notFound('Runsheet', id);
      if (rs.status === 'IN_PROGRESS') return;
      if (rs.status !== 'DISPATCHED') throw new DomainError('RUNSHEET_NOT_DISPATCHED', `Runsheet is ${rs.status}`, HttpStatus.CONFLICT, { status: rs.status });
      await tx.update(runsheets).set({ status: 'IN_PROGRESS', startedAt: new Date() }).where(eq(runsheets.id, id));
      const waiting = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.runsheetId, id), eq(orders.status, 'ASSIGNED'))).orderBy(asc(orders.id));
      for (const o of waiting) await this.workflow.apply(tx, fx, o.id, 'OUT_FOR_DELIVERY', actor, { runsheetId: id });
      await this.audit.record(auditPrincipal(actor), { action: 'runsheet.start', entity: 'Runsheet', entityId: id }, null, tx);
    });
    return this.detail(id, { forHero: true });
  }

  // ------------------------------------------------------------------ reads

  async list(q: RunsheetListQuery) {
    const where = whereAll(
      q.date ? eq(runsheets.date, q.date) : undefined,
      q.from ? gte(runsheets.date, q.from) : undefined,
      q.to ? lte(runsheets.date, q.to) : undefined,
      q.status?.length ? inArray(runsheets.status, q.status) : undefined,
      q.courierId ? eq(runsheets.courierId, q.courierId) : undefined,
      q.hubId ? eq(runsheets.hubId, q.hubId) : undefined,
    );
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({ rs: runsheets, courierCode: couriers.code, courierName: users.name, hubCode: hubs.code })
        .from(runsheets)
        .innerJoin(couriers, eq(couriers.id, runsheets.courierId))
        .innerJoin(users, eq(users.id, couriers.userId))
        .leftJoin(hubs, eq(hubs.id, runsheets.hubId))
        .where(where)
        .orderBy(q.order === 'asc' ? asc(runsheets.date) : desc(runsheets.date), desc(runsheets.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(runsheets).where(where),
    ]);
    const progress = await this.progress(rows.map((r) => r.rs.id));
    return paginate(
      rows.map(({ rs, courierCode, courierName, hubCode }) => {
        const { route: _route, ...rest } = rs;
        return { ...rest, stopsCount: rs.route?.length ?? null, courier: { id: rs.courierId, code: courierCode, name: courierName }, hub: rs.hubId ? { id: rs.hubId, code: hubCode } : null, progress: progress.get(rs.id) ?? emptyProgress() };
      }),
      Number(n),
      q,
    );
  }

  async progress(ids: string[]) {
    const out = new Map<string, ReturnType<typeof emptyProgress>>();
    if (!ids.length) return out;
    const rows = await this.db.select({ id: orders.runsheetId, status: orders.status, n: count() }).from(orders).where(inArray(orders.runsheetId, ids)).groupBy(orders.runsheetId, orders.status);
    for (const r of rows) {
      const p = out.get(r.id!) ?? emptyProgress();
      const n = Number(r.n);
      p.total += n;
      if (r.status === 'DELIVERED') p.delivered += n;
      else if (r.status === 'FAILED_ATTEMPT' || r.status === 'RESCHEDULED') p.failed += n;
      else if (r.status === 'RETURN_PENDING' || r.status === 'RETURN_OUT' || r.status === 'RETURNED') p.returns += n;
      else if (r.status === 'ASSIGNED' || r.status === 'OUT_FOR_DELIVERY') p.pending += n;
      else p.other += n;
      p.done = p.total - p.pending;
      p.percent = p.total ? Math.round((p.done / p.total) * 100) : 0;
      out.set(r.id!, p);
    }
    return out;
  }

  async detail(id: string, opts: { forHero?: boolean } = {}) {
    const [row] = await this.db
      .select({ rs: runsheets, courierCode: couriers.code, courierName: users.name, courierPhone: users.phone, vehicleType: couriers.vehicleType, vehiclePlate: couriers.vehiclePlate, cashOnHandCents: couriers.cashOnHandCents, cashLimitCents: couriers.cashLimitCents, lastLat: couriers.lastLat, lastLng: couriers.lastLng, lastSeenAt: couriers.lastSeenAt, hubCode: hubs.code, hubName: hubs.name, hubLat: hubs.lat, hubLng: hubs.lng })
      .from(runsheets)
      .innerJoin(couriers, eq(couriers.id, runsheets.courierId))
      .innerJoin(users, eq(users.id, couriers.userId))
      .leftJoin(hubs, eq(hubs.id, runsheets.hubId))
      .where(eq(runsheets.id, id))
      .limit(1);
    if (!row) throw notFound('Runsheet', id);
    const stops = await this.stops(id, row.rs);
    const progress = (await this.progress([id])).get(id) ?? emptyProgress();
    return {
      ...row.rs,
      courier: {
        id: row.rs.courierId, code: row.courierCode, name: row.courierName, vehicleType: row.vehicleType, vehiclePlate: row.vehiclePlate,
        ...(opts.forHero ? {} : { phone: row.courierPhone, cashOnHandCents: row.cashOnHandCents, cashLimitCents: row.cashLimitCents, lastLat: row.lastLat, lastLng: row.lastLng, lastSeenAt: row.lastSeenAt }),
      },
      hub: row.rs.hubId ? { id: row.rs.hubId, code: row.hubCode, name: row.hubName, lat: row.hubLat, lng: row.hubLng } : null,
      progress,
      codToCollectCents: stops.filter((s) => OPEN_STOP.includes(s.status)).reduce((sum, s) => sum + s.collectCents, 0),
      stops,
    };
  }

  /** Stops in route order (unsequenced stops last). */
  async stops(id: string, rs: Pick<RunsheetRow, 'route' | 'dispatchedAt'>) {
    const rows = await this.db
      .select({
        id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, type: orders.type, routeSequence: orders.routeSequence,
        recipientName: orders.recipientName, recipientPhone: orders.recipientPhone, addressLine: orders.addressLine, building: orders.building,
        floor: orders.floor, apartment: orders.apartment, landmark: orders.landmark, lat: orders.lat, lng: orders.lng, notes: orders.notes,
        collectCents: orders.collectCents, collectedCents: orders.collectedCents, paymentMethod: orders.paymentMethod, itemsCount: orders.itemsCount,
        attempts: orders.attempts, allowOpening: orders.allowOpening, deliveryOtpRequired: orders.deliveryOtpRequired, promisedBy: orders.promisedBy,
        deliveredAt: orders.deliveredAt, zone: { id: zones.id, code: zones.code, nameEn: zones.nameEn, nameAr: zones.nameAr, centerLat: zones.centerLat, centerLng: zones.centerLng },
        brand: { id: brands.id, code: brands.code, name: brands.name },
      })
      .from(orders)
      .innerJoin(zones, eq(zones.id, orders.zoneId))
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .where(eq(orders.runsheetId, id));
    const route = new Map((rs.route ?? []).map((r) => [r.orderId, r]));
    return rows
      .map((o) => {
        const leg = route.get(o.id);
        const lat = o.lat ?? o.zone.centerLat;
        const lng = o.lng ?? o.zone.centerLng;
        return {
          ...o,
          statusLabel: ORDER_STATUS_LABELS[o.status],
          isOpen: OPEN_STOP.includes(o.status),
          etaMinutes: leg?.etaMinutes ?? null,
          eta: leg && rs.dispatchedAt ? new Date(rs.dispatchedAt.getTime() + leg.etaMinutes * 60_000) : null,
          legKm: leg?.legKm ?? null,
          mapsUrl: mapsLink(lat, lng),
        };
      })
      .sort((a, b) => (a.routeSequence ?? 9999) - (b.routeSequence ?? 9999) || a.trackingNumber.localeCompare(b.trackingNumber));
  }

  /** Printable manifest (A4) data. */
  async manifest(id: string) {
    const d = await this.detail(id);
    return {
      code: d.code,
      date: d.date,
      status: d.status,
      generatedAt: new Date(),
      hero: { code: d.courier.code, name: d.courier.name, phone: d.courier.phone ? formatEgyptPhone(d.courier.phone) : null, vehicleType: d.courier.vehicleType, vehiclePlate: d.courier.vehiclePlate },
      hub: d.hub ? { code: d.hub.code, name: d.hub.name } : null,
      totals: {
        stops: d.stops.length,
        codCents: d.stops.reduce((s, o) => s + o.collectCents, 0),
        pieces: d.stops.reduce((s, o) => s + o.itemsCount, 0),
        distanceKm: d.totalDistanceKm,
        minutes: d.totalMinutes,
      },
      stops: d.stops.map((o, i) => ({
        seq: o.routeSequence ?? i + 1,
        trackingNumber: o.trackingNumber,
        brandCode: o.brand.code,
        recipientName: o.recipientName,
        phone: formatEgyptPhone(o.recipientPhone),
        address: [o.addressLine, o.building && `Bldg ${o.building}`, o.floor && `Floor ${o.floor}`, o.apartment && `Apt ${o.apartment}`].filter(Boolean).join(', '),
        landmark: o.landmark,
        zone: o.zone.code,
        collectCents: o.collectCents,
        paymentMethod: o.paymentMethod,
        pieces: o.itemsCount,
        notes: o.notes,
        allowOpening: o.allowOpening,
        otpRequired: o.deliveryOtpRequired,
        status: o.status,
      })),
    };
  }

  /** Runsheets of a hero for a day (agenda). */
  async forCourier(courierId: string, day: string) {
    const rows = await this.db
      .select()
      .from(runsheets)
      .where(and(eq(runsheets.courierId, courierId), eq(runsheets.date, day), ne(runsheets.status, 'CLOSED')))
      .orderBy(asc(runsheets.createdAt));
    return rows;
  }

  // ------------------------------------------------------------------ helpers

  private async activeCourier(courierId: string) {
    const [c] = await this.db.select().from(couriers).where(eq(couriers.id, courierId)).limit(1);
    if (!c) throw notFound('Hero', courierId);
    if (c.status !== 'ACTIVE') throw new DomainError('COURIER_INACTIVE', 'This hero is not active', HttpStatus.UNPROCESSABLE_ENTITY);
    return c;
  }

  async lock(tx: DbOrTx, id: string): Promise<RunsheetRow> {
    const [rs] = await tx.select().from(runsheets).where(eq(runsheets.id, id)).for('update').limit(1);
    if (!rs) throw notFound('Runsheet', id);
    return rs;
  }
}

const locked = (rs: RunsheetRow) => new DomainError('RUNSHEET_LOCKED', `Runsheet ${rs.code} is ${rs.status}`, HttpStatus.CONFLICT, { status: rs.status });

function emptyProgress() {
  return { total: 0, delivered: 0, failed: 0, returns: 0, pending: 0, other: 0, done: 0, percent: 0 };
}
