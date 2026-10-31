import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, desc, eq, gte, isNotNull, lt, or, isNull } from 'drizzle-orm';
import { haversineKm, type CourierAvailability } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { courierLocations, couriers, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { DomainEvents, type CourierLocationEvent } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import { cairoToday } from '../../db/helpers';
import { assertDay, cairoDayRange, MINUTE_MS } from './workforce.util';
import { CouriersService } from './couriers.service';

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  battery?: number | null;
  recordedAt?: string | Date | null;
}

/** History throttling: keep a breadcrumb only every 30 s or 50 m. */
export const LOCATION_MIN_INTERVAL_MS = 30_000;
export const LOCATION_MIN_DISTANCE_KM = 0.05;
export const LOCATION_MAX_ACCURACY_M = 200;
/** A hero whose last ping is older than this is shown as stale on the live map. */
export const LIVE_STALE_MS = 10 * MINUTE_MS;

@Injectable()
export class CourierLocationsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventEmitter2,
    private readonly couriersService: CouriersService,
  ) {}

  /**
   * Ingests a batch of GPS points from the hero app. Inaccurate points
   * (> 200 m) and replays older than the last stored breadcrumb are ignored;
   * the courier's last position is always refreshed from the newest accepted
   * point, history is stored only every ≥ 30 s or ≥ 50 m.
   */
  async ingest(courierId: string, points: LocationPoint[], now = new Date()) {
    if (!points.length || points.length > 20) throw new DomainError('INVALID_BATCH', 'Send between 1 and 20 points', HttpStatus.BAD_REQUEST);
    const maxFuture = now.getTime() + 2 * MINUTE_MS;
    const normalised = points
      .map((p) => {
        const at = p.recordedAt ? new Date(p.recordedAt) : now;
        return { ...p, at: Number.isNaN(at.getTime()) || at.getTime() > maxFuture ? now : at };
      })
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const accurate = normalised.filter((p) => p.accuracy === null || p.accuracy === undefined || p.accuracy <= LOCATION_MAX_ACCURACY_M);

    const [last] = await this.db
      .select({ lat: courierLocations.lat, lng: courierLocations.lng, recordedAt: courierLocations.recordedAt })
      .from(courierLocations)
      .where(eq(courierLocations.courierId, courierId))
      .orderBy(desc(courierLocations.recordedAt))
      .limit(1);

    let anchor = last ?? null;
    const toStore: Array<typeof courierLocations.$inferInsert> = [];
    let stale = 0;
    for (const p of accurate) {
      if (anchor && p.at.getTime() <= anchor.recordedAt.getTime()) {
        stale++;
        continue;
      }
      const farEnough = !anchor || haversineKm(anchor, p) >= LOCATION_MIN_DISTANCE_KM;
      const longEnough = !anchor || p.at.getTime() - anchor.recordedAt.getTime() >= LOCATION_MIN_INTERVAL_MS;
      if (farEnough || longEnough) {
        toStore.push({
          courierId, lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null, speed: p.speed ?? null, heading: p.heading ?? null,
          battery: p.battery ?? null, recordedAt: p.at,
        });
        anchor = { lat: p.lat, lng: p.lng, recordedAt: p.at };
      }
    }
    if (toStore.length) await this.db.insert(courierLocations).values(toStore);

    const newest = accurate.at(-1);
    const [current] = await this.db.select({ lastSeenAt: couriers.lastSeenAt }).from(couriers).where(eq(couriers.id, courierId)).limit(1);
    if (newest && (!current?.lastSeenAt || newest.at.getTime() >= current.lastSeenAt.getTime())) {
      await this.db.update(couriers).set({ lastLat: newest.lat, lastLng: newest.lng, lastSeenAt: newest.at }).where(eq(couriers.id, courierId));
      this.events.emit(DomainEvents.CourierLocation, { courierId, lat: newest.lat, lng: newest.lng, at: newest.at } satisfies CourierLocationEvent);
    } else if (!newest) {
      // Nothing usable, but the app is alive: heartbeat only.
      await this.db.update(couriers).set({ lastSeenAt: now }).where(and(eq(couriers.id, courierId), or(isNull(couriers.lastSeenAt), lt(couriers.lastSeenAt, now))));
    }
    return {
      received: points.length,
      accepted: accurate.length - stale,
      stored: toStore.length,
      ignoredInaccurate: normalised.length - accurate.length,
      ignoredStale: stale,
      lastPosition: newest ? { lat: newest.lat, lng: newest.lng, at: newest.at } : null,
    };
  }

  /** Cheap polling endpoint for the ops live map. */
  async live(q: { hubId?: string; availability?: CourierAvailability; since?: string }) {
    const serverTime = new Date();
    const since = q.since ? new Date(q.since) : null;
    const rows = await this.db
      .select({
        id: couriers.id, code: couriers.code, name: users.name, phone: users.phone, lat: couriers.lastLat, lng: couriers.lastLng,
        lastSeenAt: couriers.lastSeenAt, availability: couriers.availability, vehicleType: couriers.vehicleType,
        cashOnHandCents: couriers.cashOnHandCents, cashLimitCents: couriers.cashLimitCents, homeHubId: couriers.homeHubId,
        employmentType: couriers.employmentType,
      })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(
        and(
          eq(couriers.status, 'ACTIVE'),
          isNotNull(couriers.lastLat),
          isNotNull(couriers.lastSeenAt),
          q.hubId ? eq(couriers.homeHubId, q.hubId) : undefined,
          q.availability ? eq(couriers.availability, q.availability) : undefined,
          since && !Number.isNaN(since.getTime()) ? gte(couriers.lastSeenAt, since) : undefined,
        ),
      )
      .orderBy(asc(couriers.code));
    const active = await this.couriersService.activeOrderCounts(rows.map((r) => r.id));
    return {
      serverTime,
      data: rows.map((r) => ({
        ...r,
        activeOrders: active.get(r.id) ?? 0,
        stale: !r.lastSeenAt || serverTime.getTime() - r.lastSeenAt.getTime() > LIVE_STALE_MS,
      })),
    };
  }

  /** Breadcrumbs of one Cairo day, oldest first, with the distance travelled. */
  async track(courierId: string, date?: string) {
    const day = date ? assertDay(date) : cairoToday();
    const [c] = await this.db.select({ id: couriers.id, code: couriers.code }).from(couriers).where(eq(couriers.id, courierId)).limit(1);
    if (!c) throw notFound('Hero', courierId);
    const { start, end } = cairoDayRange(day);
    const points = await this.db
      .select({
        lat: courierLocations.lat, lng: courierLocations.lng, accuracy: courierLocations.accuracy, speed: courierLocations.speed,
        heading: courierLocations.heading, battery: courierLocations.battery, recordedAt: courierLocations.recordedAt,
      })
      .from(courierLocations)
      .where(and(eq(courierLocations.courierId, courierId), gte(courierLocations.recordedAt, start), lt(courierLocations.recordedAt, end)))
      .orderBy(asc(courierLocations.recordedAt))
      .limit(5000);
    let km = 0;
    for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
    return {
      courierId,
      code: c.code,
      date: day,
      points,
      summary: {
        count: points.length,
        distanceKm: Math.round(km * 100) / 100,
        firstAt: points[0]?.recordedAt ?? null,
        lastAt: points.at(-1)?.recordedAt ?? null,
      },
    };
  }
}
