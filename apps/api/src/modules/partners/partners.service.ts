import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { OrderStatus } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import {
  brands, carrierPartners, cashHandovers, cities, courierZones, couriers, governorates, ledgerAccounts, orders, users, zones,
} from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { JobsService } from '../../core/jobs.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { decryptJson, encryptJson, randomToken } from '../../common/crypto';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { actorFromPrincipal, type ActorContext } from '../../common/actor';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { likeEscape } from '../../db/helpers';
import { newId } from '../../db/columns';
import { SettingsService } from '../settings/settings.service';
import { OrderWorkflowService, type TransitionEffect } from '../orders/order-workflow.service';
import { adapterFor, partnerTrackingUrl, virtualCourierCode, virtualUserPhone, type PartnerShipmentRequest } from './partner-adapters';
import type {
  CreatePartnerDto, HandoffDto, HandoffQueueQuery, PartnerShipmentsQuery, PartnerStatusBatchDto, PartnerStatusUpdateDto, UpdatePartnerDto,
} from './partners.dto';

type PartnerRow = typeof carrierPartners.$inferSelect;
type CourierRow = typeof couriers.$inferSelect;

/** Encrypted per-partner configuration: API credentials and commercial terms. */
export interface PartnerConfig {
  fields: Record<string, string>;
  feeCents: number | null;
  returnFeeCents: number | null;
}

/** Statuses in which the parcel is with the partner. */
const WITH_PARTNER: OrderStatus[] = ['OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_PENDING'];
/** The virtual hero carries COD for months of parcels: effectively no cap. */
const PARTNER_CASH_LIMIT_CENTS = 1_000_000_000;

const BCRYPT_ROUNDS = 10;

/**
 * Partner carriers for destinations outside our own fleet. Each partner is a
 * virtual hero (courier PT-<CODE> with a disabled login) so every existing flow
 * works unchanged: assignment, OUT_FOR_DELIVERY → DELIVERED / FAILED_ATTEMPT,
 * COD in the hero custody ledger (= what the partner owes us), remittance via
 * cash handovers, and the partner's per-parcel fee posted as hero earnings
 * (payable to the partner). Hero rates are 0 so payroll never pays them as staff.
 */
@Injectable()
export class PartnersService implements OnModuleInit {
  private readonly log = new Logger('Partners');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly postings: PostingsService,
    private readonly settings: SettingsService,
    private readonly workflow: OrderWorkflowService,
  ) {}

  onModuleInit() {
    this.workflow.registerEffect('partners.fees', this.feeEffect);
    this.jobs.register({ name: 'partners.poll', everySeconds: 900, timeoutSeconds: 90, run: () => this.pollApiPartners() });
  }

  // ------------------------------------------------------------------ CRUD

  async list() {
    const rows = await this.db.select().from(carrierPartners).orderBy(asc(carrierPartners.code));
    return this.present(rows);
  }

  async get(id: string) {
    const [view] = await this.present([await this.load(id)]);
    return view;
  }

  async create(dto: CreatePartnerDto, principal: Principal, meta: RequestMetaInfo) {
    const code = dto.code.trim().toUpperCase();
    const [dup] = await this.db.select({ id: carrierPartners.id }).from(carrierPartners).where(eq(carrierPartners.code, code)).limit(1);
    if (dup) throw new DomainError('PARTNER_EXISTS', `A partner with code ${code} already exists`, HttpStatus.CONFLICT);
    const [courierDup] = await this.db.select({ id: couriers.id }).from(couriers).where(eq(couriers.code, virtualCourierCode(code))).limit(1);
    if (courierDup) throw new DomainError('PARTNER_EXISTS', `Hero code ${virtualCourierCode(code)} is already taken`, HttpStatus.CONFLICT);
    const config: PartnerConfig = { fields: cleanFields(dto.credentials ?? {}), feeCents: dto.feeCents ?? null, returnFeeCents: dto.returnFeeCents ?? null };
    const passwordHash = await bcrypt.hash(randomToken(32), BCRYPT_ROUNDS);
    const id = newId();
    await this.db.transaction(async (tx) => {
      await tx.insert(carrierPartners).values({
        id, code, name: dto.name.trim(), apiType: dto.apiType ?? 'MANUAL', credentials: encryptJson(config),
        trackingUrlTemplate: dto.trackingUrlTemplate?.trim() || null, governorateCodes: normalizeGovs(dto.governorateCodes), isActive: dto.isActive ?? true,
      });
      const userId = newId();
      // Disabled login: SUSPENDED, unusable identifier, random password — the partner never signs in as a hero.
      await tx.insert(users).values({ id: userId, name: partnerUserName(dto.name), phone: virtualUserPhone(code), passwordHash, role: 'COURIER', status: 'SUSPENDED', locale: 'ar' });
      await tx.insert(couriers).values({
        userId, code: virtualCourierCode(code), employmentType: 'FREELANCE', status: 'ACTIVE', availability: 'OFFLINE', vehicleType: 'VAN',
        perDeliveryRateCents: 0, perPickupRateCents: 0, failedAttemptRateCents: 0, hourlyRateCents: 0, monthlySalaryCents: 0,
        cashLimitCents: PARTNER_CASH_LIMIT_CENTS, maxActiveOrders: 100_000,
      });
      await this.audit.record(principal, { action: 'partner.create', entity: 'CarrierPartner', entityId: id, after: { code, name: dto.name, apiType: dto.apiType ?? 'MANUAL', feeCents: config.feeCents } }, meta, tx);
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdatePartnerDto, principal: Principal, meta: RequestMetaInfo) {
    const before = await this.load(id);
    const config = this.config(before);
    const patch: Partial<typeof carrierPartners.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.apiType !== undefined) patch.apiType = dto.apiType;
    if (dto.trackingUrlTemplate !== undefined) patch.trackingUrlTemplate = dto.trackingUrlTemplate?.trim() || null;
    if (dto.governorateCodes !== undefined) patch.governorateCodes = normalizeGovs(dto.governorateCodes);
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.feeCents !== undefined || dto.returnFeeCents !== undefined || dto.credentials !== undefined) {
      const next: PartnerConfig = {
        fields: dto.credentials !== undefined ? cleanFields({ ...config.fields, ...dto.credentials }) : config.fields,
        feeCents: dto.feeCents !== undefined ? dto.feeCents : config.feeCents,
        returnFeeCents: dto.returnFeeCents !== undefined ? dto.returnFeeCents : config.returnFeeCents,
      };
      patch.credentials = encryptJson(next);
    }
    await this.db.transaction(async (tx) => {
      if (Object.keys(patch).length) await tx.update(carrierPartners).set(patch).where(eq(carrierPartners.id, id));
      if (patch.name) {
        const vc = await this.virtualCourier(before.code, tx);
        await tx.update(users).set({ name: partnerUserName(patch.name) }).where(eq(users.id, vc.userId));
      }
      await this.audit.record(principal, {
        action: 'partner.update', entity: 'CarrierPartner', entityId: id,
        before: { name: before.name, isActive: before.isActive, feeCents: config.feeCents, governorateCodes: before.governorateCodes },
        after: { ...patch, credentials: dto.credentials ? '[updated]' : undefined, feeCents: dto.feeCents, returnFeeCents: dto.returnFeeCents },
      }, meta, tx);
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------ handoff

  /** Orders at the hub → the partner's virtual hero, OUT_FOR_DELIVERY, with the partner waybill. */
  async handoff(id: string, dto: HandoffDto, principal: Principal, meta: RequestMetaInfo) {
    const partner = await this.load(id);
    if (!partner.isActive) throw new DomainError('PARTNER_INACTIVE', `${partner.name} is not active`, HttpStatus.CONFLICT);
    const ids = dto.orderIds;
    if (new Set(ids).size !== ids.length) throw new DomainError('DUPLICATE_ORDERS', 'The same order is listed twice', HttpStatus.BAD_REQUEST);
    if (dto.partnerTrackingNumbers && dto.partnerTrackingNumbers.length !== ids.length) {
      throw new DomainError('TRACKING_NUMBERS_MISMATCH', 'Give one partner tracking number per order (empty when unknown)', HttpStatus.BAD_REQUEST);
    }
    const vc = await this.virtualCourier(partner.code);
    const rows = await this.db
      .select({ o: orders, govCode: governorates.code, cityEn: cities.nameEn })
      .from(orders)
      .innerJoin(zones, eq(zones.id, orders.zoneId))
      .innerJoin(cities, eq(cities.id, zones.cityId))
      .innerJoin(governorates, eq(governorates.id, cities.governorateId))
      .where(inArray(orders.id, ids));
    const byId = new Map(rows.map((r) => [r.o.id, r]));
    const missing = ids.filter((x) => !byId.has(x));
    if (missing.length) throw new DomainError('NOT_FOUND', 'Some orders do not exist', HttpStatus.NOT_FOUND, { orderIds: missing });
    const notAtHub = rows.filter((r) => r.o.status !== 'RECEIVED_AT_HUB');
    if (notAtHub.length) {
      throw new DomainError('ORDER_NOT_AT_HUB', 'Only parcels received at the hub can be handed to a partner', HttpStatus.CONFLICT, {
        orders: notAtHub.map((r) => ({ id: r.o.id, trackingNumber: r.o.trackingNumber, status: r.o.status })),
      });
    }
    const coverage = partner.governorateCodes ?? [];
    const outside = coverage.length ? rows.filter((r) => !coverage.includes(r.govCode)) : [];
    if (outside.length) {
      throw new DomainError('PARTNER_NOT_COVERING', `${partner.name} does not cover some destinations`, HttpStatus.UNPROCESSABLE_ENTITY, {
        orders: outside.map((r) => ({ id: r.o.id, trackingNumber: r.o.trackingNumber, governorate: r.govCode })),
      });
    }

    const requests: PartnerShipmentRequest[] = ids.map((orderId, i) => {
      const { o, govCode, cityEn } = byId.get(orderId)!;
      return {
        orderId, trackingNumber: o.trackingNumber,
        recipient: { name: o.recipientName, phone: o.recipientPhone, altPhone: o.recipientAltPhone },
        address: { line: o.addressLine, building: o.building, floor: o.floor, apartment: o.apartment, landmark: o.landmark, governorateCode: govCode, cityName: cityEn, lat: o.lat, lng: o.lng },
        codAmountCents: o.collectCents, weightGrams: o.actualWeightGrams ?? o.weightGrams, itemsCount: o.itemsCount, description: o.packageDescription, allowOpening: o.allowOpening,
        partnerTrackingNumber: dto.partnerTrackingNumbers?.[i]?.trim() || null,
      };
    });
    // External booking happens before the transaction (no row locks held while waiting on the partner).
    const booked = await adapterFor(partner.apiType).createShipments(requests, this.config(partner).fields);
    const waybill = new Map(booked.map((b) => [b.orderId, b.partnerTrackingNumber]));
    const actor = actorFromPrincipal(principal);
    const now = new Date();
    await this.workflow.run(async (tx, fx) => {
      for (const orderId of [...ids].sort()) {
        const order = await this.workflow.lock(tx, orderId);
        if (order.status !== 'RECEIVED_AT_HUB') {
          throw new DomainError('ORDER_NOT_AT_HUB', `${order.trackingNumber} is ${order.status}`, HttpStatus.CONFLICT, { orders: [{ id: orderId, trackingNumber: order.trackingNumber, status: order.status }] });
        }
        const tn = waybill.get(orderId) ?? null;
        await tx.update(orders).set({ partnerCarrierId: partner.id, partnerTrackingNumber: tn, handedToPartnerAt: now }).where(eq(orders.id, orderId));
        await this.workflow.apply(tx, fx, orderId, 'OUT_FOR_DELIVERY', actor, {
          courierId: vc.id,
          runsheetId: null,
          note: [`Handed to ${partner.name}${tn ? ` — tracking ${tn}` : ''}`, dto.note?.trim()].filter(Boolean).join('. '),
          metadata: { partner: { id: partner.id, code: partner.code, name: partner.name, trackingNumber: tn } },
          meta,
          at: now,
        });
      }
      await this.audit.record(principal, { action: 'partner.handoff', entity: 'CarrierPartner', entityId: partner.id, after: { orders: ids.length, orderIds: ids } }, meta, tx);
    });
    return {
      partner: { id: partner.id, code: partner.code, name: partner.name },
      handedOver: ids.length,
      orders: ids.map((orderId) => {
        const tn = waybill.get(orderId) ?? null;
        return { id: orderId, trackingNumber: byId.get(orderId)!.o.trackingNumber, partnerTrackingNumber: tn, partnerTrackingUrl: partnerTrackingUrl(partner.trackingUrlTemplate, tn) };
      }),
    };
  }

  /** Bulk outcomes reported by (or for) a partner. Each update is its own transaction; results are per line. */
  async updateStatuses(id: string, dto: PartnerStatusBatchDto, principal: Principal, meta: RequestMetaInfo) {
    const partner = await this.load(id);
    const vc = await this.virtualCourier(partner.code);
    const actor = actorFromPrincipal(principal);
    const results: Array<{ ok: boolean; orderId?: string; trackingNumber?: string; status?: OrderStatus; code?: string; message?: string }> = [];
    for (const u of dto.updates) {
      try {
        const order = await this.findShipment(partner, u);
        const status = await this.applyOutcome(partner, vc, order.id, u, actor, meta);
        results.push({ ok: true, orderId: order.id, trackingNumber: order.trackingNumber, status });
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        results.push({ ok: false, orderId: u.orderId, trackingNumber: u.trackingNumber ?? u.partnerTrackingNumber, code: err.code, message: err.message });
      }
    }
    await this.audit.record(principal, { action: 'partner.status', entity: 'CarrierPartner', entityId: partner.id, after: { updates: dto.updates.length, applied: results.filter((r) => r.ok).length } }, meta);
    return { applied: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  private async applyOutcome(partner: PartnerRow, vc: CourierRow, orderId: string, u: PartnerStatusUpdateDto, actor: ActorContext, meta: RequestMetaInfo): Promise<OrderStatus> {
    const ref = u.partnerReference?.trim();
    const note = [u.note?.trim(), ref ? `${partner.name} ref ${ref}` : null].filter(Boolean).join(' — ') || null;
    const metadata = { partner: { id: partner.id, code: partner.code, reference: ref ?? null } };
    return this.workflow.run(async (tx, fx) => {
      const order = await this.workflow.lock(tx, orderId);
      if (order.partnerCarrierId !== partner.id || order.courierId !== vc.id || !WITH_PARTNER.includes(order.status)) {
        throw new DomainError('NOT_WITH_PARTNER', `${order.trackingNumber} is not with ${partner.name} (${order.status})`, HttpStatus.CONFLICT, { status: order.status });
      }
      const backOut = async () => {
        if (order.status === 'FAILED_ATTEMPT' || order.status === 'RESCHEDULED') {
          await this.workflow.apply(tx, fx, orderId, 'OUT_FOR_DELIVERY', actor, { courierId: vc.id, note: `New attempt by ${partner.name}`, metadata, meta, isPublic: false });
        }
      };
      if (u.outcome === 'DELIVERED') {
        if (order.status === 'RETURN_PENDING') throw new DomainError('INVALID_TRANSITION', `${order.trackingNumber} is already being returned`, HttpStatus.CONFLICT, { from: order.status, to: 'DELIVERED' });
        await backOut();
        const done = await this.workflow.apply(tx, fx, orderId, 'DELIVERED', actor, {
          delivery: { collectedCents: u.collectedCents ?? order.collectCents, receivedBy: null }, note: note ?? `Delivered by ${partner.name}`, metadata, meta,
        });
        return done.status;
      }
      if (u.outcome === 'FAILED') {
        if (order.status === 'RETURN_PENDING') throw new DomainError('INVALID_TRANSITION', `${order.trackingNumber} is already being returned`, HttpStatus.CONFLICT, { from: order.status, to: 'FAILED_ATTEMPT' });
        await backOut();
        const failed = await this.workflow.apply(tx, fx, orderId, 'FAILED_ATTEMPT', actor, { failure: { reason: u.reason ?? 'CUSTOMER_UNREACHABLE' }, note, metadata, meta });
        return failed.status;
      }
      // RETURNED: the partner brought the parcel back to our hub → return it to the brand.
      await this.workflow.apply(tx, fx, orderId, 'RECEIVED_AT_HUB', actor, { hubId: order.hubId, note: note ?? `Returned to the hub by ${partner.name}`, metadata, meta, isPublic: false });
      const back = await this.workflow.apply(tx, fx, orderId, 'RETURN_PENDING', actor, { reason: u.reason ?? 'PARTNER_RETURNED', note: `${partner.name} could not deliver — returning to the brand`, metadata, meta });
      return back.status;
    });
  }

  private async findShipment(partner: PartnerRow, u: PartnerStatusUpdateDto) {
    const by: SQL | undefined = u.orderId
      ? eq(orders.id, u.orderId)
      : u.trackingNumber
        ? eq(orders.trackingNumber, u.trackingNumber.trim().toUpperCase())
        : u.partnerTrackingNumber
          ? eq(orders.partnerTrackingNumber, u.partnerTrackingNumber.trim())
          : undefined;
    if (!by) throw new DomainError('ORDER_REQUIRED', 'Give orderId, trackingNumber or partnerTrackingNumber', HttpStatus.BAD_REQUEST);
    const [o] = await this.db.select({ id: orders.id, trackingNumber: orders.trackingNumber }).from(orders).where(and(by, eq(orders.partnerCarrierId, partner.id))).limit(1);
    if (!o) throw notFound('Partner shipment', u.orderId ?? u.trackingNumber ?? u.partnerTrackingNumber);
    return o;
  }

  /** Partner fees as hero earnings of the virtual courier (Dr 5000 Hero pay / Cr 2200 payable to the partner). */
  private readonly feeEffect: TransitionEffect = async ({ tx, order, to, updated }) => {
    if (!order.partnerCarrierId) return;
    const delivered = to === 'DELIVERED';
    const broughtBack = to === 'RECEIVED_AT_HUB' && !!order.courierId;
    if (!delivered && !broughtBack) return;
    const [partner] = await tx.select().from(carrierPartners).where(eq(carrierPartners.id, order.partnerCarrierId)).limit(1);
    if (!partner) return;
    const [vc] = await tx.select({ id: couriers.id }).from(couriers).where(eq(couriers.code, virtualCourierCode(partner.code))).limit(1);
    if (!vc) return;
    const config = this.config(partner);
    if (delivered && updated.courierId === vc.id) {
      const fee = config.feeCents ?? (await this.settings.get('platform')).partnerFeeCents;
      if (fee > 0) await this.postings.courierEarning(tx, vc.id, fee, `order:${order.id}:earning:partner`, `${partner.name} delivery fee ${order.trackingNumber}`, order.id);
    }
    if (broughtBack && order.courierId === vc.id && (config.returnFeeCents ?? 0) > 0) {
      await this.postings.courierEarning(tx, vc.id, config.returnFeeCents!, `order:${order.id}:earning:partner_return`, `${partner.name} return fee ${order.trackingNumber}`, order.id);
    }
  };

  // ------------------------------------------------------------------ reads

  /** Orders at the hub, flagged when no active hero covers their zone, with the partners that cover the governorate. */
  async handoffQueue(q: HandoffQueueQuery) {
    const served = await this.servedZoneIds();
    const unservedOnly = q.unservedOnly !== 'false';
    const conds: Array<SQL | undefined> = [
      eq(orders.status, 'RECEIVED_AT_HUB'),
      unservedOnly && served.length ? notInArray(orders.zoneId, served) : undefined,
      q.hubId ? eq(orders.hubId, q.hubId) : undefined,
      q.governorate ? eq(governorates.code, q.governorate.toUpperCase()) : undefined,
      q.q ? or(eq(orders.trackingNumber, q.q.trim().toUpperCase()), like(orders.recipientName, `%${likeEscape(q.q)}%`)) : undefined,
    ];
    const where = and(...conds);
    const base = () =>
      this.db
        .select({
          id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, brandName: brands.name, recipientName: orders.recipientName,
          collectCents: orders.collectCents, weightGrams: orders.weightGrams, createdAt: orders.createdAt, promisedBy: orders.promisedBy, zoneId: orders.zoneId,
          zoneCode: zones.code, zoneEn: zones.nameEn, zoneAr: zones.nameAr, cityEn: cities.nameEn, cityAr: cities.nameAr,
          govCode: governorates.code, govEn: governorates.nameEn, govAr: governorates.nameAr,
        })
        .from(orders)
        .innerJoin(brands, eq(brands.id, orders.brandId))
        .innerJoin(zones, eq(zones.id, orders.zoneId))
        .innerJoin(cities, eq(cities.id, zones.cityId))
        .innerJoin(governorates, eq(governorates.id, cities.governorateId));
    const [rows, [{ n }], partners] = await Promise.all([
      base().where(where).orderBy(asc(orders.promisedBy), asc(orders.createdAt)).limit(q.pageSize).offset(offsetOf(q)),
      this.db
        .select({ n: count() })
        .from(orders)
        .innerJoin(zones, eq(zones.id, orders.zoneId))
        .innerJoin(cities, eq(cities.id, zones.cityId))
        .innerJoin(governorates, eq(governorates.id, cities.governorateId))
        .where(where),
      this.db.select().from(carrierPartners).where(eq(carrierPartners.isActive, true)).orderBy(asc(carrierPartners.code)),
    ]);
    const servedSet = new Set(served);
    return paginate(
      rows.map((r) => ({
        id: r.id, trackingNumber: r.trackingNumber, status: r.status, brandName: r.brandName, recipientName: r.recipientName,
        collectCents: r.collectCents, weightGrams: r.weightGrams, createdAt: r.createdAt, promisedBy: r.promisedBy,
        zone: { id: r.zoneId, code: r.zoneCode, nameEn: r.zoneEn, nameAr: r.zoneAr },
        city: { nameEn: r.cityEn, nameAr: r.cityAr },
        governorate: { code: r.govCode, nameEn: r.govEn, nameAr: r.govAr },
        servedByHeroes: servedSet.has(r.zoneId),
        suggestedPartners: partners.filter((p) => !(p.governorateCodes ?? []).length || (p.governorateCodes ?? []).includes(r.govCode)).map((p) => ({ id: p.id, code: p.code, name: p.name })),
      })),
      Number(n),
      q,
    );
  }

  async shipments(id: string, q: PartnerShipmentsQuery) {
    const partner = await this.load(id);
    const vc = await this.virtualCourier(partner.code);
    const state = q.state ?? 'active';
    const conds: Array<SQL | undefined> = [
      eq(orders.partnerCarrierId, partner.id),
      state === 'active' ? and(eq(orders.courierId, vc.id), inArray(orders.status, WITH_PARTNER)) : undefined,
      state === 'delivered' ? and(eq(orders.courierId, vc.id), eq(orders.status, 'DELIVERED')) : undefined,
      state === 'returned' ? or(isNull(orders.courierId), ne(orders.courierId, vc.id)) : undefined,
      q.q ? or(eq(orders.trackingNumber, q.q.trim().toUpperCase()), eq(orders.partnerTrackingNumber, q.q.trim()), like(orders.recipientName, `%${likeEscape(q.q)}%`)) : undefined,
    ];
    const where = and(...conds);
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({
          id: orders.id, trackingNumber: orders.trackingNumber, partnerTrackingNumber: orders.partnerTrackingNumber, status: orders.status, courierId: orders.courierId,
          recipientName: orders.recipientName, brandName: brands.name, collectCents: orders.collectCents, collectedCents: orders.collectedCents, attempts: orders.attempts,
          handedToPartnerAt: orders.handedToPartnerAt, deliveredAt: orders.deliveredAt, cashHandoverId: orders.cashHandoverId,
          zoneEn: zones.nameEn, zoneAr: zones.nameAr, govCode: governorates.code, govEn: governorates.nameEn, govAr: governorates.nameAr,
        })
        .from(orders)
        .innerJoin(brands, eq(brands.id, orders.brandId))
        .innerJoin(zones, eq(zones.id, orders.zoneId))
        .innerJoin(cities, eq(cities.id, zones.cityId))
        .innerJoin(governorates, eq(governorates.id, cities.governorateId))
        .where(where)
        .orderBy(desc(orders.handedToPartnerAt), desc(orders.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(orders).where(where),
    ]);
    return paginate(
      rows.map((r) => ({
        id: r.id, trackingNumber: r.trackingNumber, partnerTrackingNumber: r.partnerTrackingNumber,
        partnerTrackingUrl: partnerTrackingUrl(partner.trackingUrlTemplate, r.partnerTrackingNumber),
        status: r.status, withPartner: r.courierId === vc.id, recipientName: r.recipientName, brandName: r.brandName,
        collectCents: r.collectCents, collectedCents: r.collectedCents, attempts: r.attempts, remitted: !!r.cashHandoverId,
        handedToPartnerAt: r.handedToPartnerAt, deliveredAt: r.deliveredAt,
        zone: { nameEn: r.zoneEn, nameAr: r.zoneAr }, governorate: { code: r.govCode, nameEn: r.govEn, nameAr: r.govAr },
      })),
      Number(n),
      q,
    );
  }

  /** What the partner owes us (COD custody) and what we owe them (fees), with recent remittances. */
  async custody(id: string) {
    const partner = await this.load(id);
    const vc = await this.virtualCourier(partner.code);
    const [[payable], [pending], [unremitted], handovers] = await Promise.all([
      this.db.select({ b: ledgerAccounts.balanceCents }).from(ledgerAccounts).where(eq(ledgerAccounts.code, `2200:HERO:${vc.id}`)).limit(1),
      this.db
        .select({ s: sql<number>`coalesce(sum(${cashHandovers.declaredCents}), 0)`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
        .from(cashHandovers)
        .where(and(eq(cashHandovers.courierId, vc.id), eq(cashHandovers.status, 'PENDING'))),
      this.db
        .select({ s: sql<number>`coalesce(sum(${orders.collectedCents}), 0)`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
        .from(orders)
        .where(and(eq(orders.courierId, vc.id), eq(orders.status, 'DELIVERED'), sql`${orders.collectedCents} > 0`, isNull(orders.cashHandoverId))),
      this.db.select().from(cashHandovers).where(eq(cashHandovers.courierId, vc.id)).orderBy(desc(cashHandovers.createdAt)).limit(10),
    ]);
    const [fresh] = await this.db.select({ cash: couriers.cashOnHandCents }).from(couriers).where(eq(couriers.id, vc.id)).limit(1);
    return {
      partner: { id: partner.id, code: partner.code, name: partner.name },
      courierId: vc.id,
      courierCode: vc.code,
      custodyCents: fresh?.cash ?? 0,
      feesPayableCents: payable?.b ?? 0,
      netOwedToUsCents: (fresh?.cash ?? 0) - (payable?.b ?? 0),
      pendingHandovers: { count: pending?.n ?? 0, declaredCents: pending?.s ?? 0 },
      unremittedOrders: { count: unremitted?.n ?? 0, collectedCents: unremitted?.s ?? 0 },
      recentHandovers: handovers.map((h) => ({ id: h.id, code: h.code, method: h.method, status: h.status, declaredCents: h.declaredCents, receivedCents: h.receivedCents, reference: h.reference, createdAt: h.createdAt, confirmedAt: h.confirmedAt })),
    };
  }

  // ------------------------------------------------------------------ helpers

  /** Zones with at least one active (non-partner) hero. */
  private async servedZoneIds(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ zoneId: courierZones.zoneId })
      .from(courierZones)
      .innerJoin(couriers, eq(couriers.id, courierZones.courierId))
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(and(eq(couriers.status, 'ACTIVE'), eq(users.status, 'ACTIVE'), sql`${couriers.code} not like 'PT-%'`));
    return rows.map((r) => r.zoneId);
  }

  private async present(rows: PartnerRow[]) {
    if (!rows.length) return [];
    const codes = rows.map((r) => virtualCourierCode(r.code));
    const vcs = await this.db.select({ id: couriers.id, code: couriers.code, cash: couriers.cashOnHandCents }).from(couriers).where(inArray(couriers.code, codes));
    const vcByCode = new Map(vcs.map((v) => [v.code, v]));
    const vcIds = vcs.map((v) => v.id);
    const [stats, payables, platform] = await Promise.all([
      vcIds.length
        ? this.db
            .select({
              partnerId: orders.partnerCarrierId,
              active: sql<number>`coalesce(sum(case when ${orders.status} in ('OUT_FOR_DELIVERY','FAILED_ATTEMPT','RESCHEDULED','RETURN_PENDING') and ${inArray(orders.courierId, vcIds)} then 1 else 0 end), 0)`.mapWith(Number),
              delivered: sql<number>`coalesce(sum(case when ${orders.status} = 'DELIVERED' and ${inArray(orders.courierId, vcIds)} then 1 else 0 end), 0)`.mapWith(Number),
              total: sql<number>`count(*)`.mapWith(Number),
            })
            .from(orders)
            .where(and(isNotNull(orders.partnerCarrierId), inArray(orders.partnerCarrierId, rows.map((r) => r.id))))
            .groupBy(orders.partnerCarrierId)
        : Promise.resolve([]),
      vcIds.length ? this.db.select({ courierId: ledgerAccounts.courierId, b: ledgerAccounts.balanceCents }).from(ledgerAccounts).where(and(inArray(ledgerAccounts.courierId, vcIds), like(ledgerAccounts.code, '2200:HERO:%'))) : Promise.resolve([]),
      this.settings.get('platform'),
    ]);
    const statBy = new Map(stats.map((s) => [s.partnerId, s]));
    const payBy = new Map(payables.map((p) => [p.courierId, p.b]));
    return rows.map((r) => {
      const vc = vcByCode.get(virtualCourierCode(r.code));
      const config = this.config(r);
      const s = statBy.get(r.id);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        apiType: r.apiType,
        trackingUrlTemplate: r.trackingUrlTemplate,
        governorateCodes: r.governorateCodes ?? [],
        isActive: r.isActive,
        feeCents: config.feeCents,
        returnFeeCents: config.returnFeeCents,
        effectiveFeeCents: config.feeCents ?? platform.partnerFeeCents,
        credentialsSet: Object.fromEntries(Object.keys(config.fields).map((k) => [k, true])),
        courier: vc ? { id: vc.id, code: vc.code } : null,
        stats: { active: s?.active ?? 0, delivered: s?.delivered ?? 0, total: s?.total ?? 0 },
        custodyCents: vc?.cash ?? 0,
        feesPayableCents: (vc && payBy.get(vc.id)) ?? 0,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  }

  private config(p: PartnerRow): PartnerConfig {
    if (!p.credentials) return { fields: {}, feeCents: null, returnFeeCents: null };
    try {
      const c = decryptJson<Partial<PartnerConfig>>(p.credentials);
      return { fields: c.fields ?? {}, feeCents: c.feeCents ?? null, returnFeeCents: c.returnFeeCents ?? null };
    } catch {
      this.log.error(`config of partner ${p.code} cannot be decrypted (ENCRYPTION_KEY changed?)`);
      return { fields: {}, feeCents: null, returnFeeCents: null };
    }
  }

  private async load(id: string): Promise<PartnerRow> {
    const [p] = await this.db.select().from(carrierPartners).where(eq(carrierPartners.id, id)).limit(1);
    if (!p) throw notFound('Partner', id);
    return p;
  }

  private async virtualCourier(partnerCode: string, db: DbOrTx = this.db): Promise<CourierRow> {
    const [c] = await db.select().from(couriers).where(eq(couriers.code, virtualCourierCode(partnerCode))).limit(1);
    if (!c) throw new DomainError('PARTNER_MISCONFIGURED', `Virtual hero ${virtualCourierCode(partnerCode)} is missing`, HttpStatus.CONFLICT);
    return c;
  }

  /** API partners: pull status changes and apply them as the system. */
  private async pollApiPartners(): Promise<string> {
    const partners = (await this.db.select().from(carrierPartners).where(and(eq(carrierPartners.isActive, true), ne(carrierPartners.apiType, 'MANUAL')))).slice(0, 20);
    let applied = 0;
    for (const p of partners) {
      try {
        const vc = await this.virtualCourier(p.code);
        const open = await this.db
          .select({ id: orders.id, tn: orders.partnerTrackingNumber })
          .from(orders)
          .where(and(eq(orders.partnerCarrierId, p.id), eq(orders.courierId, vc.id), inArray(orders.status, WITH_PARTNER), isNotNull(orders.partnerTrackingNumber)))
          .limit(100);
        if (!open.length) continue;
        const reports = await adapterFor(p.apiType).pollStatuses(open.map((o) => o.tn!), this.config(p).fields);
        const system: ActorContext = { actorType: 'STAFF', actorId: null, name: `${p.name} (sync)` };
        for (const r of reports) {
          const order = open.find((o) => o.tn === r.partnerTrackingNumber);
          if (!order) continue;
          try {
            await this.applyOutcome(p, vc, order.id, { outcome: r.outcome, collectedCents: r.collectedCents, reason: r.reason as PartnerStatusUpdateDto['reason'], partnerReference: r.partnerReference }, system, { ip: null, userAgent: null });
            applied++;
          } catch (err) {
            this.log.warn(`${p.code} ${r.partnerTrackingNumber}: ${err instanceof Error ? err.message : err}`);
          }
        }
      } catch (err) {
        this.log.error(`poll ${p.code} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return `partners ${partners.length}, applied ${applied}`;
  }
}

const partnerUserName = (name: string) => `${name.trim()} (partner)`.slice(0, 120);

const normalizeGovs = (codes: string[] | undefined) => [...new Set((codes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean))];

function cleanFields(c: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(c)
      .filter(([k, v]) => /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k) && typeof v === 'string' && v.trim())
      .slice(0, 20)
      .map(([k, v]) => [k, (v as string).trim().slice(0, 1000)]),
  );
}
