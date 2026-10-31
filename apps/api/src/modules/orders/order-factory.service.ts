import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  DomainEvents, generateTrackingNumber, normalizeEgyptPhone, scoreCodRisk, type FeesPayer, type OrderSource, type OrderType,
  type PaymentMethod, type Quote, type QuoteInput, type ServiceLevel, type ZoneMatch,
} from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brandLocations, brands, orderEvents, orders } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import type { OrderCreatedEvent } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import type { ActorContext } from '../../common/actor';
import { cairoHour, cairoToday } from '../../db/helpers';
import { newId } from '../../db/columns';
import { NetworkService, ZONE_HINT, type ZoneInfo } from '../network/network.service';
import { PricingService, type BrandRateCard } from '../pricing/pricing.service';
import { CustomersService } from '../customers/customers.service';
import type { CreateOrderInput, CreatedOrderRef } from './orders.contract';
import { addDays, auditPrincipal, endOfCairoDay, isDay, isDuplicateOn, PostCommit, withTag } from './ops-kit';
import { MAX_COD_CENTS } from './orders.dto';

export type OrderRow = typeof orders.$inferSelect;
export type OrderInsert = typeof orders.$inferInsert;
type BrandRow = typeof brands.$inferSelect;
type LocationRow = typeof brandLocations.$inferSelect;

/** Everything needed to insert an order, computed without writing anything (also powers bulk validation). */
export interface PreparedOrder {
  input: CreateOrderInput;
  brand: BrandRow;
  location: LocationRow;
  zone: ZoneInfo;
  detection: ZoneMatch | null;
  phone: string;
  altPhone: string | null;
  rate: BrandRateCard;
  quoteInput: QuoteInput;
  quote: Quote;
  promisedBy: Date;
}

export const riskLevelOf = (score: number): 'LOW' | 'MEDIUM' | 'HIGH' => (score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW');

/** SLA promise: scheduled day → end of that day; SAME_DAY → end of today (Cairo); EXPRESS → +4h; otherwise the zone SLA. */
export function promiseFor(level: ServiceLevel, slaHours: number, scheduledDate: string | null | undefined, now = new Date()): Date {
  const today = cairoToday(now);
  if (scheduledDate && scheduledDate > today) return endOfCairoDay(scheduledDate);
  if (level === 'SAME_DAY') return endOfCairoDay(today);
  if (level === 'EXPRESS') return new Date(now.getTime() + 4 * 3_600_000);
  return new Date(now.getTime() + slaHours * 3_600_000);
}

const fieldError = (code: string, message: string, field: string, status: number = HttpStatus.UNPROCESSABLE_ENTITY, extra: Record<string, unknown> = {}) =>
  new DomainError(code, message, status, { field, ...extra });

/**
 * Builds and inserts orders. Shared by the REST create endpoint, bulk upload,
 * integrations (via ORDER_INTAKE), the exchange return-leg and the demo seed.
 */
@Injectable()
export class OrderFactoryService {
  private readonly log = new Logger('Orders');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
    private readonly network: NetworkService,
    private readonly pricing: PricingService,
    private readonly customers: CustomersService,
  ) {}

  // ------------------------------------------------------------------ prepare

  /** Validates the input and computes zone, fees and SLA. Read-only. */
  async prepare(input: CreateOrderInput, db: DbOrTx = this.db): Promise<PreparedOrder> {
    const [brand] = await db.select().from(brands).where(eq(brands.id, input.brandId)).limit(1);
    if (!brand) throw notFound('Brand', input.brandId);
    if (brand.status !== 'ACTIVE') {
      throw new DomainError('BRAND_INACTIVE', `Brand ${brand.code} is ${brand.status.toLowerCase()} and cannot create orders`, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const phone = normalizeEgyptPhone(input.recipient.phone);
    if (!phone) throw fieldError('INVALID_PHONE', 'Recipient phone is not a valid Egyptian mobile number', 'recipient.phone', HttpStatus.BAD_REQUEST);
    let altPhone: string | null = null;
    if (input.recipient.altPhone) {
      altPhone = normalizeEgyptPhone(input.recipient.altPhone);
      if (!altPhone) throw fieldError('INVALID_PHONE', 'Alternative phone is not a valid Egyptian mobile number', 'recipient.altPhone', HttpStatus.BAD_REQUEST);
      if (altPhone === phone) altPhone = null;
    }
    const name = input.recipient.name?.trim();
    if (!name || name.length < 2) throw fieldError('INVALID_RECIPIENT', 'Recipient name is required', 'recipient.name', HttpStatus.BAD_REQUEST);
    if (!input.address.line || input.address.line.trim().length < 5) throw fieldError('INVALID_ADDRESS', 'Address is too short', 'address.line', HttpStatus.BAD_REQUEST);

    const location = await this.pickupLocation(db, brand.id, input.pickupLocationId ?? null);
    const { zone, detection } = await this.resolveZone(input.address);

    const type: OrderType = input.type ?? 'DELIVERY';
    const paymentMethod: PaymentMethod = input.paymentMethod ?? 'COD';
    const cod = Math.round(input.codAmountCents ?? 0);
    if (!Number.isInteger(cod) || cod < 0 || cod > MAX_COD_CENTS) throw fieldError('INVALID_COD', 'COD amount is out of range', 'codAmountCents');
    if (paymentMethod === 'PREPAID' && cod > 0) throw fieldError('INVALID_COD', 'Prepaid orders cannot have a COD amount', 'codAmountCents');
    if (type === 'CASH_COLLECTION' && cod <= 0) throw fieldError('INVALID_COD', 'Cash collection orders need an amount to collect', 'codAmountCents');

    const serviceLevel: ServiceLevel = input.serviceLevel ?? (input.scheduledDate ? 'SCHEDULED' : 'STANDARD');
    if (input.scheduledDate) {
      const today = cairoToday();
      if (!isDay(input.scheduledDate) || input.scheduledDate < today || input.scheduledDate > addDays(today, 30)) {
        throw fieldError('INVALID_DATE', `scheduledDate must be between ${today} and ${addDays(today, 30)}`, 'scheduledDate');
      }
    } else if (serviceLevel === 'SCHEDULED') {
      throw fieldError('INVALID_DATE', 'Scheduled orders need a scheduledDate', 'scheduledDate');
    }

    const feesPaidBy: FeesPayer = input.feesPaidBy ?? brand.defaultFeesPaidBy;
    const weightGrams = input.package?.weightGrams ?? 1000;
    const rate = await this.pricing.rateCardForBrand(brand.id, db);
    const quoteInput: QuoteInput = {
      tier: zone.tier,
      serviceLevel,
      type,
      weightGrams,
      paymentMethod,
      codAmountCents: cod,
      declaredValueCents: input.package?.declaredValueCents ?? 0,
      feesPaidBy,
    };
    const quote = this.pricing.computeQuote(rate.card, quoteInput);
    return {
      input,
      brand,
      location,
      zone,
      detection,
      phone,
      altPhone,
      rate,
      quoteInput,
      quote,
      promisedBy: promiseFor(serviceLevel, zone.slaHours, input.scheduledDate),
    };
  }

  private async pickupLocation(db: DbOrTx, brandId: string, locationId: string | null): Promise<LocationRow> {
    if (locationId) {
      const [loc] = await db.select().from(brandLocations).where(eq(brandLocations.id, locationId)).limit(1);
      if (!loc || loc.brandId !== brandId || !loc.isActive) {
        throw fieldError('INVALID_PICKUP_LOCATION', 'Pickup location does not belong to this brand or is inactive', 'pickupLocationId');
      }
      return loc;
    }
    const [loc] = await db
      .select()
      .from(brandLocations)
      .where(and(eq(brandLocations.brandId, brandId), eq(brandLocations.isActive, true)))
      .orderBy(desc(brandLocations.isDefault), asc(brandLocations.createdAt))
      .limit(1);
    if (!loc) throw fieldError('NO_PICKUP_LOCATION', 'Add a pickup location for this brand first', 'pickupLocationId');
    return loc;
  }

  async resolveZone(address: { line: string; zoneId?: string | null; lat?: number | null; lng?: number | null }): Promise<{ zone: ZoneInfo; detection: ZoneMatch | null }> {
    let zone: ZoneInfo | null;
    let detection: ZoneMatch | null = null;
    if (address.zoneId) {
      zone = await this.network.zoneById(address.zoneId);
      if (!zone) throw fieldError('INVALID_ZONE', 'Unknown zone', 'address.zoneId');
    } else {
      const point = address.lat != null && address.lng != null ? { lat: address.lat, lng: address.lng } : null;
      const res = await this.network.detect(address.line, point);
      if (!res.match) {
        throw new DomainError('ZONE_NOT_DETECTED', 'We could not detect the delivery zone for this address', HttpStatus.UNPROCESSABLE_ENTITY, { field: 'address.line', hint: ZONE_HINT });
      }
      detection = res.match;
      zone = await this.network.zoneById(res.match.zoneId);
    }
    if (!zone!.isActive) throw fieldError('ZONE_INACTIVE', `Zone ${zone!.code} is not serviceable at the moment`, 'address.zoneId');
    return { zone: zone!, detection };
  }

  // ------------------------------------------------------------------ create

  /** Validates, prices and inserts one order; emits order.created after commit. */
  async create(input: CreateOrderInput, actor: ActorContext): Promise<CreatedOrderRef> {
    const prepared = await this.prepare(input);
    if (input.brandReference) await this.assertReferenceFree(prepared.brand.id, input.brandReference);
    for (let attempt = 1; ; attempt++) {
      const fx = new PostCommit();
      try {
        const row = await this.db.transaction((tx) => this.insertPrepared(tx, fx, prepared, actor));
        fx.flush(this.events, this.log);
        return { id: row.id, trackingNumber: row.trackingNumber, status: row.status, totalFeesCents: row.totalFeesCents, collectCents: row.collectCents, riskScore: row.riskScore };
      } catch (err) {
        if (isDuplicateOn(err, 'orders_brand_ref_uq')) throw duplicateReference(input.brandReference ?? '');
        // Two parallel requests drew the same tracking number: draw again.
        if (isDuplicateOn(err, 'tracking') && attempt < 4) continue;
        throw err;
      }
    }
  }

  async assertReferenceFree(brandId: string, reference: string, db: DbOrTx = this.db) {
    const [dup] = await db
      .select({ id: orders.id, trackingNumber: orders.trackingNumber })
      .from(orders)
      .where(and(eq(orders.brandId, brandId), eq(orders.brandReference, reference)))
      .limit(1);
    if (dup) throw duplicateReference(reference, dup);
  }

  /** Inserts a prepared order inside the caller's transaction. */
  async insertPrepared(tx: DbOrTx, fx: PostCommit, p: PreparedOrder, actor: ActorContext): Promise<OrderRow> {
    const { input, quote: q } = p;
    const { row: customer } = await this.customers.upsertForOrder(tx, { phone: p.phone, name: input.recipient.name.trim(), altPhone: p.altPhone });
    const risk = scoreCodRisk({
      codAmountCents: p.quoteInput.paymentMethod === 'COD' ? p.quoteInput.codAmountCents : 0,
      customerTotalOrders: customer.totalOrders,
      customerDelivered: customer.deliveredOrders,
      customerRefused: customer.refusedOrders,
      isBlocked: customer.isBlocked,
      isFirstOrder: customer.totalOrders === 0,
      addressLength: input.address.line.trim().length,
      hasCoordinates: input.address.lat != null && input.address.lng != null,
      zoneTier: p.zone.tier,
      createdHour: cairoHour(),
    });
    let tags = [...new Set(input.tags ?? [])];
    if (risk.level === 'HIGH') tags = withTag(tags, 'HIGH_RISK');
    if (customer.isBlocked) tags = withTag(tags, 'CUSTOMER_BLOCKED');

    const values: OrderInsert = {
      id: newId(),
      trackingNumber: await this.freshTrackingNumber(tx),
      brandId: p.brand.id,
      brandReference: input.brandReference?.trim() || null,
      type: p.quoteInput.type,
      serviceLevel: p.quoteInput.serviceLevel,
      status: 'CREATED',
      source: input.source,
      customerId: customer.id,
      recipientName: input.recipient.name.trim().slice(0, 150),
      recipientPhone: p.phone,
      recipientAltPhone: p.altPhone,
      addressLine: input.address.line.trim().slice(0, 500),
      building: input.address.building?.trim() || null,
      floor: input.address.floor?.trim() || null,
      apartment: input.address.apartment?.trim() || null,
      landmark: input.address.landmark?.trim() || null,
      zoneId: p.zone.id,
      lat: input.address.lat ?? null,
      lng: input.address.lng ?? null,
      pickupLocationId: p.location.id,
      hubId: p.zone.hubId,
      packageDescription: input.package?.description?.trim() || null,
      itemsCount: input.package?.itemsCount ?? 1,
      weightGrams: p.quoteInput.weightGrams,
      isFragile: input.package?.isFragile ?? false,
      allowOpening: input.package?.allowOpening ?? p.brand.allowOpenPackage,
      declaredValueCents: p.quoteInput.declaredValueCents ?? 0,
      paymentMethod: p.quoteInput.paymentMethod,
      codAmountCents: p.quoteInput.codAmountCents,
      collectCents: q.collectFromRecipientCents,
      feesPaidBy: p.quoteInput.feesPaidBy ?? 'BRAND',
      shippingFeeCents: q.shippingFeeCents,
      codFeeCents: q.codFeeCents,
      extraFeesCents: q.extraFeesCents,
      vatCents: q.vatCents,
      totalFeesCents: q.totalFeesCents,
      riskScore: risk.score,
      scheduledDate: input.scheduledDate ?? null,
      promisedBy: p.promisedBy,
      deliveryOtpRequired: input.deliveryOtpRequired ?? false,
      notes: input.notes?.trim() || null,
      tags: tags.length ? tags : null,
      externalId: input.externalId ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        risk: { level: risk.level, factors: risk.factors },
        pricing: { planId: p.rate.plan.id, planName: p.rate.plan.name, breakdown: q.breakdown, netToBrandCents: q.netToBrandCents },
        ...(p.detection ? { zoneDetection: { method: p.detection.method, confidence: p.detection.confidence, matched: p.detection.matched ?? null } } : {}),
      },
      createdById: actor.actorId,
    };
    await tx.insert(orders).values(values);
    await tx.insert(orderEvents).values({
      orderId: values.id!,
      status: 'CREATED',
      fromStatus: null,
      actorId: actor.actorId,
      actorType: actor.actorType,
      actorName: actor.name,
      isPublic: true,
      metadata: { source: input.source },
    });
    if (actor.actorType !== 'SYSTEM') {
      await this.audit.record(
        auditPrincipal(actor),
        { action: 'order.create', entity: 'Order', entityId: values.id, after: { trackingNumber: values.trackingNumber, brandId: values.brandId, codAmountCents: values.codAmountCents, totalFeesCents: values.totalFeesCents } },
        null,
        tx,
      );
    }
    fx.emit(DomainEvents.OrderCreated, { orderId: values.id!, trackingNumber: values.trackingNumber, brandId: values.brandId, source: input.source } satisfies OrderCreatedEvent);
    const [row] = await tx.select().from(orders).where(eq(orders.id, values.id!)).limit(1);
    return row;
  }

  /**
   * Exchange delivered: the hero is now carrying the customer's old item back.
   * Creates the RETURN leg (customer → brand pickup location) as a child order
   * with no fees (the exchange fee was charged on the parent). The caller moves it to PICKED_UP.
   */
  async insertReturnLeg(tx: DbOrTx, fx: PostCommit, parent: OrderRow, actor: ActorContext): Promise<OrderRow> {
    let loc: LocationRow | undefined;
    if (parent.pickupLocationId) [loc] = await tx.select().from(brandLocations).where(eq(brandLocations.id, parent.pickupLocationId)).limit(1);
    if (!loc) loc = await this.pickupLocation(tx, parent.brandId, null);
    const zone = await this.network.zoneById(loc.zoneId);
    const id = newId();
    const values: OrderInsert = {
      id,
      trackingNumber: await this.freshTrackingNumber(tx),
      brandId: parent.brandId,
      brandReference: null,
      type: 'RETURN',
      serviceLevel: 'STANDARD',
      status: 'CREATED',
      source: parent.source,
      customerId: parent.customerId,
      recipientName: loc.contactName,
      recipientPhone: normalizeEgyptPhone(loc.phone) ?? loc.phone,
      addressLine: loc.addressLine,
      zoneId: loc.zoneId,
      lat: loc.lat,
      lng: loc.lng,
      pickupLocationId: loc.id,
      hubId: zone?.hubId ?? parent.hubId,
      packageDescription: `Exchange return of ${parent.trackingNumber}${parent.packageDescription ? ` — ${parent.packageDescription}` : ''}`.slice(0, 500),
      itemsCount: parent.itemsCount,
      weightGrams: parent.weightGrams,
      isFragile: parent.isFragile,
      paymentMethod: 'PREPAID',
      codAmountCents: 0,
      collectCents: 0,
      feesPaidBy: 'BRAND',
      promisedBy: new Date(Date.now() + (zone?.slaHours ?? 24) * 3_600_000),
      parentOrderId: parent.id,
      notes: `Return the customer's item to ${loc.name}`,
      metadata: {
        returnLegOf: parent.id,
        collectedFrom: { name: parent.recipientName, phone: parent.recipientPhone, address: parent.addressLine, zoneId: parent.zoneId },
      },
      createdById: actor.actorId,
    };
    await tx.insert(orders).values(values);
    await tx.insert(orderEvents).values({
      orderId: id,
      status: 'CREATED',
      actorId: actor.actorId,
      actorType: 'SYSTEM',
      actorName: 'GoTurtle',
      isPublic: false,
      note: `Return leg created for exchange ${parent.trackingNumber}`,
      metadata: { parentOrderId: parent.id },
    });
    fx.emit(DomainEvents.OrderCreated, { orderId: id, trackingNumber: values.trackingNumber, brandId: parent.brandId, source: parent.source } satisfies OrderCreatedEvent);
    const [row] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
    return row;
  }

  private async freshTrackingNumber(tx: DbOrTx): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const tn = generateTrackingNumber();
      const [hit] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.trackingNumber, tn)).limit(1);
      if (!hit) return tn;
    }
    throw new DomainError('RETRY', 'Could not allocate a tracking number, please retry', HttpStatus.SERVICE_UNAVAILABLE);
  }

  /** Source for an order created over HTTP by this actor. */
  static sourceFor(actor: ActorContext): OrderSource {
    if (actor.actorType === 'API') return 'API';
    if (actor.actorType === 'STAFF') return 'ADMIN';
    return 'PORTAL';
  }
}

function duplicateReference(reference: string, existing?: { id: string; trackingNumber: string }) {
  return new DomainError('DUPLICATE_REFERENCE', `An order with reference "${reference}" already exists for this brand`, HttpStatus.CONFLICT, existing ? { orderId: existing.id, trackingNumber: existing.trackingNumber } : undefined);
}
