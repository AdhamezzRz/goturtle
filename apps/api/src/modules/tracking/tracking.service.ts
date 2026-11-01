import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import {
  CUSTOMER_STEP_LABELS, CUSTOMER_STEPS, customerStepIndex, haversineKm, isValidTrackingNumber, maskPhone, normalizeTrackingNumber,
  ORDER_STATUS_LABELS, ORDER_STATUS_TONE, type OrderStatus,
} from '@goturtle/shared';
import type { Db } from '../../db/client';
import { brands, cities, couriers, orderEvents, orders, runsheets, users, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { DomainError, notFound } from '../../common/errors';
import { actorFromPrincipal, SYSTEM_ACTOR } from '../../common/actor';
import type { Principal } from '../../common/principal';
import { OrderWorkflowService } from '../orders/order-workflow.service';
import { OrdersService } from '../orders/orders.service';
import type { OrderRow } from '../orders/order-factory.service';
import { affected, assertDayInRange, auditPrincipal, endOfCairoDay, firstName, round2 } from '../orders/ops-kit';
import type { RateDto, RescheduleDto, UpdateAddressDto } from './tracking.dto';
import { CUSTOMER_PIN_EVENT, type CustomerPinEvent } from '../address-book/address-book.service';

/** Before the parcel leaves with a hero for delivery. */
const BEFORE_OUT: OrderStatus[] = ['CREATED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'ON_HOLD'];
const RESCHEDULABLE: OrderStatus[] = [...BEFORE_OUT, 'FAILED_ATTEMPT'];
const ADDRESS_EDITABLE: OrderStatus[] = [...BEFORE_OUT, 'FAILED_ATTEMPT', 'RESCHEDULED'];
const HERO_VISIBLE: OrderStatus[] = ['ASSIGNED', 'OUT_FOR_DELIVERY'];
const PIN_MAX_KM = 15;

/**
 * Public tracking page and the customer (consignee) self-service actions.
 * Public responses never expose the full phone, address or COD amount; a
 * verified customer token for the recipient phone unlocks details and the
 * hero's live position while the parcel is out for delivery.
 */
@Injectable()
export class TrackingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly workflow: OrderWorkflowService,
    private readonly orders: OrdersService,
    private readonly events: EventEmitter2,
  ) {}

  private async byTracking(raw: string): Promise<OrderRow> {
    const tn = normalizeTrackingNumber(raw);
    if (!isValidTrackingNumber(tn)) throw new DomainError('INVALID_TRACKING_NUMBER', 'Tracking number is not valid', HttpStatus.BAD_REQUEST);
    const [o] = await this.db.select().from(orders).where(eq(orders.trackingNumber, tn)).limit(1);
    if (!o) throw notFound('Shipment', tn);
    return o;
  }

  /** The customer principal owns the shipment's phone. */
  private verified(p: Principal | undefined, o: Pick<OrderRow, 'recipientPhone' | 'recipientAltPhone'>): boolean {
    return !!p && p.kind === 'customer' && (p.phone === o.recipientPhone || (!!o.recipientAltPhone && p.phone === o.recipientAltPhone));
  }

  private async owned(raw: string, p: Principal): Promise<OrderRow> {
    const o = await this.byTracking(raw);
    if (!this.verified(p, o)) throw notFound('Shipment', o.trackingNumber);
    return o;
  }

  async track(raw: string, p?: Principal) {
    const o = await this.byTracking(raw);
    const verified = this.verified(p, o);
    const [info] = await this.db
      .select({ brandName: brands.name, brandLogo: brands.logoUrl, zoneEn: zones.nameEn, zoneAr: zones.nameAr, cityEn: cities.nameEn, cityAr: cities.nameAr })
      .from(orders)
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .innerJoin(zones, eq(zones.id, orders.zoneId))
      .innerJoin(cities, eq(cities.id, zones.cityId))
      .where(eq(orders.id, o.id))
      .limit(1);
    const events = await this.db
      .select({ status: orderEvents.status, fromStatus: orderEvents.fromStatus, reason: orderEvents.reason, actorType: orderEvents.actorType, note: orderEvents.note, createdAt: orderEvents.createdAt })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, o.id), eq(orderEvents.isPublic, true)))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));

    let hero: { firstName: string; vehicleType: string; rating: number } | null = null;
    let live: { lat: number; lng: number; lastSeenAt: Date | null } | null = null;
    if (o.courierId && HERO_VISIBLE.includes(o.status)) {
      const [c] = await this.db
        .select({ name: users.name, vehicleType: couriers.vehicleType, rating: couriers.rating, lat: couriers.lastLat, lng: couriers.lastLng, lastSeenAt: couriers.lastSeenAt })
        .from(couriers)
        .innerJoin(users, eq(users.id, couriers.userId))
        .where(eq(couriers.id, o.courierId))
        .limit(1);
      if (c) {
        hero = { firstName: firstName(c.name), vehicleType: c.vehicleType, rating: round2(c.rating) };
        if (verified && o.status === 'OUT_FOR_DELIVERY' && c.lat != null && c.lng != null) live = { lat: c.lat, lng: c.lng, lastSeenAt: c.lastSeenAt };
      }
    }
    let eta: Date | null = null;
    if (o.status === 'OUT_FOR_DELIVERY' && o.runsheetId) {
      const [rs] = await this.db.select({ route: runsheets.route, dispatchedAt: runsheets.dispatchedAt }).from(runsheets).where(eq(runsheets.id, o.runsheetId)).limit(1);
      const leg = rs?.route?.find((r) => r.orderId === o.id);
      if (leg && rs.dispatchedAt) eta = new Date(Math.max(Date.now(), rs.dispatchedAt.getTime() + leg.etaMinutes * 60_000));
    }
    const step = customerStepIndex(o.status);
    return {
      trackingNumber: o.trackingNumber,
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS[o.status],
      tone: ORDER_STATUS_TONE[o.status],
      step,
      steps: CUSTOMER_STEPS.map((key, i) => ({ key, label: CUSTOMER_STEP_LABELS[key], done: step >= 0 && i <= step })),
      exception: step < 0 ? { status: o.status, label: ORDER_STATUS_LABELS[o.status] } : null,
      type: o.type,
      brand: { name: info.brandName, logoUrl: info.brandLogo },
      destination: { zone: { en: info.zoneEn, ar: info.zoneAr }, city: { en: info.cityEn, ar: info.cityAr } },
      promisedBy: o.promisedBy,
      eta: eta ?? (o.status === 'DELIVERED' ? null : o.promisedBy),
      scheduledDate: o.scheduledDate,
      deliveredAt: o.deliveredAt,
      attempts: o.attempts,
      maxAttempts: o.maxAttempts,
      paymentMethod: o.paymentMethod,
      recipient: { firstName: firstName(o.recipientName), phone: maskPhone(o.recipientPhone) },
      hero,
      heroLocation: live,
      timeline: events.map((e) => ({
        status: e.status,
        label: ORDER_STATUS_LABELS[e.status],
        isStatusChange: e.fromStatus !== e.status,
        reason: e.reason,
        note: e.actorType === 'CUSTOMER' ? e.note : null,
        at: e.createdAt,
      })),
      verified,
      ...(verified
        ? {
            details: {
              recipientName: o.recipientName,
              phone: o.recipientPhone,
              address: { line: o.addressLine, building: o.building, floor: o.floor, apartment: o.apartment, landmark: o.landmark, lat: o.lat, lng: o.lng },
              amountToPayCents: o.collectCents,
              itemsCount: o.itemsCount,
              allowOpening: o.allowOpening,
              deliveryOtpRequired: o.deliveryOtpRequired,
              rating: o.rating,
            },
            can: {
              reschedule: RESCHEDULABLE.includes(o.status),
              editAddress: ADDRESS_EDITABLE.includes(o.status),
              rate: o.status === 'DELIVERED' && o.rating == null,
            },
          }
        : {}),
    };
  }

  /** All shipments for the verified phone (most recent first). */
  async myOrders(p: Principal) {
    if (p.kind !== 'customer') throw notFound('Shipment');
    const rows = await this.db
      .select({
        trackingNumber: orders.trackingNumber, status: orders.status, type: orders.type, createdAt: orders.createdAt, promisedBy: orders.promisedBy,
        deliveredAt: orders.deliveredAt, collectCents: orders.collectCents, paymentMethod: orders.paymentMethod, rating: orders.rating, brandName: brands.name, brandLogo: brands.logoUrl,
      })
      .from(orders)
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .where(or(eq(orders.recipientPhone, p.phone), eq(orders.recipientAltPhone, p.phone)))
      .orderBy(desc(orders.createdAt))
      .limit(50);
    return {
      phone: p.phone,
      orders: rows.map((r) => ({
        ...r,
        statusLabel: ORDER_STATUS_LABELS[r.status],
        step: customerStepIndex(r.status),
        brand: { name: r.brandName, logoUrl: r.brandLogo },
        can: { reschedule: RESCHEDULABLE.includes(r.status), editAddress: ADDRESS_EDITABLE.includes(r.status), rate: r.status === 'DELIVERED' && r.rating == null },
      })),
    };
  }

  async reschedule(raw: string, dto: RescheduleDto, p: Principal) {
    const found = await this.owned(raw, p);
    assertDayInRange(dto.date, { minOffset: 1, maxOffset: 7, field: 'date' });
    const actor = actorFromPrincipal(p);
    await this.workflow.run(async (tx, fx) => {
      const o = await this.workflow.lock(tx, found.id);
      if (!RESCHEDULABLE.includes(o.status)) {
        throw new DomainError('RESCHEDULE_NOT_ALLOWED', `A shipment that is ${ORDER_STATUS_LABELS[o.status].en.toLowerCase()} cannot be rescheduled`, HttpStatus.CONFLICT, { status: o.status });
      }
      const note = `Customer asked for delivery on ${dto.date}${dto.note ? ` — ${dto.note}` : ''}`;
      if (o.status === 'FAILED_ATTEMPT') {
        await this.workflow.apply(tx, fx, o.id, 'RESCHEDULED', actor, { scheduledDate: dto.date, reason: 'CUSTOMER_RESCHEDULED', note });
        return;
      }
      let cur = o;
      if (o.status === 'ASSIGNED') {
        // Not going out today any more: back to the hub queue.
        cur = await this.workflow.apply(tx, fx, o.id, 'RECEIVED_AT_HUB', SYSTEM_ACTOR, { clearRunsheet: true, reason: 'CUSTOMER_RESCHEDULED', isPublic: false, note: 'Removed from runsheet: customer rescheduled' });
        if (o.runsheetId) await this.orders.refreshRunsheetCod(tx, o.runsheetId);
      }
      await tx.update(orders).set({ scheduledDate: dto.date, promisedBy: endOfCairoDay(dto.date) }).where(eq(orders.id, o.id));
      await this.workflow.addNote(tx, cur, actor, { reason: 'CUSTOMER_RESCHEDULED', note, isPublic: true, metadata: { scheduledDate: dto.date } });
      await this.audit.record(auditPrincipal(actor), { action: 'order.customer_reschedule', entity: 'Order', entityId: o.id, before: { scheduledDate: o.scheduledDate }, after: { scheduledDate: dto.date } }, null, tx);
    });
    return this.track(found.trackingNumber, p);
  }

  async updateAddress(raw: string, dto: UpdateAddressDto, p: Principal) {
    const found = await this.owned(raw, p);
    const actor = actorFromPrincipal(p);
    if ((dto.lat == null) !== (dto.lng == null)) throw new DomainError('INVALID_PIN', 'Send both lat and lng', HttpStatus.BAD_REQUEST);
    await this.db.transaction(async (tx) => {
      const o = await this.workflow.lock(tx, found.id);
      if (!ADDRESS_EDITABLE.includes(o.status)) {
        throw new DomainError('ADDRESS_LOCKED', 'The parcel is already on its way — call the hero or support to change the address', HttpStatus.CONFLICT, { status: o.status });
      }
      if (dto.lat != null && dto.lng != null) {
        const [z] = await tx.select({ lat: zones.centerLat, lng: zones.centerLng }).from(zones).where(eq(zones.id, o.zoneId)).limit(1);
        if (haversineKm({ lat: dto.lat, lng: dto.lng }, { lat: z.lat, lng: z.lng }) > PIN_MAX_KM) {
          throw new DomainError('PIN_OUT_OF_ZONE', 'The pin is too far from the delivery area — contact support to change the area', HttpStatus.UNPROCESSABLE_ENTITY);
        }
      }
      const patch: Partial<typeof orders.$inferInsert> = {};
      for (const k of ['landmark', 'building', 'floor', 'apartment'] as const) if (dto[k] !== undefined) patch[k] = dto[k]?.trim() || null;
      if (dto.lat != null && dto.lng != null) Object.assign(patch, { lat: dto.lat, lng: dto.lng });
      if (dto.notes?.trim()) patch.notes = `${o.notes ? `${o.notes}\n` : ''}Customer: ${dto.notes.trim()}`.slice(0, 1000);
      const fields = Object.keys(patch);
      if (!fields.length) throw new DomainError('NOTHING_TO_UPDATE', 'Nothing to update', HttpStatus.BAD_REQUEST);
      await tx.update(orders).set(patch).where(eq(orders.id, o.id));
      await this.workflow.addNote(tx, o, actor, { reason: 'CUSTOMER_ADDRESS_UPDATE', note: `Customer updated ${fields.map((f) => (f === 'lat' || f === 'lng' ? 'map pin' : f)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`, isPublic: true, metadata: { fields } });
      await this.audit.record(auditPrincipal(actor), { action: 'order.customer_address', entity: 'Order', entityId: o.id, after: patch }, null, tx);
    });
    // Address book: a customer-placed pin verifies the address for future orders.
    if (dto.lat != null && dto.lng != null) this.events.emit(CUSTOMER_PIN_EVENT, { orderId: found.id, lat: dto.lat, lng: dto.lng } satisfies CustomerPinEvent);
    return this.track(found.trackingNumber, p);
  }

  async rate(raw: string, dto: RateDto, p: Principal) {
    const found = await this.owned(raw, p);
    if (found.status !== 'DELIVERED') throw new DomainError('NOT_DELIVERED', 'You can rate the delivery once it is delivered', HttpStatus.CONFLICT);
    await this.db.transaction(async (tx) => {
      const res = await tx.update(orders).set({ rating: dto.rating, ratingComment: dto.comment?.trim() || null }).where(and(eq(orders.id, found.id), isNull(orders.rating)));
      if (affected(res) !== 1) throw new DomainError('ALREADY_RATED', 'This delivery was already rated', HttpStatus.CONFLICT);
      if (found.courierId) {
        const [c] = await tx.select({ rating: couriers.rating, ratingCount: couriers.ratingCount }).from(couriers).where(eq(couriers.id, found.courierId)).for('update').limit(1);
        if (c) {
          const n = c.ratingCount + 1;
          await tx.update(couriers).set({ rating: round2((c.rating * c.ratingCount + dto.rating) / n), ratingCount: n }).where(eq(couriers.id, found.courierId));
        }
      }
      await this.audit.record(auditPrincipal(actorFromPrincipal(p)), { action: 'order.rate', entity: 'Order', entityId: found.id, after: { rating: dto.rating } }, null, tx);
    });
    return { ok: true, trackingNumber: found.trackingNumber, rating: dto.rating };
  }
}
