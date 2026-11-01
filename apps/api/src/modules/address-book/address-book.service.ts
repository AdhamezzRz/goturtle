import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import {
  DomainEvents, haversineKm, normalizeEgyptPhone, normalizeText, type AddressSource, type LatLng, type OrderStatus,
} from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { customerAddresses, customers, notifications, orders, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { JobsService } from '../../core/jobs.service';
import type { OrderCreatedEvent } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import { SYSTEM_ACTOR, type ActorContext } from '../../common/actor';
import { cairoToday, loadByIds } from '../../db/helpers';
import { newId } from '../../db/columns';
import { OrderWorkflowService, type TransitionContext } from '../orders/order-workflow.service';
import type { OrderRow } from '../orders/order-factory.service';
import { addDays, auditPrincipal } from '../orders/ops-kit';
import { NetworkService } from '../network/network.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { signLink, trackingLink } from '../delivery-integrity/integrity.util';
import { geocoderFromEnv, type Geocoder } from './geocoder';

type AddressRow = typeof customerAddresses.$inferSelect;

/** Emitted by the tracking module after a customer moved their map pin. */
export const CUSTOMER_PIN_EVENT = 'order.customer_pin';
export interface CustomerPinEvent {
  orderId: string;
  lat: number;
  lng: number;
}

/** Same address: normalised token overlap at least this high (and same zone). */
const SAME_ADDRESS = 0.85;
/** Close enough to reuse a verified pin on a new order without one. */
const REUSE_PIN = 0.6;
/** Pins further than this from the zone centre are rejected (hero GPS / customer pins). */
const PIN_MAX_KM = 15;
/** Below this zone-detection confidence an order without a pin is geocoded. */
const LOW_CONFIDENCE = 0.75;
export const PIN_LINK_TTL_MS = 3 * 24 * 3_600_000;
const BATCH = 100;

/** Statuses where a customer can still move the delivery pin. */
const PIN_EDITABLE: OrderStatus[] = ['CREATED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'ON_HOLD', 'FAILED_ATTEMPT', 'RESCHEDULED', 'OUT_FOR_DELIVERY'];
/** Will (likely) go out within a day: ask for the pin now. */
const SOON_OUT: OrderStatus[] = ['PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'FAILED_ATTEMPT', 'RESCHEDULED'];

/** Normalised word set of an address (line + building number). */
export function addressTokens(line: string, building?: string | null): Set<string> {
  return new Set(normalizeText(`${line} ${building ?? ''}`).split(' ').filter((w) => w.length > 1 || /\d/.test(w)));
}

/** Jaccard similarity of two addresses' normalised tokens (0..1). */
export function addressSimilarity(a: { line: string; building?: string | null }, b: { line: string; building?: string | null }): number {
  const x = addressTokens(a.line, a.building);
  const y = addressTokens(b.line, b.building);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

const validPoint = (lat: unknown, lng: unknown): lat is number => typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);

/**
 * Address intelligence: every order's address lands in the customer's address
 * book, verified pins (customer pin, WhatsApp location, a successful delivery)
 * are reused for the next order without a pin, recipients without a pin are
 * asked for their location before delivery, and a geocoder fills in an
 * approximate point when zone detection was unsure.
 */
@Injectable()
export class AddressBookService implements OnModuleInit {
  private readonly log = new Logger('AddressBook');
  private geocoder: Geocoder = geocoderFromEnv();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly workflow: OrderWorkflowService,
    private readonly network: NetworkService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.workflow.registerEffect('address-book.delivered', (ctx) => this.deliveredEffect(ctx));
    this.jobs.register({ name: 'address.location_requests', everySeconds: 600, timeoutSeconds: 90, run: () => this.requestMissingPins() });
  }

  /** Swappable for tests. */
  useGeocoder(g: Geocoder) {
    this.geocoder = g;
  }

  // ------------------------------------------------------------------ order intake

  @OnEvent(DomainEvents.OrderCreated, { async: true })
  async onOrderCreated(e: OrderCreatedEvent) {
    try {
      await this.captureOrderAddress(e.orderId);
    } catch (err) {
      this.log.error(`address capture failed for ${e.trackingNumber}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Upserts the order's address, links it, reuses a verified pin, geocodes when unsure. */
  async captureOrderAddress(orderId: string) {
    const out = await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update').limit(1);
      if (!o || o.type === 'RETURN') return null;
      const { address, reused } = await this.upsertInTx(tx, o, { reusePin: true });
      return { o, address, reused };
    });
    if (!out || out.reused || out.o.lat != null) return out;
    await this.maybeGeocode(out.o, out.address).catch((err) => this.log.warn(`geocoding failed for ${out.o.trackingNumber}: ${err instanceof Error ? err.message : err}`));
    return out;
  }

  /** Finds/creates the address-book row for an order inside a transaction (order row locked by the caller). */
  async upsertInTx(tx: DbOrTx, o: OrderRow, opts: { reusePin: boolean }): Promise<{ address: AddressRow; reused: boolean }> {
    const book = await tx.select().from(customerAddresses).where(eq(customerAddresses.customerId, o.customerId)).orderBy(desc(customerAddresses.lastUsedAt)).limit(50);
    const input = { line: o.addressLine, building: o.building };
    const sameZone = book.filter((a) => a.zoneId === o.zoneId);
    let best: { row: AddressRow; score: number } | null = null;
    for (const a of sameZone) {
      const score = addressSimilarity(input, { line: a.addressLine, building: a.building });
      if (!best || score > best.score) best = { row: a, score };
    }
    const now = new Date();
    let address: AddressRow;
    if (o.customerAddressId) {
      const linked = book.find((a) => a.id === o.customerAddressId);
      if (linked) return { address: linked, reused: false };
    }
    if (best && best.score >= SAME_ADDRESS) {
      const a = best.row;
      const patch: Partial<typeof customerAddresses.$inferInsert> = { usageCount: sql`${customerAddresses.usageCount} + 1` as unknown as number, lastUsedAt: now };
      for (const k of ['building', 'floor', 'apartment', 'landmark'] as const) if (!a[k] && o[k]) patch[k] = o[k];
      if (a.lat == null && o.lat != null && o.lng != null) Object.assign(patch, { lat: o.lat, lng: o.lng });
      await tx.update(customerAddresses).set(patch).where(eq(customerAddresses.id, a.id));
      address = { ...a, ...(patch as Partial<AddressRow>), usageCount: a.usageCount + 1 };
    } else {
      const id = newId();
      const values: typeof customerAddresses.$inferInsert = {
        id, customerId: o.customerId, addressLine: o.addressLine, building: o.building, floor: o.floor, apartment: o.apartment, landmark: o.landmark,
        zoneId: o.zoneId, lat: o.lat, lng: o.lng, isVerified: false, source: 'ORDER', usageCount: 1, lastUsedAt: now,
      };
      await tx.insert(customerAddresses).values(values);
      [address] = await tx.select().from(customerAddresses).where(eq(customerAddresses.id, id)).limit(1);
    }

    // No pin on the order: reuse a verified pin of the same customer, same zone, close address.
    let reused = false;
    let linkId = address.id;
    if (opts.reusePin && (o.lat == null || o.lng == null)) {
      const candidates = [address, ...sameZone.filter((a) => a.id !== address.id)]
        .filter((a) => a.isVerified && a.lat != null && a.lng != null)
        .map((a) => ({ a, score: a.id === address.id ? 1 : addressSimilarity(input, { line: a.addressLine, building: a.building }) }))
        .filter((c) => c.score >= REUSE_PIN)
        .sort((x, y) => y.score - x.score || y.a.deliveredCount - x.a.deliveredCount);
      const pick = candidates[0]?.a;
      if (pick) {
        const res = await tx.update(orders).set({ lat: pick.lat, lng: pick.lng }).where(and(eq(orders.id, o.id), isNull(orders.lat)));
        if ((res as unknown as [{ affectedRows: number }])[0]?.affectedRows === 1) {
          reused = true;
          linkId = pick.id;
          await this.workflow.addNote(tx, o, SYSTEM_ACTOR, { reason: 'PIN_REUSED', note: 'Pin reused from a previous delivery', isPublic: false, metadata: { customerAddressId: pick.id } });
        }
      }
    }
    await tx.update(orders).set({ customerAddressId: linkId }).where(eq(orders.id, o.id));
    return { address: linkId === address.id ? address : (await tx.select().from(customerAddresses).where(eq(customerAddresses.id, linkId)).limit(1))[0], reused };
  }

  private async maybeGeocode(o: OrderRow, address: AddressRow) {
    if (!this.geocoder.enabled) return;
    const detection = (o.metadata as { zoneDetection?: { confidence?: number } } | null)?.zoneDetection;
    if (detection?.confidence != null && detection.confidence >= LOW_CONFIDENCE) return;
    const zone = await this.network.zoneById(o.zoneId);
    if (!zone) return;
    const query = [o.addressLine, o.landmark, zone.nameAr, zone.cityNameAr, 'مصر'].filter(Boolean).join('، ');
    const hit = await this.geocoder.geocode(query, { near: { lat: zone.centerLat, lng: zone.centerLng } });
    if (!hit || haversineKm(hit, { lat: zone.centerLat, lng: zone.centerLng }) > PIN_MAX_KM) return;
    await this.db.transaction(async (tx) => {
      const [cur] = await tx.select({ metadata: orders.metadata, lat: orders.lat }).from(orders).where(eq(orders.id, o.id)).for('update').limit(1);
      if (!cur || cur.lat != null) return;
      await tx
        .update(orders)
        .set({ metadata: { ...(cur.metadata ?? {}), geocode: { lat: hit.lat, lng: hit.lng, confidence: hit.confidence, provider: hit.provider, formatted: hit.formatted } } })
        .where(eq(orders.id, o.id));
      if (address.lat == null) {
        await tx.update(customerAddresses).set({ lat: hit.lat, lng: hit.lng, source: 'GEOCODER', isVerified: false }).where(and(eq(customerAddresses.id, address.id), isNull(customerAddresses.lat)));
      }
    });
  }

  // ------------------------------------------------------------------ delivery verifies the address

  private async deliveredEffect(ctx: TransitionContext & { updated: OrderRow }) {
    if (ctx.to !== 'DELIVERED' || ctx.order.type === 'RETURN') return;
    const { tx, updated: o, opts } = ctx;
    let addressId = o.customerAddressId;
    if (!addressId) addressId = (await this.upsertInTx(tx, o, { reusePin: false })).address.id;
    const [a] = await tx.select().from(customerAddresses).where(eq(customerAddresses.id, addressId)).for('update').limit(1);
    if (!a) return;
    const patch: Partial<typeof customerAddresses.$inferInsert> = {
      deliveredCount: sql`${customerAddresses.deliveredCount} + 1` as unknown as number, isVerified: true, lastUsedAt: opts.at ?? new Date(),
    };
    const replaceable = a.lat == null || a.source === 'GEOCODER';
    if (replaceable) {
      if (o.lat != null && o.lng != null) Object.assign(patch, { lat: o.lat, lng: o.lng, source: a.source === 'GEOCODER' ? 'ORDER' : a.source });
      else if (validPoint(opts.lat, opts.lng) && (await this.nearZone(o.zoneId, { lat: opts.lat, lng: opts.lng! }))) {
        // No pin on the order: the hero's GPS at the door becomes the address pin.
        Object.assign(patch, { lat: opts.lat, lng: opts.lng, source: a.source === 'GEOCODER' ? 'ORDER' : a.source });
      }
    }
    await tx.update(customerAddresses).set(patch).where(eq(customerAddresses.id, a.id));
  }

  private async nearZone(zoneId: string, p: LatLng) {
    const zone = await this.network.zoneById(zoneId);
    return !!zone && haversineKm(p, { lat: zone.centerLat, lng: zone.centerLng }) <= PIN_MAX_KM;
  }

  // ------------------------------------------------------------------ customer pins

  @OnEvent(CUSTOMER_PIN_EVENT, { async: true })
  async onCustomerPin(e: CustomerPinEvent) {
    try {
      await this.db.transaction(async (tx) => {
        const [o] = await tx.select().from(orders).where(eq(orders.id, e.orderId)).for('update').limit(1);
        if (o) await this.pinAddressInTx(tx, o, { lat: e.lat, lng: e.lng }, 'CUSTOMER_PIN');
      });
    } catch (err) {
      this.log.error(`customer pin capture failed for ${e.orderId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Marks the order's address as verified at this point (customer-confirmed location). */
  private async pinAddressInTx(tx: DbOrTx, o: OrderRow, p: LatLng, source: AddressSource) {
    const { address } = await this.upsertInTx(tx, o, { reusePin: false });
    await tx.update(customerAddresses).set({ lat: p.lat, lng: p.lng, isVerified: true, source, lastUsedAt: new Date() }).where(eq(customerAddresses.id, address.id));
    return address.id;
  }

  /**
   * Customer location from the tracking page ("drop your pin") or a WhatsApp
   * location message: moves the open order's pin and verifies the address.
   */
  async applyPin(orderId: string, p: LatLng, source: Extract<AddressSource, 'CUSTOMER_PIN' | 'WHATSAPP_LOCATION'>, actor: ActorContext) {
    if (!validPoint(p.lat, p.lng)) throw new DomainError('INVALID_PIN', 'Send a valid location', HttpStatus.BAD_REQUEST);
    return this.db.transaction(async (tx) => {
      const o = await this.workflow.lock(tx, orderId);
      if (!PIN_EDITABLE.includes(o.status)) {
        throw new DomainError('ADDRESS_LOCKED', 'This shipment can no longer be changed', HttpStatus.CONFLICT, { status: o.status });
      }
      if (!(await this.nearZone(o.zoneId, p))) {
        throw new DomainError('PIN_OUT_OF_ZONE', 'The pin is too far from the delivery area — contact support to change the area', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      await tx.update(orders).set({ lat: p.lat, lng: p.lng }).where(eq(orders.id, o.id));
      const addressId = await this.pinAddressInTx(tx, { ...o, lat: p.lat, lng: p.lng }, p, source);
      const via = source === 'WHATSAPP_LOCATION' ? 'WhatsApp location' : 'map pin';
      await this.workflow.addNote(tx, o, actor, { reason: 'CUSTOMER_ADDRESS_UPDATE', note: `Customer shared their location (${via})`, isPublic: true, lat: p.lat, lng: p.lng, metadata: { fields: ['lat', 'lng'], source, customerAddressId: addressId } });
      await this.audit.record(auditPrincipal(actor), { action: 'order.customer_pin', entity: 'Order', entityId: o.id, before: { lat: o.lat, lng: o.lng }, after: { lat: p.lat, lng: p.lng, source } }, null, tx);
      return { orderId: o.id, trackingNumber: o.trackingNumber, lat: p.lat, lng: p.lng, customerAddressId: addressId };
    });
  }

  // ------------------------------------------------------------------ location requests

  /** Job: one location_request per order without a pin, the day before / when it goes out. */
  async requestMissingPins(now = new Date()): Promise<string> {
    const s = await this.settings.get('integrity');
    if (!s.requestPinWhenMissing) return 'disabled';
    const tomorrow = addDays(cairoToday(now), 1);
    const rows = await this.db
      .select({ id: orders.id, tn: orders.trackingNumber, phone: orders.recipientPhone })
      .from(orders)
      .where(
        and(
          isNull(orders.lat),
          inArray(orders.type, ['DELIVERY', 'EXCHANGE']),
          gte(orders.createdAt, new Date(now.getTime() - 14 * 24 * 3_600_000)),
          or(eq(orders.status, 'OUT_FOR_DELIVERY'), and(inArray(orders.status, SOON_OUT), or(isNull(orders.scheduledDate), lte(orders.scheduledDate, tomorrow)))),
          sql`not exists (select 1 from ${notifications} n where n.orderId = ${orders.id} and n.template = 'location_request')`,
        ),
      )
      .orderBy(asc(orders.createdAt))
      .limit(BATCH);
    for (const r of rows) {
      const token = signLink(r.tn, 'pin', PIN_LINK_TTL_MS, '', now.getTime());
      await this.notifications.queue({
        channel: s.confirmationChannel, to: r.phone, template: 'location_request', locale: 'ar', orderId: r.id,
        vars: { tn: r.tn, link: trackingLink(r.tn, { pin: '1', p: token }) }, data: { kind: 'location_request' },
      });
    }
    return `requested ${rows.length}`;
  }

  // ------------------------------------------------------------------ reads

  /** Staff: the customer's address book with pins, verification and usage. */
  async listForCustomer(customerId: string) {
    const [c] = await this.db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!c) throw notFound('Customer', customerId);
    const rows = await this.db.select().from(customerAddresses).where(eq(customerAddresses.customerId, customerId)).orderBy(desc(customerAddresses.lastUsedAt)).limit(100);
    const zoneMap = await loadByIds(this.db, zones, zones.id, rows.map((r) => r.zoneId));
    const counts = rows.length
      ? await this.db
          .select({ id: orders.customerAddressId, n: sql<number>`count(*)`.mapWith(Number), brands: sql<number>`count(distinct ${orders.brandId})`.mapWith(Number) })
          .from(orders)
          .where(inArray(orders.customerAddressId, rows.map((r) => r.id)))
          .groupBy(orders.customerAddressId)
      : [];
    const byId = new Map(counts.map((r) => [r.id!, r]));
    return {
      data: rows.map((a) => {
        const z = zoneMap.get(a.zoneId);
        return {
          ...a,
          zone: z ? { id: z.id, code: z.code, nameEn: z.nameEn, nameAr: z.nameAr } : null,
          ordersCount: byId.get(a.id)?.n ?? 0,
          brandsCount: byId.get(a.id)?.brands ?? 0,
          hasPin: a.lat != null && a.lng != null,
        };
      }),
    };
  }

  /**
   * Brand: addresses this brand already used for the phone, plus whether the
   * network holds a verified pin for it. Never returns other brands' addresses or any coordinates.
   */
  async suggest(brandId: string, rawPhone: string) {
    const phone = normalizeEgyptPhone(rawPhone);
    if (!phone) throw new DomainError('INVALID_PHONE', 'Enter a valid Egyptian mobile number', HttpStatus.BAD_REQUEST);
    const [c] = await this.db.select({ id: customers.id }).from(customers).where(eq(customers.phone, phone)).limit(1);
    if (!c) return { phone, addresses: [], verifiedPinAvailable: false };
    const used = await this.db
      .select({ id: orders.customerAddressId, lastAt: sql<Date>`max(${orders.createdAt})`, n: sql<number>`count(*)`.mapWith(Number) })
      .from(orders)
      .where(and(eq(orders.brandId, brandId), eq(orders.customerId, c.id), isNotNull(orders.customerAddressId)))
      .groupBy(orders.customerAddressId);
    const ids = used.map((u) => u.id!).filter(Boolean);
    const rows = ids.length ? await this.db.select().from(customerAddresses).where(inArray(customerAddresses.id, ids)) : [];
    const zoneMap = await loadByIds(this.db, zones, zones.id, rows.map((r) => r.zoneId));
    const usage = new Map(used.map((u) => [u.id!, u]));
    const [verified] = await this.db
      .select({ id: customerAddresses.id })
      .from(customerAddresses)
      .where(and(eq(customerAddresses.customerId, c.id), eq(customerAddresses.isVerified, true), isNotNull(customerAddresses.lat)))
      .limit(1);
    return {
      phone,
      verifiedPinAvailable: !!verified,
      addresses: rows
        .map((a) => {
          const z = zoneMap.get(a.zoneId);
          return {
            id: a.id,
            addressLine: a.addressLine,
            building: a.building,
            floor: a.floor,
            apartment: a.apartment,
            landmark: a.landmark,
            zone: z ? { id: z.id, code: z.code, nameEn: z.nameEn, nameAr: z.nameAr } : null,
            verifiedPin: a.isVerified && a.lat != null,
            ordersCount: usage.get(a.id)?.n ?? 0,
            lastUsedAt: usage.get(a.id)?.lastAt ?? a.lastUsedAt,
          };
        })
        .sort((x, y) => new Date(y.lastUsedAt ?? 0).getTime() - new Date(x.lastUsedAt ?? 0).getTime()),
    };
  }
}
