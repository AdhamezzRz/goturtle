import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { haversineKm, isTerminal, type CourierAvailability, type OrderStatus } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { courierZones, couriers, hubs, orders, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { DomainError, notFound } from '../../common/errors';
import type { ActorContext } from '../../common/actor';
import type { RequestMetaInfo } from '../../common/decorators';
import { cairoToday } from '../../db/helpers';
import { NetworkService, type ZoneInfo } from '../network/network.service';
import { round2 } from '../orders/ops-kit';
import { RunsheetsService } from './runsheets.service';
import { SettingsService } from '../settings/settings.service';
import type { AutoAssignDto } from './dispatch.dto';

/** Statuses in which a parcel counts against a hero's capacity. */
export const HERO_LOAD: OrderStatus[] = ['PICKUP_ASSIGNED', 'PICKED_UP', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_OUT'];
/** Statuses whose COD the hero will (likely) collect today. */
export const HERO_COD: OrderStatus[] = ['ASSIGNED', 'OUT_FOR_DELIVERY'];
/** A position older than this is ignored in favour of the home hub. */
const POSITION_FRESH_MS = 2 * 3_600_000;

export interface Candidate {
  id: string;
  code: string;
  name: string;
  vehicleType: string;
  availability: CourierAvailability;
  rating: number;
  maxActiveOrders: number;
  cashLimitCents: number;
  cashOnHandCents: number;
  activeOrders: number;
  assignedCodCents: number;
  zones: Map<string, boolean>; // zoneId → isPrimary
  position: { lat: number; lng: number; source: 'gps' | 'hub' } | null;
}

export interface Evaluation {
  courier: { id: string; code: string; name: string; availability: CourierAvailability; vehicleType: string };
  eligible: boolean;
  reasons: string[];
  score: number;
  breakdown: { zone: number; availability: number; distance: number; capacity: number; rating: number; cash: number };
  distanceKm: number | null;
  capacityLeft: number;
  cashHeadroomCents: number;
}

type PoolOrder = {
  id: string; trackingNumber: string; zoneId: string; collectCents: number; lat: number | null; lng: number | null; status: OrderStatus; priority: number; promisedBy: Date | null;
  confirmationStatus: string; riskScore: number; metadata: unknown;
};

const AVAILABILITY_POINTS: Record<CourierAvailability, number> = { ONLINE: 15, BUSY: 8, ON_BREAK: 4, OFFLINE: 0 };

/**
 * Hero auto-assignment. Eligibility: ACTIVE, covers the zone, has capacity
 * (maxActiveOrders − active parcels) and cash headroom (cash limit − cash on
 * hand − COD already assigned ≥ the order's collect amount). Score (0–100):
 * zone fit 30/18, availability 15, distance to the zone centre 20, spare
 * capacity 15, rating 10, cash headroom 10.
 */
@Injectable()
export class AssignmentService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly network: NetworkService,
    private readonly runsheets: RunsheetsService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Delivery integrity: unconfirmed high-risk or declined parcels must not be
   * planned (the workflow guard would refuse them with CONFIRMATION_REQUIRED).
   */
  private async integrityBlocked(o: { confirmationStatus: string; riskScore: number; metadata: unknown }): Promise<boolean> {
    if ((o.metadata as { integrity?: { override?: unknown } } | null)?.integrity?.override) return false;
    if (o.confirmationStatus === 'DECLINED') return true;
    const s = await this.settings.get('integrity');
    return s.confirmationEnabled && (o.confirmationStatus === 'PENDING' || o.confirmationStatus === 'NO_RESPONSE') && o.riskScore >= s.holdUnconfirmedAboveRisk;
  }

  async candidates(): Promise<Candidate[]> {
    const rows = await this.db
      .select({ c: couriers, name: users.name, hubLat: hubs.lat, hubLng: hubs.lng })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .leftJoin(hubs, eq(hubs.id, couriers.homeHubId))
      .where(and(eq(couriers.status, 'ACTIVE'), eq(users.status, 'ACTIVE')));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.c.id);
    const [zoneRows, loadRows] = await Promise.all([
      this.db.select().from(courierZones).where(inArray(courierZones.courierId, ids)),
      this.db
        .select({
          courierId: orders.courierId,
          n: sql<number>`count(*)`.mapWith(Number),
          cod: sql<number>`coalesce(sum(case when ${orders.status} in ('ASSIGNED','OUT_FOR_DELIVERY') then ${orders.collectCents} else 0 end), 0)`.mapWith(Number),
        })
        .from(orders)
        .where(and(inArray(orders.courierId, ids), inArray(orders.status, HERO_LOAD)))
        .groupBy(orders.courierId),
    ]);
    const load = new Map(loadRows.map((l) => [l.courierId!, l]));
    const now = Date.now();
    return rows.map(({ c, name, hubLat, hubLng }) => {
      const fresh = c.lastLat != null && c.lastLng != null && c.lastSeenAt && now - c.lastSeenAt.getTime() < POSITION_FRESH_MS;
      return {
        id: c.id,
        code: c.code,
        name,
        vehicleType: c.vehicleType,
        availability: c.availability,
        rating: c.rating,
        maxActiveOrders: c.maxActiveOrders,
        cashLimitCents: c.cashLimitCents,
        cashOnHandCents: c.cashOnHandCents,
        activeOrders: load.get(c.id)?.n ?? 0,
        assignedCodCents: load.get(c.id)?.cod ?? 0,
        zones: new Map(zoneRows.filter((z) => z.courierId === c.id).map((z) => [z.zoneId, z.isPrimary])),
        position: fresh ? { lat: c.lastLat!, lng: c.lastLng!, source: 'gps' as const } : hubLat != null && hubLng != null ? { lat: hubLat, lng: hubLng, source: 'hub' as const } : null,
      };
    });
  }

  evaluate(order: Pick<PoolOrder, 'zoneId' | 'collectCents'>, zone: ZoneInfo, c: Candidate): Evaluation {
    const reasons: string[] = [];
    const zoneFit = c.zones.get(order.zoneId);
    if (zoneFit === undefined) reasons.push('NOT_IN_ZONE');
    const capacityLeft = c.maxActiveOrders - c.activeOrders;
    if (capacityLeft <= 0) reasons.push('AT_CAPACITY');
    const cashHeadroomCents = c.cashLimitCents - c.cashOnHandCents - c.assignedCodCents;
    if (cashHeadroomCents < order.collectCents) reasons.push('CASH_LIMIT');
    const distanceKm = c.position ? haversineKm(c.position, { lat: zone.centerLat, lng: zone.centerLng }) : null;
    const breakdown = {
      zone: zoneFit === undefined ? 0 : zoneFit ? 30 : 18,
      availability: AVAILABILITY_POINTS[c.availability] ?? 0,
      distance: distanceKm === null ? 10 : round2(20 * Math.max(0, 1 - distanceKm / 20)),
      capacity: c.maxActiveOrders > 0 ? round2(15 * Math.max(0, capacityLeft) / c.maxActiveOrders) : 0,
      rating: round2(10 * Math.min(1, Math.max(0, (c.rating - 3) / 2))),
      cash: c.cashLimitCents > 0 ? round2(10 * Math.min(1, Math.max(0, cashHeadroomCents - order.collectCents) / c.cashLimitCents)) : 0,
    };
    const score = round2(Object.values(breakdown).reduce((s, v) => s + v, 0));
    return {
      courier: { id: c.id, code: c.code, name: c.name, availability: c.availability, vehicleType: c.vehicleType },
      eligible: reasons.length === 0,
      reasons,
      score,
      breakdown,
      distanceKm: distanceKm === null ? null : round2(distanceKm),
      capacityLeft,
      cashHeadroomCents,
    };
  }

  /** Top 5 eligible heroes for one order, plus why the zone's other heroes were not eligible. */
  async suggest(orderId: string) {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw notFound('Order', orderId);
    if (isTerminal(order.status)) throw new DomainError('ORDER_FINAL', `Order is ${order.status}`, HttpStatus.CONFLICT);
    const zone = await this.network.zoneById(order.zoneId);
    const blocked = await this.integrityBlocked(order);
    const evals = (await this.candidates()).map((c) => this.evaluate(order, zone!, c));
    const eligible = evals.filter((e) => e.eligible).sort((a, b) => b.score - a.score);
    return {
      order: { id: order.id, trackingNumber: order.trackingNumber, status: order.status, collectCents: order.collectCents, zone: this.network.zoneSummary(zone!) },
      blockedBy: blocked ? 'CONFIRMATION_REQUIRED' : null,
      candidates: blocked ? [] : eligible.slice(0, 5),
      ineligible: evals.filter((e) => !e.eligible && !e.reasons.includes('NOT_IN_ZONE')).sort((a, b) => b.score - a.score).slice(0, 10),
    };
  }

  /** Best eligible hero (used by the hub scan for the sort screen). */
  async bestFor(order: Pick<PoolOrder, 'zoneId' | 'collectCents'>, zone: ZoneInfo) {
    const evals = (await this.candidates()).map((c) => this.evaluate(order, zone, c)).filter((e) => e.eligible);
    evals.sort((a, b) => b.score - a.score);
    return evals[0] ?? null;
  }

  /** Greedy assignment of the hub's waiting orders (most urgent first). */
  async autoAssign(dto: AutoAssignDto, actor: ActorContext, meta: RequestMetaInfo) {
    const date = dto.date ?? cairoToday();
    if (date < cairoToday()) throw new DomainError('INVALID_DATE', 'Cannot plan a past day', HttpStatus.UNPROCESSABLE_ENTITY);
    const skipped: Array<{ orderId: string; trackingNumber?: string; reasons: string[] }> = [];
    let pool: PoolOrder[];
    const cols = {
      id: orders.id, trackingNumber: orders.trackingNumber, zoneId: orders.zoneId, collectCents: orders.collectCents, lat: orders.lat, lng: orders.lng, status: orders.status, priority: orders.priority, promisedBy: orders.promisedBy,
      confirmationStatus: orders.confirmationStatus, riskScore: orders.riskScore, metadata: orders.metadata,
    };
    if (dto.orderIds?.length) {
      const rows = await this.db.select(cols).from(orders).where(inArray(orders.id, [...new Set(dto.orderIds)]));
      for (const id of new Set(dto.orderIds)) if (!rows.find((r) => r.id === id)) skipped.push({ orderId: id, reasons: ['NOT_FOUND'] });
      pool = rows.filter((r) => {
        if (r.status === 'RECEIVED_AT_HUB') return true;
        skipped.push({ orderId: r.id, trackingNumber: r.trackingNumber, reasons: ['NOT_AT_HUB'] });
        return false;
      });
    } else {
      pool = await this.db
        .select(cols)
        .from(orders)
        .where(and(eq(orders.status, 'RECEIVED_AT_HUB'), dto.hubId ? eq(orders.hubId, dto.hubId) : undefined, or(isNull(orders.scheduledDate), lte(orders.scheduledDate, date))))
        .orderBy(desc(orders.priority), asc(orders.promisedBy), asc(orders.createdAt))
        .limit(500);
    }
    pool.sort((a, b) => b.priority - a.priority || (a.promisedBy?.getTime() ?? Infinity) - (b.promisedBy?.getTime() ?? Infinity));
    const plannable: typeof pool = [];
    for (const o of pool) {
      if (await this.integrityBlocked(o)) skipped.push({ orderId: o.id, trackingNumber: o.trackingNumber, reasons: ['CONFIRMATION_REQUIRED'] });
      else plannable.push(o);
    }
    pool = plannable;

    const heroes = await this.candidates();
    const assignments: Array<{ orderId: string; trackingNumber: string; zoneCode: string; courier: Evaluation['courier']; score: number; collectCents: number }> = [];
    const unassigned: Array<{ orderId: string; trackingNumber: string; zoneCode: string; reasons: string[] }> = [];
    for (const o of pool) {
      const zone = await this.network.zoneById(o.zoneId);
      const evals = heroes.map((h) => ({ h, e: this.evaluate(o, zone!, h) }));
      const best = evals.filter((x) => x.e.eligible).sort((a, b) => b.e.score - a.e.score)[0];
      if (!best) {
        const coverers = evals.filter((x) => !x.e.reasons.includes('NOT_IN_ZONE'));
        unassigned.push({ orderId: o.id, trackingNumber: o.trackingNumber, zoneCode: zone!.code, reasons: coverers.length ? [...new Set(coverers.flatMap((x) => x.e.reasons))] : ['NO_HERO_FOR_ZONE'] });
        continue;
      }
      best.h.activeOrders += 1;
      best.h.assignedCodCents += o.collectCents;
      assignments.push({ orderId: o.id, trackingNumber: o.trackingNumber, zoneCode: zone!.code, courier: best.e.courier, score: best.e.score, collectCents: o.collectCents });
    }

    const byCourier = [...groupAssignments(assignments).values()].map((list) => ({
      courier: list[0].courier,
      orders: list.length,
      codCents: list.reduce((s, a) => s + a.collectCents, 0),
    }));
    let runsheets: Array<{ id: string; code: string; courierId: string; added: number }> = [];
    if (dto.commit && assignments.length) {
      runsheets = [];
      for (const [courierId, list] of groupAssignments(assignments)) {
        const rs = await this.runsheets.assignToDraft(courierId, date, list.map((a) => a.orderId), actor, meta);
        runsheets.push({ id: rs.id, code: rs.code, courierId, added: list.length });
      }
    }
    return { date, commit: !!dto.commit, assignments, unassigned, skipped, byCourier, runsheets };
  }
}

function groupAssignments<T extends { courier: { id: string } }>(list: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const a of list) out.set(a.courier.id, [...(out.get(a.courier.id) ?? []), a]);
  return out;
}
