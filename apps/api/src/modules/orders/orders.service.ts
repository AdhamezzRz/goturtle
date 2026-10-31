import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, like, lt, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import Papa from 'papaparse';
import {
  BRAND_CANCELLABLE_STATUSES, canTransition, centsToEgp, FailureReason, formatEgyptPhone, isTerminal, normalizeEgyptPhone,
  normalizeTrackingNumber, ORDER_STATUS_LABELS, ORDER_STATUS_TONE, OrderStatus, TERMINAL_STATUSES, type QuoteInput,
} from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import {
  brandLocations, brands, couriers, customers, deliveryAttempts, hubs, ledgerAccounts, ledgerEntries, ledgerTransactions, orderEvents, orders,
  pickups, runsheets, users, zones,
} from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { DomainError, notFound } from '../../common/errors';
import { actorFromPrincipal, type ActorContext } from '../../common/actor';
import { brandScope, isStaff, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { offsetOf, paginate } from '../../common/pagination';
import { cairoToday, groupBy, likeEscape, whereAll } from '../../db/helpers';
import { NetworkService } from '../network/network.service';
import { PricingService } from '../pricing/pricing.service';
import { CustomersService } from '../customers/customers.service';
import type { CreateOrderInput, CreatedOrderRef, OrderIntake } from './orders.contract';
import { OrderFactoryService, promiseFor, riskLevelOf, type OrderInsert, type OrderRow } from './order-factory.service';
import { OrderWorkflowService, type TransitionOptions } from './order-workflow.service';
import { addDays, auditPrincipal, isDay, parseBound } from './ops-kit';
import type { ChangeStatusDto, CreateOrderDto, OrderListQuery, UpdateOrderDto } from './orders.dto';

export const EXPORT_MAX_ROWS = 10_000;

const SORT_COLUMNS = {
  createdAt: orders.createdAt,
  updatedAt: orders.updatedAt,
  promisedBy: orders.promisedBy,
  deliveredAt: orders.deliveredAt,
  codAmountCents: orders.codAmountCents,
  collectCents: orders.collectCents,
  riskScore: orders.riskScore,
  status: orders.status,
  attempts: orders.attempts,
  priority: orders.priority,
} as const;

/** Columns returned by list endpoints (one row per order, joined labels). */
const LIST_COLUMNS = {
  id: orders.id,
  trackingNumber: orders.trackingNumber,
  brandReference: orders.brandReference,
  type: orders.type,
  serviceLevel: orders.serviceLevel,
  status: orders.status,
  source: orders.source,
  recipientName: orders.recipientName,
  recipientPhone: orders.recipientPhone,
  addressLine: orders.addressLine,
  landmark: orders.landmark,
  lat: orders.lat,
  lng: orders.lng,
  hubId: orders.hubId,
  pickupId: orders.pickupId,
  runsheetId: orders.runsheetId,
  routeSequence: orders.routeSequence,
  courierId: orders.courierId,
  parentOrderId: orders.parentOrderId,
  itemsCount: orders.itemsCount,
  weightGrams: orders.weightGrams,
  paymentMethod: orders.paymentMethod,
  codAmountCents: orders.codAmountCents,
  collectCents: orders.collectCents,
  collectedCents: orders.collectedCents,
  feesPaidBy: orders.feesPaidBy,
  totalFeesCents: orders.totalFeesCents,
  attempts: orders.attempts,
  maxAttempts: orders.maxAttempts,
  riskScore: orders.riskScore,
  priority: orders.priority,
  scheduledDate: orders.scheduledDate,
  promisedBy: orders.promisedBy,
  pickedUpAt: orders.pickedUpAt,
  outForDeliveryAt: orders.outForDeliveryAt,
  deliveredAt: orders.deliveredAt,
  returnedAt: orders.returnedAt,
  cancelledAt: orders.cancelledAt,
  deliveryOtpRequired: orders.deliveryOtpRequired,
  tags: orders.tags,
  createdAt: orders.createdAt,
  updatedAt: orders.updatedAt,
  brand: { id: brands.id, code: brands.code, name: brands.name },
  zone: { id: zones.id, code: zones.code, nameEn: zones.nameEn, nameAr: zones.nameAr },
  courierCode: couriers.code,
  courierName: users.name,
  hubCode: hubs.code,
};

type ListRow = Awaited<ReturnType<OrdersService['selectList']>>[number];

/** Status groups used by portal tabs. */
export const STATUS_GROUPS: Record<string, OrderStatus[]> = {
  new: ['CREATED', 'PICKUP_ASSIGNED', 'ON_HOLD'],
  inTransit: ['PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED'],
  delivered: ['DELIVERED'],
  returns: ['RETURN_PENDING', 'RETURN_OUT', 'RETURNED'],
  closed: ['CANCELLED', 'LOST', 'DAMAGED'],
};

/**
 * Orders: intake (ORDER_INTAKE), listing, detail, edits, cancellations,
 * staff status changes, labels and CSV export. Status changes are delegated
 * to OrderWorkflowService.
 */
@Injectable()
export class OrdersService implements OrderIntake {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly network: NetworkService,
    private readonly pricing: PricingService,
    private readonly customers: CustomersService,
    readonly factory: OrderFactoryService,
    readonly workflow: OrderWorkflowService,
  ) {}

  // ------------------------------------------------------------------ OrderIntake

  create(input: CreateOrderInput, actor: ActorContext): Promise<CreatedOrderRef> {
    return this.factory.create(input, actor);
  }

  async cancelByExternalId(brandId: string, externalId: string, actor: ActorContext, reason?: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.brandId, brandId), eq(orders.externalId, externalId)))
      .orderBy(desc(orders.createdAt))
      .limit(5);
    const target = rows.find((r) => BRAND_CANCELLABLE_STATUSES.includes(r.status));
    if (!target) return false;
    await this.workflow.transition(target.id, 'CANCELLED', { ...actor, brandId }, { reason: 'CANCELLED_BY_INTEGRATION', note: reason ?? null });
    return true;
  }

  // ------------------------------------------------------------------ create (HTTP)

  async createFromDto(dto: CreateOrderDto, p: Principal) {
    const actor = actorFromPrincipal(p);
    const brandId = this.targetBrand(p, dto.brandId);
    const ref = await this.factory.create(
      {
        brandId,
        brandReference: dto.brandReference ?? null,
        type: dto.type,
        serviceLevel: dto.serviceLevel,
        source: OrderFactoryService.sourceFor(actor),
        recipient: dto.recipient,
        address: dto.address,
        package: dto.package,
        paymentMethod: dto.paymentMethod,
        codAmountCents: dto.codAmountCents,
        feesPaidBy: dto.feesPaidBy,
        pickupLocationId: dto.pickupLocationId ?? null,
        scheduledDate: dto.scheduledDate ?? null,
        notes: dto.notes ?? null,
        deliveryOtpRequired: dto.deliveryOtpRequired,
        externalId: dto.externalId ?? null,
        tags: dto.tags,
      },
      actor,
    );
    return this.detail(ref.id, p);
  }

  /** Brand users / API keys → their brand; staff must name one. */
  targetBrand(p: Principal, requested?: string | null): string {
    const scope = brandScope(p);
    if (scope) return scope;
    if (!requested) throw new DomainError('BRAND_REQUIRED', 'brandId is required when staff create orders', HttpStatus.BAD_REQUEST);
    return requested;
  }

  // ------------------------------------------------------------------ list / counts

  filters(q: OrderListQuery, scope: string | null, opts: { ignoreStatus?: boolean } = {}): SQL | undefined {
    const conds: Array<SQL | undefined> = [];
    if (scope) conds.push(eq(orders.brandId, scope));
    else if (q.brandId) conds.push(eq(orders.brandId, q.brandId));
    if (!opts.ignoreStatus && q.status?.length) conds.push(inArray(orders.status, q.status));
    if (q.zoneId) conds.push(eq(orders.zoneId, q.zoneId));
    if (q.hubId) conds.push(eq(orders.hubId, q.hubId));
    if (q.courierId) conds.push(eq(orders.courierId, q.courierId));
    if (q.runsheetId) conds.push(eq(orders.runsheetId, q.runsheetId));
    if (q.pickupId) conds.push(eq(orders.pickupId, q.pickupId));
    if (q.customerId) conds.push(eq(orders.customerId, q.customerId));
    if (q.paymentMethod) conds.push(eq(orders.paymentMethod, q.paymentMethod));
    if (q.serviceLevel) conds.push(eq(orders.serviceLevel, q.serviceLevel));
    if (q.type) conds.push(eq(orders.type, q.type));
    if (q.source) conds.push(eq(orders.source, q.source));
    if (q.hasParent !== undefined) conds.push(q.hasParent ? isNotNull(orders.parentOrderId) : isNull(orders.parentOrderId));
    if (q.riskLevel === 'LOW') conds.push(lt(orders.riskScore, 30));
    if (q.riskLevel === 'MEDIUM') conds.push(and(gte(orders.riskScore, 30), lt(orders.riskScore, 60)));
    if (q.riskLevel === 'HIGH') conds.push(gte(orders.riskScore, 60));
    if (q.slaBreached) conds.push(and(lt(orders.promisedBy, new Date()), notInArray(orders.status, [...TERMINAL_STATUSES])));
    const dateCol = { createdAt: orders.createdAt, updatedAt: orders.updatedAt, deliveredAt: orders.deliveredAt, promisedBy: orders.promisedBy }[q.dateField ?? 'createdAt'];
    const from = parseBound(q.from, 'from');
    const to = parseBound(q.to, 'to');
    if (from) conds.push(gte(dateCol, from));
    if (to) conds.push(lte(dateCol, to));
    if (q.q?.trim()) conds.push(this.searchCondition(q.q.trim()));
    return whereAll(...conds);
  }

  private searchCondition(raw: string): SQL {
    const tn = normalizeTrackingNumber(raw);
    if (/^GT\d{4,10}$/.test(tn)) return like(orders.trackingNumber, `${likeEscape(tn)}%`);
    const phone = normalizeEgyptPhone(raw);
    if (phone) return or(eq(orders.recipientPhone, phone), eq(orders.recipientAltPhone, phone))!;
    const term = `%${likeEscape(raw)}%`;
    return or(like(orders.recipientName, term), like(orders.brandReference, term), like(orders.trackingNumber, term), like(orders.recipientPhone, term), like(orders.externalId, term))!;
  }

  selectList(db: DbOrTx = this.db) {
    return db
      .select(LIST_COLUMNS)
      .from(orders)
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .innerJoin(zones, eq(zones.id, orders.zoneId))
      .leftJoin(couriers, eq(couriers.id, orders.courierId))
      .leftJoin(users, eq(users.id, couriers.userId))
      .leftJoin(hubs, eq(hubs.id, orders.hubId))
      .$dynamic();
  }

  private presentListRow(r: ListRow, staff: boolean) {
    const { courierCode, courierName, hubCode, recipientPhone, ...rest } = r;
    return {
      ...rest,
      recipientPhone,
      statusLabel: ORDER_STATUS_LABELS[r.status],
      statusTone: ORDER_STATUS_TONE[r.status],
      riskLevel: riskLevelOf(r.riskScore),
      slaBreached: !!r.promisedBy && r.promisedBy.getTime() < Date.now() && !isTerminal(r.status),
      courier: r.courierId ? { id: r.courierId, code: courierCode, name: courierName } : null,
      hub: r.hubId ? { id: r.hubId, code: hubCode } : null,
      ...(staff ? {} : { tags: (r.tags ?? []).filter((t) => t !== 'CUSTOMER_BLOCKED') }),
    };
  }

  async list(q: OrderListQuery, p: Principal) {
    const scope = brandScope(p);
    const where = this.filters(q, scope);
    const col = SORT_COLUMNS[q.sort ?? 'createdAt'];
    const [rows, [{ n }]] = await Promise.all([
      this.selectList()
        .where(where)
        .orderBy(q.order === 'asc' ? asc(col) : desc(col), desc(orders.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(orders).where(where),
    ]);
    const staff = isStaff(p);
    return paginate(rows.map((r) => this.presentListRow(r, staff)), Number(n), q);
  }

  /** Per-status counts for portal tabs (all filters except status). */
  async counts(q: OrderListQuery, p: Principal) {
    const where = this.filters(q, brandScope(p), { ignoreStatus: true });
    const rows = await this.db.select({ status: orders.status, n: count() }).from(orders).where(where).groupBy(orders.status);
    const byStatus = Object.fromEntries(Object.values(OrderStatus).map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const r of rows) byStatus[r.status] = Number(r.n);
    const groups = Object.fromEntries(Object.entries(STATUS_GROUPS).map(([k, list]) => [k, list.reduce((s, st) => s + byStatus[st], 0)]));
    const [{ breached }] = await this.db
      .select({ breached: count() })
      .from(orders)
      .where(whereAll(where, lt(orders.promisedBy, new Date()), notInArray(orders.status, [...TERMINAL_STATUSES])));
    return { total: rows.reduce((s, r) => s + Number(r.n), 0), byStatus, groups, slaBreached: Number(breached) };
  }

  // ------------------------------------------------------------------ detail

  /** Loads an order the principal may see (other brands → 404). */
  async loadScoped(id: string, p: Principal, db: DbOrTx = this.db): Promise<OrderRow> {
    const scope = brandScope(p);
    const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!row || (scope && row.brandId !== scope)) throw notFound('Order', id);
    return row;
  }

  async detail(id: string, p: Principal) {
    const order = await this.loadScoped(id, p);
    const staff = isStaff(p);
    const [brand] = await this.db
      .select({ id: brands.id, code: brands.code, name: brands.name, logoUrl: brands.logoUrl, phone: brands.phone })
      .from(brands)
      .where(eq(brands.id, order.brandId))
      .limit(1);
    const zone = await this.network.zoneById(order.zoneId);
    const [hub] = order.hubId ? await this.db.select({ id: hubs.id, code: hubs.code, name: hubs.name, nameAr: hubs.nameAr, phone: hubs.phone }).from(hubs).where(eq(hubs.id, order.hubId)).limit(1) : [];
    const [location] = order.pickupLocationId
      ? await this.db
          .select({ id: brandLocations.id, name: brandLocations.name, addressLine: brandLocations.addressLine, contactName: brandLocations.contactName, phone: brandLocations.phone, zoneId: brandLocations.zoneId, lat: brandLocations.lat, lng: brandLocations.lng })
          .from(brandLocations)
          .where(eq(brandLocations.id, order.pickupLocationId))
          .limit(1)
      : [];
    const [pickup] = order.pickupId
      ? await this.db.select({ id: pickups.id, code: pickups.code, status: pickups.status, scheduledDate: pickups.scheduledDate, timeWindow: pickups.timeWindow }).from(pickups).where(eq(pickups.id, order.pickupId)).limit(1)
      : [];
    const [runsheet] = order.runsheetId
      ? await this.db.select({ id: runsheets.id, code: runsheets.code, status: runsheets.status, date: runsheets.date }).from(runsheets).where(eq(runsheets.id, order.runsheetId)).limit(1)
      : [];
    const [courier] = order.courierId
      ? await this.db
          .select({ id: couriers.id, code: couriers.code, name: users.name, phone: users.phone, vehicleType: couriers.vehicleType, rating: couriers.rating, avatarUrl: users.avatarUrl })
          .from(couriers)
          .innerJoin(users, eq(users.id, couriers.userId))
          .where(eq(couriers.id, order.courierId))
          .limit(1)
      : [];
    const events = await this.db.select().from(orderEvents).where(eq(orderEvents.orderId, id)).orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
    const attempts = await this.db
      .select({ attempt: deliveryAttempts, courierCode: couriers.code, courierName: users.name })
      .from(deliveryAttempts)
      .innerJoin(couriers, eq(couriers.id, deliveryAttempts.courierId))
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(eq(deliveryAttempts.orderId, id))
      .orderBy(asc(deliveryAttempts.attemptNo), asc(deliveryAttempts.createdAt));
    const related = await this.db
      .select({ id: orders.id, trackingNumber: orders.trackingNumber, type: orders.type, status: orders.status, createdAt: orders.createdAt })
      .from(orders)
      .where(or(eq(orders.parentOrderId, id), order.parentOrderId ? eq(orders.id, order.parentOrderId) : sql`false`));

    const { internalNotes, metadata, ...base } = order;
    const risk = (metadata as { risk?: unknown } | null)?.risk ?? null;
    const view = {
      ...base,
      statusLabel: ORDER_STATUS_LABELS[order.status],
      statusTone: ORDER_STATUS_TONE[order.status],
      riskLevel: riskLevelOf(order.riskScore),
      slaBreached: !!order.promisedBy && order.promisedBy.getTime() < Date.now() && !isTerminal(order.status),
      allowedTransitions: staff ? nextStatuses(order.status) : [],
      canEdit: staff ? !isTerminal(order.status) : BRAND_CANCELLABLE_STATUSES.includes(order.status),
      canCancel: staff ? canTransition(order.status, 'CANCELLED') : BRAND_CANCELLABLE_STATUSES.includes(order.status),
      brand: brand ?? null,
      zone: zone ? this.network.zoneSummary(zone) : null,
      hub: hub ?? null,
      pickupLocation: location ?? null,
      pickup: pickup ?? null,
      runsheet: runsheet ?? null,
      courier: courier ? { id: courier.id, code: courier.code, name: courier.name, vehicleType: courier.vehicleType, rating: courier.rating, avatarUrl: courier.avatarUrl, ...(staff ? { phone: courier.phone } : {}) } : null,
      parentOrder: related.find((r) => r.id === order.parentOrderId) ?? null,
      childOrders: related.filter((r) => r.id !== order.parentOrderId),
      timeline: events.map((e) => ({
        id: e.id,
        status: e.status,
        fromStatus: e.fromStatus,
        label: ORDER_STATUS_LABELS[e.status],
        isStatusChange: e.fromStatus !== e.status,
        reason: e.reason,
        note: e.note,
        actorType: e.actorType,
        actorName: e.actorName,
        hubId: e.hubId,
        lat: e.lat,
        lng: e.lng,
        isPublic: e.isPublic,
        createdAt: e.createdAt,
        ...(staff ? { metadata: e.metadata } : {}),
      })),
      attempts: attempts.map((a) => ({ ...a.attempt, courier: { id: a.attempt.courierId, code: a.courierCode, name: a.courierName } })),
      fees: {
        shippingFeeCents: order.shippingFeeCents,
        codFeeCents: order.codFeeCents,
        extraFeesCents: order.extraFeesCents,
        vatCents: order.vatCents,
        totalFeesCents: order.totalFeesCents,
        feesPaidBy: order.feesPaidBy,
        breakdown: (metadata as { pricing?: { breakdown?: unknown } } | null)?.pricing?.breakdown ?? null,
        returnFee: (metadata as { returnFee?: unknown } | null)?.returnFee ?? null,
      },
    };
    if (!staff) return { ...view, tags: (order.tags ?? []).filter((t) => t !== 'CUSTOMER_BLOCKED') };

    const [customer] = await this.db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1);
    return {
      ...view,
      internalNotes,
      metadata,
      risk,
      customer: customer
        ? { id: customer.id, name: customer.name, phone: customer.phone, totalOrders: customer.totalOrders, deliveredOrders: customer.deliveredOrders, refusedOrders: customer.refusedOrders, reliabilityScore: customer.reliabilityScore, isBlocked: customer.isBlocked }
        : null,
      ledger: await this.ledgerFor(id),
    };
  }

  private async ledgerFor(orderId: string) {
    const txs = await this.db.select().from(ledgerTransactions).where(eq(ledgerTransactions.orderId, orderId)).orderBy(asc(ledgerTransactions.createdAt), asc(ledgerTransactions.id));
    if (!txs.length) return [];
    const entries = await this.db
      .select({ transactionId: ledgerEntries.transactionId, debitCents: ledgerEntries.debitCents, creditCents: ledgerEntries.creditCents, code: ledgerAccounts.code, name: ledgerAccounts.name, type: ledgerAccounts.type })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .where(inArray(ledgerEntries.transactionId, txs.map((t) => t.id)));
    const byTx = groupBy(entries, (e) => e.transactionId);
    return txs.map((t) => ({ id: t.id, kind: t.kind, reference: t.reference, description: t.description, createdAt: t.createdAt, entries: (byTx.get(t.id) ?? []).map(({ transactionId: _t, ...e }) => e) }));
  }

  // ------------------------------------------------------------------ update

  async update(id: string, dto: UpdateOrderDto, p: Principal, meta: RequestMetaInfo) {
    const actor = actorFromPrincipal(p);
    const scope = brandScope(p);
    const staffOnly = (['internalNotes', 'tags', 'priority', 'maxAttempts'] as const).filter((k) => dto[k] !== undefined);
    if (scope && staffOnly.length) throw new DomainError('FORBIDDEN_FIELD', `Only GoTurtle staff can change ${staffOnly.join(', ')}`, HttpStatus.FORBIDDEN);

    await this.workflow.run(async (tx) => {
      const order = await this.workflow.lock(tx, id);
      if (scope && order.brandId !== scope) throw notFound('Order', id);
      const editable = scope ? BRAND_CANCELLABLE_STATUSES.includes(order.status) : !isTerminal(order.status);
      if (!editable) {
        throw new DomainError('ORDER_LOCKED', scope ? 'Orders can only be edited before pickup — contact support' : `A ${order.status} order cannot be edited`, HttpStatus.CONFLICT, { status: order.status });
      }
      const patch: Partial<OrderInsert> = {};
      const set = <K extends keyof OrderInsert>(key: K, value: OrderInsert[K] | undefined) => {
        if (value !== undefined && (order as Record<string, unknown>)[key] !== value) patch[key] = value;
      };

      if (dto.brandReference !== undefined && (dto.brandReference ?? null) !== order.brandReference) {
        if (dto.brandReference) await this.factory.assertReferenceFree(order.brandId, dto.brandReference, tx);
        patch.brandReference = dto.brandReference?.trim() || null;
      }
      if (dto.recipient) {
        set('recipientName', dto.recipient.name?.trim());
        if (dto.recipient.phone !== undefined) {
          const phone = normalizeEgyptPhone(dto.recipient.phone);
          if (!phone) throw new DomainError('INVALID_PHONE', 'Recipient phone is not a valid Egyptian mobile number', HttpStatus.BAD_REQUEST, { field: 'recipient.phone' });
          if (phone !== order.recipientPhone) {
            const { row } = await this.customers.upsertForOrder(tx, { phone, name: dto.recipient.name ?? order.recipientName });
            await this.customers.forgetOrder(tx, order.customerId);
            patch.recipientPhone = phone;
            patch.customerId = row.id;
          }
        }
        if (dto.recipient.altPhone !== undefined) {
          const alt = dto.recipient.altPhone ? normalizeEgyptPhone(dto.recipient.altPhone) : null;
          if (dto.recipient.altPhone && !alt) throw new DomainError('INVALID_PHONE', 'Alternative phone is not a valid Egyptian mobile number', HttpStatus.BAD_REQUEST, { field: 'recipient.altPhone' });
          set('recipientAltPhone', alt);
        }
      }
      let zone = await this.network.zoneById(order.zoneId);
      if (dto.address) {
        const a = dto.address;
        set('addressLine', a.line?.trim());
        for (const k of ['building', 'floor', 'apartment', 'landmark'] as const) if (a[k] !== undefined) set(k, a[k]?.trim() || null);
        if (a.lat !== undefined) set('lat', a.lat);
        if (a.lng !== undefined) set('lng', a.lng);
        if (a.zoneId) {
          zone = (await this.factory.resolveZone({ line: a.line ?? order.addressLine, zoneId: a.zoneId })).zone;
        } else if (a.line !== undefined || a.lat !== undefined || a.lng !== undefined) {
          const lat = a.lat !== undefined ? a.lat : order.lat;
          const lng = a.lng !== undefined ? a.lng : order.lng;
          const detected = await this.network.detect(a.line ?? order.addressLine, lat != null && lng != null ? { lat, lng } : null);
          if (detected.match) zone = await this.network.zoneById(detected.match.zoneId);
        }
        if (zone && zone.id !== order.zoneId) {
          patch.zoneId = zone.id;
          if (['CREATED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'ON_HOLD'].includes(order.status)) patch.hubId = zone.hubId;
        }
      }
      if (dto.package) {
        const k = dto.package;
        set('packageDescription', k.description === undefined ? undefined : k.description?.trim() || null);
        set('itemsCount', k.itemsCount);
        set('weightGrams', k.weightGrams);
        set('isFragile', k.isFragile);
        set('allowOpening', k.allowOpening);
        set('declaredValueCents', k.declaredValueCents);
      }
      set('serviceLevel', dto.serviceLevel);
      set('paymentMethod', dto.paymentMethod);
      set('codAmountCents', dto.codAmountCents);
      set('feesPaidBy', dto.feesPaidBy);
      if (dto.scheduledDate !== undefined) {
        if (dto.scheduledDate && !isDay(dto.scheduledDate)) throw new DomainError('INVALID_DATE', 'scheduledDate must be YYYY-MM-DD', HttpStatus.BAD_REQUEST);
        const today = cairoToday();
        if (dto.scheduledDate && (dto.scheduledDate < today || dto.scheduledDate > addDays(today, 30))) {
          throw new DomainError('INVALID_DATE', `scheduledDate must be between ${today} and ${addDays(today, 30)}`, HttpStatus.UNPROCESSABLE_ENTITY);
        }
        set('scheduledDate', dto.scheduledDate);
      }
      set('notes', dto.notes === undefined ? undefined : dto.notes?.trim() || null);
      set('deliveryOtpRequired', dto.deliveryOtpRequired);
      set('internalNotes', dto.internalNotes === undefined ? undefined : dto.internalNotes?.trim() || null);
      if (dto.tags !== undefined) patch.tags = [...new Set(dto.tags)];
      set('priority', dto.priority);
      set('maxAttempts', dto.maxAttempts);

      const next = { ...order, ...(patch as Partial<OrderRow>) };
      const pricingKeys = ['zoneId', 'serviceLevel', 'weightGrams', 'codAmountCents', 'paymentMethod', 'feesPaidBy', 'declaredValueCents'] as const;
      if (pricingKeys.some((k) => k in patch)) {
        if (next.paymentMethod === 'PREPAID' && next.codAmountCents > 0) {
          if (dto.paymentMethod === 'PREPAID' && dto.codAmountCents === undefined) next.codAmountCents = patch.codAmountCents = 0;
          else throw new DomainError('INVALID_COD', 'Prepaid orders cannot have a COD amount', HttpStatus.UNPROCESSABLE_ENTITY, { field: 'codAmountCents' });
        }
        const rate = await this.pricing.rateCardForBrand(order.brandId, tx);
        const input: QuoteInput = {
          tier: zone!.tier, serviceLevel: next.serviceLevel, type: next.type, weightGrams: next.weightGrams, paymentMethod: next.paymentMethod,
          codAmountCents: next.codAmountCents, declaredValueCents: next.declaredValueCents, feesPaidBy: next.feesPaidBy,
        };
        const q = this.pricing.computeQuote(rate.card, input);
        Object.assign(patch, {
          shippingFeeCents: q.shippingFeeCents, codFeeCents: q.codFeeCents, extraFeesCents: q.extraFeesCents, vatCents: q.vatCents,
          totalFeesCents: q.totalFeesCents, collectCents: q.collectFromRecipientCents,
          metadata: { ...(order.metadata ?? {}), pricing: { planId: rate.plan.id, planName: rate.plan.name, breakdown: q.breakdown, netToBrandCents: q.netToBrandCents } },
        });
      }
      if ('serviceLevel' in patch || 'zoneId' in patch || 'scheduledDate' in patch) {
        patch.promisedBy = promiseFor(next.serviceLevel, zone!.slaHours, next.scheduledDate, order.createdAt);
      }

      const changed = Object.keys(patch).filter((k) => k !== 'metadata');
      if (!changed.length) return;
      await tx.update(orders).set(patch).where(eq(orders.id, id));
      if ('collectCents' in patch && order.runsheetId) await this.refreshRunsheetCod(tx, order.runsheetId);
      await this.workflow.addNote(tx, order, actor, { reason: 'UPDATED', note: `Updated: ${changed.join(', ')}`, metadata: { fields: changed } });
      const before = Object.fromEntries(changed.map((k) => [k, (order as Record<string, unknown>)[k]]));
      const after = Object.fromEntries(changed.map((k) => [k, (patch as Record<string, unknown>)[k]]));
      await this.audit.record(p, { action: 'order.update', entity: 'Order', entityId: id, before, after }, meta, tx);
    });
    return this.detail(id, p);
  }

  /** Recomputes a runsheet's expected COD after its orders changed. */
  async refreshRunsheetCod(tx: DbOrTx, runsheetId: string) {
    const [{ s }] = await tx
      .select({ s: sql<number>`coalesce(sum(${orders.collectCents}), 0)`.mapWith(Number) })
      .from(orders)
      .where(and(eq(orders.runsheetId, runsheetId), ne(orders.status, 'CANCELLED')));
    await tx.update(runsheets).set({ expectedCodCents: s }).where(eq(runsheets.id, runsheetId));
  }

  // ------------------------------------------------------------------ cancel / status

  async cancel(id: string, reason: string | undefined, p: Principal, meta: RequestMetaInfo) {
    const order = await this.loadScoped(id, p);
    const scope = brandScope(p);
    const allowed = scope ? BRAND_CANCELLABLE_STATUSES.includes(order.status) : canTransition(order.status, 'CANCELLED');
    if (!allowed) {
      throw new DomainError('NOT_CANCELLABLE', `A ${order.status} order cannot be cancelled${isTerminal(order.status) ? '' : ' — request a return instead'}`, HttpStatus.CONFLICT, { status: order.status });
    }
    await this.workflow.transition(id, 'CANCELLED', actorFromPrincipal(p), { reason: scope ? 'CANCELLED_BY_BRAND' : 'CANCELLED_BY_STAFF', note: reason ?? null, meta });
    return this.detail(id, p);
  }

  /** Staff: any transition the state machine allows. */
  async changeStatus(id: string, dto: ChangeStatusDto, p: Principal, meta: RequestMetaInfo) {
    await this.loadScoped(id, p);
    if (dto.courierId) {
      const [c] = await this.db.select({ id: couriers.id, status: couriers.status }).from(couriers).where(eq(couriers.id, dto.courierId)).limit(1);
      if (!c) throw notFound('Hero', dto.courierId);
      if (c.status !== 'ACTIVE') throw new DomainError('COURIER_INACTIVE', 'This hero is not active', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (dto.hubId) {
      const [h] = await this.db.select({ id: hubs.id }).from(hubs).where(eq(hubs.id, dto.hubId)).limit(1);
      if (!h) throw notFound('Hub', dto.hubId);
    }
    if (dto.status === 'RESCHEDULED' && dto.scheduledDate && dto.scheduledDate < cairoToday()) {
      throw new DomainError('INVALID_DATE', 'scheduledDate cannot be in the past', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const failureReason = dto.failureReason ?? (dto.reason && dto.reason in FailureReason ? (dto.reason as FailureReason) : undefined);
    const opts: TransitionOptions = {
      reason: dto.reason ?? null,
      note: dto.note ?? null,
      isPublic: dto.isPublic,
      courierId: dto.courierId,
      hubId: dto.hubId,
      scheduledDate: dto.scheduledDate,
      meta,
      ...(dto.status === 'DELIVERED' ? { delivery: { collectedCents: dto.collectedCents, receivedBy: dto.receivedBy ?? null } } : {}),
      ...(dto.status === 'FAILED_ATTEMPT' && failureReason ? { failure: { reason: failureReason } } : {}),
    };
    await this.workflow.transition(id, dto.status, actorFromPrincipal(p), opts);
    return this.detail(id, p);
  }

  // ------------------------------------------------------------------ labels & export

  /** Data for 4x6" AWB labels. Unknown / other brands' ids are reported in `missing`. */
  async labels(ids: string[], p: Principal) {
    const scope = brandScope(p);
    const unique = [...new Set(ids)];
    const rows = await this.db
      .select({
        order: orders,
        brandName: brands.name,
        brandCode: brands.code,
        brandPhone: brands.phone,
        zoneCode: zones.code,
        zoneNameEn: zones.nameEn,
        zoneNameAr: zones.nameAr,
        zoneHubId: zones.hubId,
        locationName: brandLocations.name,
      })
      .from(orders)
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .innerJoin(zones, eq(zones.id, orders.zoneId))
      .leftJoin(brandLocations, eq(brandLocations.id, orders.pickupLocationId))
      .where(whereAll(inArray(orders.id, unique), scope ? eq(orders.brandId, scope) : undefined));
    const hubIds = [...new Set(rows.flatMap((r) => [r.order.hubId, r.zoneHubId]).filter((x): x is string => !!x))];
    const hubRows = hubIds.length ? await this.db.select({ id: hubs.id, code: hubs.code }).from(hubs).where(inArray(hubs.id, hubIds)) : [];
    const hubCode = new Map(hubRows.map((h) => [h.id, h.code]));
    const byId = new Map(rows.map((r) => [r.order.id, r]));
    const labels = unique
      .filter((x) => byId.has(x))
      .map((x) => {
        const r = byId.get(x)!;
        const o = r.order;
        const destHub = r.zoneHubId ?? o.hubId;
        return {
          id: o.id,
          trackingNumber: o.trackingNumber,
          barcode: o.trackingNumber,
          brandReference: o.brandReference,
          brand: { name: r.brandName, code: r.brandCode, phone: r.brandPhone },
          pickupLocation: r.locationName,
          recipient: { name: o.recipientName, phone: formatEgyptPhone(o.recipientPhone), altPhone: o.recipientAltPhone ? formatEgyptPhone(o.recipientAltPhone) : null },
          address: {
            line: o.addressLine,
            building: o.building,
            floor: o.floor,
            apartment: o.apartment,
            landmark: o.landmark,
            full: [o.addressLine, o.building && `Bldg ${o.building}`, o.floor && `Floor ${o.floor}`, o.apartment && `Apt ${o.apartment}`].filter(Boolean).join(', '),
          },
          zone: { code: r.zoneCode, nameEn: r.zoneNameEn, nameAr: r.zoneNameAr },
          hubCode: destHub ? hubCode.get(destHub) ?? null : null,
          type: o.type,
          serviceLevel: o.serviceLevel,
          paymentMethod: o.paymentMethod,
          codToCollectCents: o.collectCents,
          codToCollectEgp: centsToEgp(o.collectCents),
          pieces: o.itemsCount,
          weightGrams: o.weightGrams,
          description: o.packageDescription,
          notes: o.notes,
          allowOpening: o.allowOpening,
          fragile: o.isFragile,
          deliveryOtpRequired: o.deliveryOtpRequired,
          scheduledDate: o.scheduledDate,
          promisedBy: o.promisedBy,
          createdAt: o.createdAt,
        };
      });
    return { labels, missing: unique.filter((x) => !byId.has(x)), format: '4x6' };
  }

  /** CSV export (UTF-8 with BOM so Excel shows Arabic). */
  async exportCsv(q: OrderListQuery, p: Principal): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const scope = brandScope(p);
    const staff = isStaff(p);
    const where = this.filters(q, scope);
    const col = SORT_COLUMNS[q.sort ?? 'createdAt'];
    const rows = await this.selectList()
      .where(where)
      .orderBy(q.order === 'asc' ? asc(col) : desc(col), desc(orders.id))
      .limit(EXPORT_MAX_ROWS + 1);
    const truncated = rows.length > EXPORT_MAX_ROWS;
    const egp = (c: number | null | undefined) => (c == null ? '' : centsToEgp(c).toFixed(2));
    const iso = (d: Date | null) => (d ? d.toISOString() : '');
    const data = rows.slice(0, EXPORT_MAX_ROWS).map((r) => ({
      tracking_number: r.trackingNumber,
      reference: r.brandReference ?? '',
      ...(staff ? { brand: r.brand.code } : {}),
      status: r.status,
      status_ar: ORDER_STATUS_LABELS[r.status].ar,
      type: r.type,
      service_level: r.serviceLevel,
      created_at: iso(r.createdAt),
      recipient_name: r.recipientName,
      phone: formatEgyptPhone(r.recipientPhone),
      address: r.addressLine,
      zone: r.zone.code,
      zone_name: r.zone.nameEn,
      payment_method: r.paymentMethod,
      cod_amount: egp(r.codAmountCents),
      collect_amount: egp(r.collectCents),
      collected_amount: egp(r.collectedCents),
      fees_total: egp(r.totalFeesCents),
      fees_paid_by: r.feesPaidBy,
      attempts: r.attempts,
      hero: r.courierCode ?? '',
      hub: r.hubCode ?? '',
      promised_by: iso(r.promisedBy),
      picked_up_at: iso(r.pickedUpAt),
      delivered_at: iso(r.deliveredAt),
      returned_at: iso(r.returnedAt),
      ...(staff ? { risk_score: r.riskScore } : {}),
    }));
    const csv = '﻿' + Papa.unparse(data.length ? data : [{ tracking_number: '' }].slice(0, 0), { columns: data.length ? undefined : EXPORT_EMPTY_COLUMNS(staff) });
    return { csv, rows: data.length, truncated };
  }

  /** Lets other services add a timeline note through the same writer. */
  async note(orderId: string, actor: ActorContext, entry: { reason: string; note?: string; isPublic?: boolean }) {
    await this.db.transaction(async (tx) => {
      const order = await this.workflow.lock(tx, orderId);
      await this.workflow.addNote(tx, order, actor, entry);
      await this.audit.record(auditPrincipal(actor), { action: 'order.note', entity: 'Order', entityId: orderId, after: entry }, null, tx);
    });
  }
}

function nextStatuses(status: OrderStatus): OrderStatus[] {
  return (Object.values(OrderStatus) as OrderStatus[]).filter((s) => canTransition(status, s));
}

const EXPORT_EMPTY_COLUMNS = (staff: boolean) => [
  'tracking_number', 'reference', ...(staff ? ['brand'] : []), 'status', 'status_ar', 'type', 'service_level', 'created_at', 'recipient_name', 'phone',
  'address', 'zone', 'zone_name', 'payment_method', 'cod_amount', 'collect_amount', 'collected_amount', 'fees_total', 'fees_paid_by', 'attempts',
  'hero', 'hub', 'promised_by', 'picked_up_at', 'delivered_at', 'returned_at', ...(staff ? ['risk_score'] : []),
];
