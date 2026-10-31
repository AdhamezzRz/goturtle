import { HttpStatus, Injectable } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
import { detectZone, type LatLng, type ZoneMatch } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { cities, governorates, hubs, zones, type GeoPolygon } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { DomainError, notFound } from '../../common/errors';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { paginate, offsetOf } from '../../common/pagination';
import { newId } from '../../db/columns';
import type {
  CityDto, DetectZoneDto, GovernorateDto, HubDto, UpdateCityDto, UpdateGovernorateDto, UpdateHubDto, UpdateZoneDto, ZoneDto, ZoneListQuery,
} from './network.dto';

export type ZoneRow = typeof zones.$inferSelect;
export type HubRow = typeof hubs.$inferSelect;

/** A zone with its city and hub, as cached for detection and lookups. */
export interface ZoneInfo extends ZoneRow {
  cityCode: string;
  cityNameEn: string;
  cityNameAr: string;
  hubCode: string | null;
  hubName: string | null;
}

export interface DetectionResult {
  match: ZoneMatch | null;
  zone: ReturnType<NetworkService['zoneSummary']> | null;
  hint?: string;
}

const CACHE_TTL_MS = 60_000;

/** Hint shown when an address cannot be mapped to a zone. */
export const ZONE_HINT =
  'Add the district / area name to the address (e.g. "Nasr City", "مدينة نصر", "Maadi"), drop a map pin, or choose the zone manually.';

/**
 * Geography & network: governorates, cities, hubs and delivery zones.
 * Zones are cached in memory for address detection (every order create hits
 * it); every write invalidates the cache and a short TTL covers other app
 * instances.
 */
@Injectable()
export class NetworkService {
  private cache: { at: number; zones: ZoneInfo[]; byId: Map<string, ZoneInfo> } | null = null;
  private loading: Promise<ZoneInfo[]> | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- zone cache

  invalidate() {
    this.cache = null;
  }

  /** All zones (active and inactive) with city & hub labels. */
  async allZones(): Promise<ZoneInfo[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.zones;
    if (!this.loading) {
      this.loading = this.loadZones().finally(() => (this.loading = null));
    }
    return this.loading;
  }

  private async loadZones(): Promise<ZoneInfo[]> {
    const rows = await this.db
      .select({ zone: zones, cityCode: cities.code, cityNameEn: cities.nameEn, cityNameAr: cities.nameAr, hubCode: hubs.code, hubName: hubs.name })
      .from(zones)
      .innerJoin(cities, eq(cities.id, zones.cityId))
      .leftJoin(hubs, eq(hubs.id, zones.hubId))
      .orderBy(asc(zones.code));
    const list: ZoneInfo[] = rows.map((r) => ({
      ...r.zone,
      keywords: r.zone.keywords ?? [],
      cityCode: r.cityCode,
      cityNameEn: r.cityNameEn,
      cityNameAr: r.cityNameAr,
      hubCode: r.hubCode ?? null,
      hubName: r.hubName ?? null,
    }));
    this.cache = { at: Date.now(), zones: list, byId: new Map(list.map((z) => [z.id, z])) };
    return list;
  }

  async activeZones(): Promise<ZoneInfo[]> {
    return (await this.allZones()).filter((z) => z.isActive);
  }

  async zoneById(id: string): Promise<ZoneInfo | null> {
    await this.allZones();
    const hit = this.cache?.byId.get(id);
    if (hit) return hit;
    // Created by another instance a moment ago: reload once.
    this.invalidate();
    await this.allZones();
    return this.cache?.byId.get(id) ?? null;
  }

  async zoneByCode(code: string): Promise<ZoneInfo | null> {
    const upper = code.trim().toUpperCase();
    return (await this.allZones()).find((z) => z.code === upper) ?? null;
  }

  zoneSummary(z: ZoneInfo) {
    return {
      id: z.id,
      code: z.code,
      nameEn: z.nameEn,
      nameAr: z.nameAr,
      tier: z.tier,
      slaHours: z.slaHours,
      isActive: z.isActive,
      centerLat: z.centerLat,
      centerLng: z.centerLng,
      city: { id: z.cityId, code: z.cityCode, nameEn: z.cityNameEn, nameAr: z.cityNameAr },
      hub: z.hubId ? { id: z.hubId, code: z.hubCode, name: z.hubName } : null,
    };
  }

  /** Address (+ optional pin) → zone, using only active zones. */
  async detect(address: string, point?: LatLng | null): Promise<DetectionResult> {
    const active = await this.activeZones();
    const match = detectZone(active, address, point ?? null);
    if (!match) return { match: null, zone: null, hint: ZONE_HINT };
    const zone = active.find((z) => z.id === match.zoneId)!;
    return { match, zone: this.zoneSummary(zone) };
  }

  detectForDto(dto: DetectZoneDto) {
    const point = dto.lat != null && dto.lng != null ? { lat: dto.lat, lng: dto.lng } : null;
    return this.detect(dto.address, point);
  }

  /** Minimal public list for order forms. */
  async serviceableZones() {
    return (await this.activeZones()).map((z) => ({
      id: z.id,
      code: z.code,
      nameEn: z.nameEn,
      nameAr: z.nameAr,
      tier: z.tier,
      slaHours: z.slaHours,
      city: { code: z.cityCode, nameEn: z.cityNameEn, nameAr: z.cityNameAr },
    }));
  }

  // ------------------------------------------------------------- governorates

  async listGovernorates() {
    const rows = await this.db.select().from(governorates).orderBy(asc(governorates.code));
    const counts = await this.db.select({ id: cities.governorateId, n: count() }).from(cities).groupBy(cities.governorateId);
    const byGov = new Map(counts.map((c) => [c.id, Number(c.n)]));
    return rows.map((g) => ({ ...g, citiesCount: byGov.get(g.id) ?? 0 }));
  }

  async createGovernorate(dto: GovernorateDto, p: Principal, meta: RequestMetaInfo) {
    const id = newId();
    await this.db.insert(governorates).values({ id, ...dto });
    await this.audit.record(p, { action: 'governorate.create', entity: 'Governorate', entityId: id, after: dto }, meta);
    return this.getOne(governorates, governorates.id, id, 'Governorate');
  }

  async updateGovernorate(id: string, dto: UpdateGovernorateDto, p: Principal, meta: RequestMetaInfo) {
    const before = await this.getOne(governorates, governorates.id, id, 'Governorate');
    if (Object.keys(dto).length) await this.db.update(governorates).set(dto).where(eq(governorates.id, id));
    this.invalidate();
    await this.audit.record(p, { action: 'governorate.update', entity: 'Governorate', entityId: id, before, after: dto }, meta);
    return this.getOne(governorates, governorates.id, id, 'Governorate');
  }

  async deleteGovernorate(id: string, p: Principal, meta: RequestMetaInfo) {
    const before = await this.getOne(governorates, governorates.id, id, 'Governorate');
    await this.db.delete(governorates).where(eq(governorates.id, id));
    await this.audit.record(p, { action: 'governorate.delete', entity: 'Governorate', entityId: id, before }, meta);
    return { ok: true };
  }

  // ------------------------------------------------------------- cities

  async listCities(governorateId?: string) {
    const rows = await this.db
      .select({ city: cities, governorate: { id: governorates.id, code: governorates.code, nameEn: governorates.nameEn, nameAr: governorates.nameAr } })
      .from(cities)
      .innerJoin(governorates, eq(governorates.id, cities.governorateId))
      .where(governorateId ? eq(cities.governorateId, governorateId) : undefined)
      .orderBy(asc(cities.code));
    const zoneCounts = await this.db.select({ id: zones.cityId, n: count() }).from(zones).groupBy(zones.cityId);
    const byCity = new Map(zoneCounts.map((c) => [c.id, Number(c.n)]));
    return rows.map((r) => ({ ...r.city, governorate: r.governorate, zonesCount: byCity.get(r.city.id) ?? 0 }));
  }

  async createCity(dto: CityDto, p: Principal, meta: RequestMetaInfo) {
    await this.getOne(governorates, governorates.id, dto.governorateId, 'Governorate');
    const id = newId();
    await this.db.insert(cities).values({ id, ...dto });
    await this.audit.record(p, { action: 'city.create', entity: 'City', entityId: id, after: dto }, meta);
    return this.getOne(cities, cities.id, id, 'City');
  }

  async updateCity(id: string, dto: UpdateCityDto, p: Principal, meta: RequestMetaInfo) {
    const before = await this.getOne(cities, cities.id, id, 'City');
    if (dto.governorateId) await this.getOne(governorates, governorates.id, dto.governorateId, 'Governorate');
    if (Object.keys(dto).length) await this.db.update(cities).set(dto).where(eq(cities.id, id));
    this.invalidate();
    await this.audit.record(p, { action: 'city.update', entity: 'City', entityId: id, before, after: dto }, meta);
    return this.getOne(cities, cities.id, id, 'City');
  }

  async deleteCity(id: string, p: Principal, meta: RequestMetaInfo) {
    const before = await this.getOne(cities, cities.id, id, 'City');
    await this.db.delete(cities).where(eq(cities.id, id));
    await this.audit.record(p, { action: 'city.delete', entity: 'City', entityId: id, before }, meta);
    return { ok: true };
  }

  // ------------------------------------------------------------- hubs

  async listHubs(isActive?: boolean) {
    const rows = await this.db
      .select()
      .from(hubs)
      .where(isActive === undefined ? undefined : eq(hubs.isActive, isActive))
      .orderBy(asc(hubs.code));
    const zoneCounts = await this.db.select({ id: zones.hubId, n: count() }).from(zones).groupBy(zones.hubId);
    const byHub = new Map(zoneCounts.map((c) => [c.id, Number(c.n)]));
    return rows.map((h) => ({ ...h, zonesCount: byHub.get(h.id) ?? 0 }));
  }

  async hub(id: string): Promise<HubRow> {
    return this.getOne(hubs, hubs.id, id, 'Hub');
  }

  async hubDetail(id: string) {
    const hub = await this.hub(id);
    const hubZones = (await this.allZones()).filter((z) => z.hubId === id).map((z) => this.zoneSummary(z));
    return { ...hub, zones: hubZones };
  }

  async createHub(dto: HubDto, p: Principal, meta: RequestMetaInfo) {
    const id = newId();
    await this.db.insert(hubs).values({ id, ...dto });
    await this.audit.record(p, { action: 'hub.create', entity: 'Hub', entityId: id, after: dto }, meta);
    this.invalidate();
    return this.hub(id);
  }

  async updateHub(id: string, dto: UpdateHubDto, p: Principal, meta: RequestMetaInfo) {
    const before = await this.hub(id);
    if (Object.keys(dto).length) await this.db.update(hubs).set(dto).where(eq(hubs.id, id));
    this.invalidate();
    await this.audit.record(p, { action: 'hub.update', entity: 'Hub', entityId: id, before, after: dto }, meta);
    return this.hub(id);
  }

  async deleteHub(id: string, p: Principal, meta: RequestMetaInfo) {
    const before = await this.hub(id);
    await this.db.delete(hubs).where(eq(hubs.id, id));
    this.invalidate();
    await this.audit.record(p, { action: 'hub.delete', entity: 'Hub', entityId: id, before }, meta);
    return { ok: true };
  }

  // ------------------------------------------------------------- zones

  async listZones(q: ZoneListQuery) {
    let list = await this.allZones();
    if (q.cityId) list = list.filter((z) => z.cityId === q.cityId);
    if (q.hubId) list = list.filter((z) => z.hubId === q.hubId);
    if (q.tier) list = list.filter((z) => z.tier === q.tier);
    if (q.isActive !== undefined) list = list.filter((z) => z.isActive === q.isActive);
    if (q.q) {
      const needle = q.q.trim().toLowerCase();
      list = list.filter(
        (z) => z.code.toLowerCase().includes(needle) || z.nameEn.toLowerCase().includes(needle) || z.nameAr.includes(q.q!.trim()) || z.keywords.some((k) => k.toLowerCase().includes(needle)),
      );
    }
    if (q.order === 'desc') list = [...list].reverse();
    const total = list.length;
    const page = list.slice(offsetOf(q), offsetOf(q) + q.pageSize).map((z) => ({ ...this.zoneSummary(z), keywords: z.keywords, polygon: z.polygon ?? null, createdAt: z.createdAt, updatedAt: z.updatedAt }));
    return paginate(page, total, q);
  }

  async zoneDetail(id: string) {
    const z = await this.zoneById(id);
    if (!z) throw notFound('Zone', id);
    return { ...this.zoneSummary(z), keywords: z.keywords, polygon: z.polygon ?? null, createdAt: z.createdAt, updatedAt: z.updatedAt };
  }

  async createZone(dto: ZoneDto, p: Principal, meta: RequestMetaInfo) {
    await this.getOne(cities, cities.id, dto.cityId, 'City');
    if (dto.hubId) await this.hub(dto.hubId);
    const polygon = dto.polygon ? validatePolygon(dto.polygon) : null;
    const id = newId();
    await this.db.insert(zones).values({
      id,
      code: dto.code,
      nameEn: dto.nameEn,
      nameAr: dto.nameAr,
      cityId: dto.cityId,
      hubId: dto.hubId ?? null,
      tier: dto.tier ?? 'A',
      keywords: cleanKeywords(dto.keywords ?? []),
      polygon,
      centerLat: dto.centerLat,
      centerLng: dto.centerLng,
      isActive: dto.isActive ?? true,
      slaHours: dto.slaHours ?? 24,
    });
    this.invalidate();
    await this.audit.record(p, { action: 'zone.create', entity: 'Zone', entityId: id, after: dto }, meta);
    return this.zoneDetail(id);
  }

  async updateZone(id: string, dto: UpdateZoneDto, p: Principal, meta: RequestMetaInfo) {
    const before = await this.getOne(zones, zones.id, id, 'Zone');
    if (dto.cityId) await this.getOne(cities, cities.id, dto.cityId, 'City');
    if (dto.hubId) await this.hub(dto.hubId);
    const patch: Partial<typeof zones.$inferInsert> = { ...dto } as Partial<typeof zones.$inferInsert>;
    if (dto.keywords) patch.keywords = cleanKeywords(dto.keywords);
    if (dto.polygon !== undefined) patch.polygon = dto.polygon ? validatePolygon(dto.polygon) : null;
    if (Object.keys(patch).length) await this.db.update(zones).set(patch).where(eq(zones.id, id));
    this.invalidate();
    await this.audit.record(p, { action: 'zone.update', entity: 'Zone', entityId: id, before, after: dto }, meta);
    return this.zoneDetail(id);
  }

  /** Deletes an unused zone (zones referenced by orders/locations must be deactivated instead → 409 IN_USE). */
  async deleteZone(id: string, p: Principal, meta: RequestMetaInfo) {
    const before = await this.getOne(zones, zones.id, id, 'Zone');
    await this.db.delete(zones).where(eq(zones.id, id));
    this.invalidate();
    await this.audit.record(p, { action: 'zone.delete', entity: 'Zone', entityId: id, before }, meta);
    return { ok: true };
  }

  // ------------------------------------------------------------- helpers

  private async getOne<T extends typeof governorates | typeof cities | typeof hubs | typeof zones>(
    table: T,
    idCol: T['id'],
    id: string,
    entity: string,
    db: DbOrTx = this.db,
  ): Promise<T['$inferSelect']> {
    const [row] = await db.select().from(table as typeof hubs).where(eq(idCol, id)).limit(1);
    if (!row) throw notFound(entity, id);
    return row as T['$inferSelect'];
  }
}

function cleanKeywords(list: string[]): string[] {
  return [...new Set(list.map((k) => k.trim()).filter((k) => k.length >= 2))];
}

/** Validates a GeoJSON polygon of [lng, lat] rings and closes open rings. */
export function validatePolygon(poly: { type: string; coordinates: unknown }): GeoPolygon {
  const bad = (msg: string) => new DomainError('INVALID_POLYGON', msg, HttpStatus.BAD_REQUEST);
  if (poly.type !== 'Polygon') throw bad('polygon.type must be "Polygon"');
  if (!Array.isArray(poly.coordinates) || poly.coordinates.length === 0) throw bad('polygon.coordinates must contain at least one ring');
  const rings = poly.coordinates.map((ring, idx) => {
    if (!Array.isArray(ring) || ring.length < 3) throw bad(`ring ${idx} needs at least 3 points`);
    const pts = ring.map((pt) => {
      if (!Array.isArray(pt) || pt.length < 2) throw bad(`ring ${idx} has an invalid point`);
      const [lng, lat] = pt.map(Number);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        throw bad(`ring ${idx} has an out-of-range point [${String(pt)}] (expected [lng, lat])`);
      }
      return [lng, lat] as [number, number];
    });
    const [f, l] = [pts[0], pts[pts.length - 1]];
    if (f[0] !== l[0] || f[1] !== l[1]) pts.push([f[0], f[1]]);
    if (pts.length < 4) throw bad(`ring ${idx} needs at least 3 distinct points`);
    return pts;
  });
  return { type: 'Polygon', coordinates: rings };
}

