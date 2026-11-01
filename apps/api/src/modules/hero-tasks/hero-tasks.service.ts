import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import { formatEgyptPhone, ORDER_STATUS_LABELS, type OrderStatus } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { brandLocations, brands, couriers, orders, runsheets, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { OtpService } from '../../core/otp.service';
import { DomainError, notFound } from '../../common/errors';
import type { ActorContext } from '../../common/actor';
import { cairoToday } from '../../db/helpers';
import { OrderWorkflowService } from '../orders/order-workflow.service';
import type { OrderRow } from '../orders/order-factory.service';
import { PickupsService } from '../pickups/pickups.service';
import { RunsheetsService } from '../dispatch/runsheets.service';
import { assertDayInRange, auditPrincipal, mapsLink, startOfCairoDay } from '../orders/ops-kit';
import { AuditService } from '../../core/audit.service';
import type { DeliverDto, FailDto, NoteDto, ReturnedDto } from './hero-tasks.dto';

const OPEN_STOP: OrderStatus[] = ['ASSIGNED', 'OUT_FOR_DELIVERY'];
/** Parcels the hero carries that must go back to the hub. */
const TO_HUB: OrderStatus[] = ['PICKED_UP', 'FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_PENDING'];

/**
 * Hero (courier) self-service: today's agenda and every action a hero takes
 * on their own pickups, stops and returns. Heroes only ever see their own work.
 */
@Injectable()
export class HeroTasksService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly workflow: OrderWorkflowService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly pickups: PickupsService,
    private readonly runsheets: RunsheetsService,
  ) {}

  // ------------------------------------------------------------------ agenda

  async today(courierId: string) {
    const day = cairoToday();
    const [courier] = await this.db
      .select({ id: couriers.id, code: couriers.code, cashOnHandCents: couriers.cashOnHandCents, cashLimitCents: couriers.cashLimitCents, availability: couriers.availability })
      .from(couriers)
      .where(eq(couriers.id, courierId))
      .limit(1);
    const sheets = await this.db
      .select()
      .from(runsheets)
      .where(
        and(
          eq(runsheets.courierId, courierId),
          ne(runsheets.status, 'CLOSED'),
          or(and(eq(runsheets.date, day), eq(runsheets.status, 'DRAFT')), and(lte(runsheets.date, day), inArray(runsheets.status, ['DISPATCHED', 'IN_PROGRESS', 'COMPLETED']))),
        ),
      )
      .orderBy(asc(runsheets.date), asc(runsheets.createdAt));
    const runsheetViews = [];
    for (const rs of sheets) {
      const stops = (await this.runsheets.stops(rs.id, rs)).map((s) => ({
        orderId: s.id, seq: s.routeSequence, trackingNumber: s.trackingNumber, status: s.status, statusLabel: s.statusLabel, isOpen: s.isOpen,
        recipientName: s.recipientName, address: s.addressLine, landmark: s.landmark, zone: { code: s.zone.code, nameEn: s.zone.nameEn, nameAr: s.zone.nameAr },
        collectCents: s.collectCents, paymentMethod: s.paymentMethod, attempts: s.attempts, etaMinutes: s.etaMinutes, eta: s.eta, legKm: s.legKm,
        deliveryOtpRequired: s.deliveryOtpRequired, mapsUrl: s.mapsUrl, brand: s.brand,
      }));
      runsheetViews.push({
        id: rs.id, code: rs.code, date: rs.date, status: rs.status, dispatchedAt: rs.dispatchedAt, startedAt: rs.startedAt,
        totalDistanceKm: rs.totalDistanceKm, totalMinutes: rs.totalMinutes, expectedCodCents: rs.expectedCodCents, collectedCents: rs.collectedCents,
        canStart: rs.status === 'DISPATCHED',
        stops,
      });
    }
    const carrying = await this.db
      .select({
        id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, type: orders.type, recipientName: orders.recipientName,
        addressLine: orders.addressLine, collectCents: orders.collectCents, runsheetId: orders.runsheetId, brandId: orders.brandId,
        brandName: brands.name, brandCode: brands.code, locationName: brandLocations.name, locationAddress: brandLocations.addressLine, locationPhone: brandLocations.phone,
      })
      .from(orders)
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .leftJoin(brandLocations, eq(brandLocations.id, orders.pickupLocationId))
      .where(and(eq(orders.courierId, courierId), inArray(orders.status, [...TO_HUB, 'RETURN_OUT'])));
    const returns = carrying.map((o) => ({
      orderId: o.id, trackingNumber: o.trackingNumber, status: o.status, statusLabel: ORDER_STATUS_LABELS[o.status], type: o.type,
      recipientName: o.recipientName, address: o.addressLine, brand: { code: o.brandCode, name: o.brandName },
      destination: o.status === 'RETURN_OUT' ? 'BRAND' : 'HUB',
      brandLocation: o.status === 'RETURN_OUT' ? { name: o.locationName, address: o.locationAddress, phone: o.locationPhone } : null,
      canStartReturn: o.status === 'RETURN_PENDING',
      canMarkReturned: o.status === 'RETURN_OUT',
    }));
    const pickups = await this.pickups.forCourier(courierId, day);
    const allStops = runsheetViews.flatMap((r) => r.stops);
    const [collectedToday] = await this.db
      .select({ s: sql<number>`coalesce(sum(${orders.collectedCents}), 0)`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
      .from(orders)
      .where(and(eq(orders.courierId, courierId), eq(orders.status, 'DELIVERED'), gte(orders.deliveredAt, startOfCairoDay(day))));
    return {
      date: day,
      courier,
      summary: {
        stops: allStops.length,
        remaining: allStops.filter((s) => s.isOpen).length,
        delivered: allStops.filter((s) => s.status === 'DELIVERED').length,
        failed: allStops.filter((s) => ['FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_PENDING'].includes(s.status)).length,
        codToCollectCents: allStops.filter((s) => s.isOpen).reduce((sum, s) => sum + s.collectCents, 0),
        collectedTodayCents: collectedToday?.s ?? 0,
        deliveredToday: collectedToday?.n ?? 0,
        pickups: pickups.length,
        returnsToHub: returns.filter((r) => r.destination === 'HUB').length,
        returnsToBrand: returns.filter((r) => r.destination === 'BRAND').length,
      },
      pickups,
      runsheets: runsheetViews,
      returns,
    };
  }

  async runsheet(id: string, courierId: string) {
    const d = await this.runsheets.detail(id, { forHero: true });
    if (d.courier.id !== courierId) throw notFound('Runsheet', id);
    return d;
  }

  // ------------------------------------------------------------------ stops

  private async mine(orderId: string, courierId: string): Promise<OrderRow> {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o || o.courierId !== courierId) throw notFound('Order', orderId);
    return o;
  }

  async stop(orderId: string, courierId: string) {
    const o = await this.mine(orderId, courierId);
    const [extra] = await this.db
      .select({ zoneCode: zones.code, zoneNameEn: zones.nameEn, zoneNameAr: zones.nameAr, zoneLat: zones.centerLat, zoneLng: zones.centerLng, brandName: brands.name, brandCode: brands.code, brandPhone: brands.phone })
      .from(orders)
      .innerJoin(zones, eq(zones.id, orders.zoneId))
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .where(eq(orders.id, orderId))
      .limit(1);
    let eta: Date | null = null;
    if (o.runsheetId) {
      const [rs] = await this.db.select({ route: runsheets.route, dispatchedAt: runsheets.dispatchedAt, code: runsheets.code }).from(runsheets).where(eq(runsheets.id, o.runsheetId)).limit(1);
      const leg = rs?.route?.find((r) => r.orderId === o.id);
      if (leg && rs.dispatchedAt) eta = new Date(rs.dispatchedAt.getTime() + leg.etaMinutes * 60_000);
    }
    return {
      id: o.id,
      trackingNumber: o.trackingNumber,
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS[o.status],
      type: o.type,
      recipient: { name: o.recipientName, phone: o.recipientPhone, phoneDisplay: formatEgyptPhone(o.recipientPhone), altPhone: o.recipientAltPhone },
      address: { line: o.addressLine, building: o.building, floor: o.floor, apartment: o.apartment, landmark: o.landmark, lat: o.lat, lng: o.lng },
      zone: { code: extra.zoneCode, nameEn: extra.zoneNameEn, nameAr: extra.zoneNameAr },
      brand: { name: extra.brandName, code: extra.brandCode, phone: extra.brandPhone },
      notes: o.notes,
      paymentMethod: o.paymentMethod,
      collectCents: o.collectCents,
      itemsCount: o.itemsCount,
      packageDescription: o.packageDescription,
      isFragile: o.isFragile,
      allowOpening: o.allowOpening,
      otpRequired: o.deliveryOtpRequired,
      attempts: o.attempts,
      maxAttempts: o.maxAttempts,
      scheduledDate: o.scheduledDate,
      promisedBy: o.promisedBy,
      eta,
      mapsUrl: mapsLink(o.lat ?? null, o.lng ?? null),
      approximateMapsUrl: o.lat == null ? mapsLink(extra.zoneLat, extra.zoneLng) : null,
      actions: {
        outForDelivery: ['ASSIGNED', 'FAILED_ATTEMPT', 'RESCHEDULED', 'PICKED_UP'].includes(o.status),
        deliver: o.status === 'OUT_FOR_DELIVERY',
        fail: o.status === 'OUT_FOR_DELIVERY',
        resendOtp: o.status === 'OUT_FOR_DELIVERY' && o.deliveryOtpRequired,
        returnToHub: TO_HUB.includes(o.status),
        startReturn: o.status === 'RETURN_PENDING',
        returned: o.status === 'RETURN_OUT',
      },
    };
  }

  async outForDelivery(orderId: string, actor: ActorContext, pos: { lat?: number; lng?: number }) {
    await this.mine(orderId, actor.courierId!);
    await this.workflow.transition(orderId, 'OUT_FOR_DELIVERY', actor, { lat: pos.lat, lng: pos.lng });
    return this.stop(orderId, actor.courierId!);
  }

  async deliver(orderId: string, dto: DeliverDto, actor: ActorContext) {
    const o = await this.mine(orderId, actor.courierId!);
    this.workflow.assertAllowed(o, 'DELIVERED', actor);
    if (dto.collectedCents !== o.collectCents) {
      throw new DomainError('COLLECTED_MISMATCH', `Collect exactly ${(o.collectCents / 100).toFixed(2)} EGP for this parcel`, HttpStatus.UNPROCESSABLE_ENTITY, { expectedCents: o.collectCents, collectedCents: dto.collectedCents });
    }
    if (o.deliveryOtpRequired) {
      if (!dto.otp) throw new DomainError('OTP_REQUIRED', 'Ask the recipient for the delivery code sent by SMS', HttpStatus.UNPROCESSABLE_ENTITY);
      // Verified outside the delivery transaction so failed attempts are always counted.
      await this.otp.verify(o.recipientPhone, 'DELIVERY', dto.otp, { orderId });
    }
    await this.workflow.transition(orderId, 'DELIVERED', actor, {
      lat: dto.lat, lng: dto.lng, note: dto.note ?? null,
      delivery: { collectedCents: dto.collectedCents, podPhotoUrl: dto.podPhotoUrl ?? null, signatureUrl: dto.signatureUrl ?? null, receivedBy: dto.receivedBy ?? null },
      metadata: o.deliveryOtpRequired ? { otpVerified: true } : null,
      // Validated and normalised by the money-programs collection guard.
      extensions: { collection: { method: dto.collectionMethod ?? 'CASH', reference: dto.collectionReference?.trim() || null } },
    });
    return this.stop(orderId, actor.courierId!);
  }

  async fail(orderId: string, dto: FailDto, actor: ActorContext) {
    const o = await this.mine(orderId, actor.courierId!);
    this.workflow.assertAllowed(o, 'FAILED_ATTEMPT', actor);
    if (dto.reason === 'OTHER' && !dto.note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Describe what happened', HttpStatus.BAD_REQUEST);
    if (dto.rescheduleDate) assertDayInRange(dto.rescheduleDate, { minOffset: 0, maxOffset: 7, field: 'rescheduleDate' });
    await this.workflow.transition(orderId, 'FAILED_ATTEMPT', actor, {
      lat: dto.lat, lng: dto.lng, note: dto.note ?? null,
      failure: { reason: dto.reason, photoUrl: dto.photoUrl ?? null, rescheduleDate: dto.rescheduleDate ?? null },
    });
    return this.stop(orderId, actor.courierId!);
  }

  async resendOtp(orderId: string, courierId: string) {
    const o = await this.mine(orderId, courierId);
    if (o.status !== 'OUT_FOR_DELIVERY' || !o.deliveryOtpRequired) throw new DomainError('OTP_NOT_APPLICABLE', 'This parcel does not need a delivery code right now', HttpStatus.CONFLICT);
    const r = await this.otp.issue(o.recipientPhone, 'DELIVERY', { orderId });
    return { sent: true, expiresInMinutes: r.expiresInMinutes, devCode: r.devCode };
  }

  /** The hero declares bringing a parcel back to the hub; hub staff confirm it with the inbound scan. */
  async returnToHub(orderId: string, dto: NoteDto, actor: ActorContext) {
    const o = await this.mine(orderId, actor.courierId!);
    if (!TO_HUB.includes(o.status)) throw new DomainError('INVALID_TRANSITION', `A ${o.status} parcel is not due back at the hub`, HttpStatus.CONFLICT, { from: o.status, to: 'RECEIVED_AT_HUB' });
    await this.db.transaction(async (tx) => {
      await this.workflow.addNote(tx, o, actor, { reason: 'HANDOVER_TO_HUB_DECLARED', note: dto.note ?? 'Hero is bringing the parcel back to the hub', lat: dto.lat, lng: dto.lng });
      await this.audit.record(auditPrincipal(actor), { action: 'order.return_to_hub', entity: 'Order', entityId: orderId }, null, tx);
    });
    return { ok: true, orderId, status: o.status, nextStep: 'Hand the parcel to the hub operator for the inbound scan' };
  }

  async startReturn(orderId: string, dto: NoteDto, actor: ActorContext) {
    await this.mine(orderId, actor.courierId!);
    await this.workflow.transition(orderId, 'RETURN_OUT', actor, { lat: dto.lat, lng: dto.lng, note: dto.note ?? 'Returning the parcel to the brand' });
    return this.stop(orderId, actor.courierId!);
  }

  async returned(orderId: string, dto: ReturnedDto, actor: ActorContext) {
    await this.mine(orderId, actor.courierId!);
    await this.workflow.transition(orderId, 'RETURNED', actor, {
      lat: dto.lat, lng: dto.lng,
      note: [dto.receivedBy && `Received by ${dto.receivedBy}`, dto.note].filter(Boolean).join(' — ') || 'Returned to the brand',
      delivery: { receivedBy: dto.receivedBy ?? null, podPhotoUrl: dto.photoUrl ?? null },
    });
    return this.stop(orderId, actor.courierId!);
  }
}
