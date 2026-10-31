import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, notInArray, type SQL } from 'drizzle-orm';
import { DomainEvents, isValidTrackingNumber, normalizeTrackingNumber, type PickupStatus } from '@goturtle/shared';
import type { Db, DbOrTx, Tx } from '../../db/client';
import { brandLocations, brands, couriers, orders, pickups, users, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { SequenceService } from '../../core/sequence.service';
import { PostingsService } from '../../core/ledger/postings.service';
import type { PickupCompletedEvent } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import { actorFromPrincipal, SYSTEM_ACTOR, type ActorContext } from '../../common/actor';
import { brandScope, isStaff, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { offsetOf, paginate } from '../../common/pagination';
import { cairoToday, whereAll } from '../../db/helpers';
import { newId } from '../../db/columns';
import { OrderWorkflowService } from '../orders/order-workflow.service';
import type { OrderRow } from '../orders/order-factory.service';
import { assertDayInRange, auditPrincipal, type PostCommit } from '../orders/ops-kit';
import type { PickupListQuery, RequestPickupDto } from './pickups.dto';

export type PickupRow = typeof pickups.$inferSelect;

const OPEN: PickupStatus[] = ['REQUESTED', 'ASSIGNED'];
const ACTIVE: PickupStatus[] = ['ASSIGNED', 'IN_PROGRESS'];
/** Order statuses that mean "not collected by this pickup". */
const NOT_COLLECTED = ['CREATED', 'PICKUP_ASSIGNED', 'CANCELLED', 'ON_HOLD'] as const;

/**
 * First mile. Brands request pickups; ops assign a hero; the hero scans the
 * parcels (each scan moves the order to PICKED_UP) and completes the pickup.
 */
@Injectable()
export class PickupsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly postings: PostingsService,
    private readonly workflow: OrderWorkflowService,
  ) {}

  // ------------------------------------------------------------------ brand / staff

  async request(dto: RequestPickupDto, p: Principal, meta: RequestMetaInfo) {
    const scope = brandScope(p);
    const brandId = scope ?? dto.brandId;
    if (!brandId) throw new DomainError('BRAND_REQUIRED', 'brandId is required when staff request a pickup', HttpStatus.BAD_REQUEST);
    const [brand] = await this.db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
    if (!brand) throw notFound('Brand', brandId);
    if (brand.status !== 'ACTIVE') throw new DomainError('BRAND_INACTIVE', 'Only active brands can request pickups', HttpStatus.UNPROCESSABLE_ENTITY);
    assertDayInRange(dto.scheduledDate, { minOffset: 0, maxOffset: 14, field: 'scheduledDate' });

    const location = await this.location(brandId, dto.locationId);
    const [existing] = await this.db
      .select({ id: pickups.id, code: pickups.code })
      .from(pickups)
      .where(and(eq(pickups.locationId, location.id), eq(pickups.scheduledDate, dto.scheduledDate), inArray(pickups.status, OPEN)))
      .limit(1);
    if (existing) {
      throw new DomainError('PICKUP_EXISTS', `Pickup ${existing.code} is already scheduled for this location and day`, HttpStatus.CONFLICT, { pickupId: existing.id, code: existing.code });
    }

    const id = newId();
    const actor = actorFromPrincipal(p);
    await this.db.transaction(async (tx) => {
      const code = await this.sequences.code('PU', 'pickup', 6, tx);
      await tx.insert(pickups).values({
        id, code, brandId, locationId: location.id, status: 'REQUESTED', scheduledDate: dto.scheduledDate, timeWindow: dto.timeWindow ?? null,
        expectedCount: dto.expectedCount ?? 0, notes: dto.notes ?? null,
      });
      const attached = await this.attachWaitingOrders(tx, id, brandId, location.id);
      if (attached > (dto.expectedCount ?? 0)) await tx.update(pickups).set({ expectedCount: attached }).where(eq(pickups.id, id));
      await this.audit.record(auditPrincipal(actor), { action: 'pickup.request', entity: 'Pickup', entityId: id, after: { ...dto, code, attached } }, meta, tx);
    });
    return this.detail(id, p);
  }

  private async location(brandId: string, locationId?: string) {
    const conds = [eq(brandLocations.brandId, brandId), eq(brandLocations.isActive, true)];
    if (locationId) conds.push(eq(brandLocations.id, locationId));
    const [loc] = await this.db.select().from(brandLocations).where(and(...conds)).orderBy(desc(brandLocations.isDefault), asc(brandLocations.createdAt)).limit(1);
    if (!loc) {
      throw new DomainError(locationId ? 'INVALID_PICKUP_LOCATION' : 'NO_PICKUP_LOCATION', locationId ? 'Pickup location does not belong to this brand' : 'Add a pickup location first', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return loc;
  }

  /** Links the brand's CREATED orders at this location that wait for a pickup. */
  private async attachWaitingOrders(tx: DbOrTx, pickupId: string, brandId: string, locationId: string): Promise<number> {
    const res = await tx
      .update(orders)
      .set({ pickupId })
      .where(and(eq(orders.brandId, brandId), eq(orders.pickupLocationId, locationId), eq(orders.status, 'CREATED'), isNull(orders.pickupId)));
    return Number((res as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0);
  }

  async list(q: PickupListQuery, p: Principal) {
    const scope = brandScope(p);
    const where = this.listWhere(q, scope);
    const [rows, [{ n }]] = await Promise.all([
      this.baseSelect()
        .where(where)
        .orderBy(q.order === 'asc' ? asc(pickups.scheduledDate) : desc(pickups.scheduledDate), desc(pickups.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(pickups).innerJoin(brandLocations, eq(brandLocations.id, pickups.locationId)).innerJoin(zones, eq(zones.id, brandLocations.zoneId)).where(where),
    ]);
    const counts = await this.orderCounts(rows.map((r) => r.pickup.id));
    return paginate(rows.map((r) => this.present(r, counts.get(r.pickup.id), isStaff(p))), Number(n), q);
  }

  private listWhere(q: PickupListQuery, scope: string | null): SQL | undefined {
    return whereAll(
      scope ? eq(pickups.brandId, scope) : q.brandId ? eq(pickups.brandId, q.brandId) : undefined,
      q.status?.length ? inArray(pickups.status, q.status) : undefined,
      q.courierId ? eq(pickups.courierId, q.courierId) : undefined,
      q.hubId ? eq(zones.hubId, q.hubId) : undefined,
      q.from ? gte(pickups.scheduledDate, q.from) : undefined,
      q.to ? lte(pickups.scheduledDate, q.to) : undefined,
    );
  }

  baseSelect(db: DbOrTx = this.db) {
    return db
      .select({
        pickup: pickups,
        brand: { id: brands.id, code: brands.code, name: brands.name, phone: brands.phone },
        location: {
          id: brandLocations.id, name: brandLocations.name, addressLine: brandLocations.addressLine, contactName: brandLocations.contactName,
          phone: brandLocations.phone, lat: brandLocations.lat, lng: brandLocations.lng, zoneId: brandLocations.zoneId,
        },
        zone: { id: zones.id, code: zones.code, nameEn: zones.nameEn, nameAr: zones.nameAr, hubId: zones.hubId },
        courierCode: couriers.code,
        courierName: users.name,
        courierPhone: users.phone,
      })
      .from(pickups)
      .innerJoin(brands, eq(brands.id, pickups.brandId))
      .innerJoin(brandLocations, eq(brandLocations.id, pickups.locationId))
      .innerJoin(zones, eq(zones.id, brandLocations.zoneId))
      .leftJoin(couriers, eq(couriers.id, pickups.courierId))
      .leftJoin(users, eq(users.id, couriers.userId))
      .$dynamic();
  }

  async orderCounts(ids: string[]) {
    const out = new Map<string, { attached: number; picked: number }>();
    if (!ids.length) return out;
    const rows = await this.db.select({ pickupId: orders.pickupId, status: orders.status, n: count() }).from(orders).where(inArray(orders.pickupId, ids)).groupBy(orders.pickupId, orders.status);
    for (const r of rows) {
      const cur = out.get(r.pickupId!) ?? { attached: 0, picked: 0 };
      cur.attached += Number(r.n);
      if (!(NOT_COLLECTED as readonly string[]).includes(r.status)) cur.picked += Number(r.n);
      out.set(r.pickupId!, cur);
    }
    return out;
  }

  present(r: Awaited<ReturnType<PickupsService['baseSelect']>>[number], c: { attached: number; picked: number } | undefined, staff: boolean) {
    return {
      ...r.pickup,
      brand: r.brand,
      location: r.location,
      zone: r.zone,
      courier: r.pickup.courierId ? { id: r.pickup.courierId, code: r.courierCode, name: r.courierName, ...(staff ? { phone: r.courierPhone } : {}) } : null,
      ordersCount: c?.attached ?? 0,
      scannedCount: c?.picked ?? 0,
    };
  }

  async detail(id: string, p: Principal) {
    const scope = brandScope(p);
    const [row] = await this.baseSelect().where(eq(pickups.id, id)).limit(1);
    if (!row || (scope && row.pickup.brandId !== scope)) throw notFound('Pickup', id);
    return this.detailOf(row, isStaff(p));
  }

  async detailOf(row: Awaited<ReturnType<PickupsService['baseSelect']>>[number], staff: boolean) {
    const list = await this.db
      .select({
        id: orders.id, trackingNumber: orders.trackingNumber, brandReference: orders.brandReference, status: orders.status, recipientName: orders.recipientName,
        codAmountCents: orders.codAmountCents, collectCents: orders.collectCents, itemsCount: orders.itemsCount, pickedUpAt: orders.pickedUpAt,
      })
      .from(orders)
      .where(eq(orders.pickupId, row.pickup.id))
      .orderBy(asc(orders.createdAt));
    const picked = list.filter((o) => !(NOT_COLLECTED as readonly string[]).includes(o.status)).length;
    return { ...this.present(row, { attached: list.length, picked }, staff), orders: list.map((o) => ({ ...o, scanned: !(NOT_COLLECTED as readonly string[]).includes(o.status) })) };
  }

  async cancel(id: string, reason: string | undefined, p: Principal, meta: RequestMetaInfo) {
    const scope = brandScope(p);
    const actor = actorFromPrincipal(p);
    await this.workflow.run(async (tx, fx) => {
      const pickup = await this.lock(tx, id);
      if (scope && pickup.brandId !== scope) throw notFound('Pickup', id);
      if (!OPEN.includes(pickup.status)) throw new DomainError('PICKUP_NOT_CANCELLABLE', `A ${pickup.status} pickup cannot be cancelled`, HttpStatus.CONFLICT, { status: pickup.status });
      await tx.update(pickups).set({ status: 'CANCELLED', failureNote: reason ?? null }).where(eq(pickups.id, id));
      await this.releaseOrders(tx, fx, id, 'Pickup cancelled');
      await this.audit.record(auditPrincipal(actor), { action: 'pickup.cancel', entity: 'Pickup', entityId: id, before: { status: pickup.status }, after: { status: 'CANCELLED', reason } }, meta, tx);
    });
    return this.detail(id, p);
  }

  /** Staff: assign or reassign the pickup hero; attached orders become PICKUP_ASSIGNED. */
  async assign(id: string, courierId: string, p: Principal, meta: RequestMetaInfo) {
    const actor = actorFromPrincipal(p);
    const [courier] = await this.db.select({ id: couriers.id, status: couriers.status }).from(couriers).where(eq(couriers.id, courierId)).limit(1);
    if (!courier) throw notFound('Hero', courierId);
    if (courier.status !== 'ACTIVE') throw new DomainError('COURIER_INACTIVE', 'This hero is not active', HttpStatus.UNPROCESSABLE_ENTITY);
    await this.workflow.run(async (tx, fx) => {
      const pickup = await this.lock(tx, id);
      if (!OPEN.includes(pickup.status)) throw new DomainError('PICKUP_NOT_ASSIGNABLE', `A ${pickup.status} pickup cannot be (re)assigned`, HttpStatus.CONFLICT, { status: pickup.status });
      await tx.update(pickups).set({ courierId, status: 'ASSIGNED' }).where(eq(pickups.id, id));
      await this.attachWaitingOrders(tx, id, pickup.brandId, pickup.locationId);
      const list = await tx.select({ id: orders.id, status: orders.status, courierId: orders.courierId }).from(orders).where(eq(orders.pickupId, id)).orderBy(asc(orders.id));
      for (const o of list) {
        if (o.status === 'CREATED') await this.workflow.apply(tx, fx, o.id, 'PICKUP_ASSIGNED', actor, { courierId, pickupId: id, meta });
        else if (o.status === 'PICKUP_ASSIGNED' && o.courierId !== courierId) await this.workflow.reassignCourier(tx, o.id, courierId, actor, 'Pickup reassigned');
      }
      await this.audit.record(auditPrincipal(actor), { action: pickup.courierId ? 'pickup.reassign' : 'pickup.assign', entity: 'Pickup', entityId: id, before: { courierId: pickup.courierId }, after: { courierId } }, meta, tx);
    });
    return this.detail(id, p);
  }

  // ------------------------------------------------------------------ hero flow

  async forCourier(courierId: string, day = cairoToday()) {
    const rows = await this.baseSelect()
      .where(and(eq(pickups.courierId, courierId), inArray(pickups.status, ACTIVE), lte(pickups.scheduledDate, day)))
      .orderBy(asc(pickups.scheduledDate), asc(pickups.timeWindow));
    const counts = await this.orderCounts(rows.map((r) => r.pickup.id));
    return rows.map((r) => this.present(r, counts.get(r.pickup.id), false));
  }

  async heroDetail(id: string, actor: ActorContext) {
    const [row] = await this.baseSelect().where(eq(pickups.id, id)).limit(1);
    if (!row || row.pickup.courierId !== actor.courierId) throw notFound('Pickup', id);
    return this.detailOf(row, false);
  }

  async start(id: string, actor: ActorContext) {
    await this.db.transaction(async (tx) => {
      const pickup = await this.lockMine(tx, id, actor);
      if (pickup.status === 'IN_PROGRESS') return;
      if (pickup.status !== 'ASSIGNED') throw new DomainError('PICKUP_NOT_STARTABLE', `A ${pickup.status} pickup cannot be started`, HttpStatus.CONFLICT);
      await tx.update(pickups).set({ status: 'IN_PROGRESS', startedAt: new Date() }).where(eq(pickups.id, id));
      await this.audit.record(auditPrincipal(actor), { action: 'pickup.start', entity: 'Pickup', entityId: id }, null, tx);
    });
    return this.heroDetail(id, actor);
  }

  /** One parcel handed over: validates it belongs to this pickup's brand & location and moves it to PICKED_UP. */
  async scan(id: string, rawTn: string, actor: ActorContext, pos: { lat?: number | null; lng?: number | null } = {}) {
    const result = await this.workflow.run(async (tx, fx) => {
      const pickup = await this.lockMine(tx, id, actor);
      if (!ACTIVE.includes(pickup.status)) throw new DomainError('PICKUP_NOT_ACTIVE', `Pickup is ${pickup.status}`, HttpStatus.CONFLICT);
      if (pickup.status === 'ASSIGNED') await tx.update(pickups).set({ status: 'IN_PROGRESS', startedAt: new Date() }).where(eq(pickups.id, id));
      const check = await this.checkScan(tx, pickup, rawTn, actor);
      if ('error' in check) throw check.error;
      if (check.alreadyScanned) return { order: check.order, alreadyScanned: true };
      const order = await this.workflow.apply(tx, fx, check.order.id, 'PICKED_UP', actor, { pickupId: id, courierId: actor.courierId, lat: pos.lat, lng: pos.lng });
      await this.refreshCount(tx, id);
      return { order, alreadyScanned: false };
    });
    const [{ n }] = await this.db.select({ n: count() }).from(orders).where(and(eq(orders.pickupId, id), notInArray(orders.status, [...NOT_COLLECTED])));
    return { trackingNumber: result.order.trackingNumber, orderId: result.order.id, status: result.order.status, alreadyScanned: result.alreadyScanned, scannedCount: Number(n) };
  }

  private async checkScan(tx: DbOrTx, pickup: PickupRow, rawTn: string, actor: ActorContext): Promise<{ order: OrderRow; alreadyScanned: boolean } | { error: DomainError }> {
    const tn = normalizeTrackingNumber(rawTn);
    if (!isValidTrackingNumber(tn)) return { error: new DomainError('INVALID_TRACKING_NUMBER', `${rawTn} is not a valid tracking number`, HttpStatus.BAD_REQUEST, { trackingNumber: rawTn }) };
    const [order] = await tx.select().from(orders).where(eq(orders.trackingNumber, tn)).limit(1);
    if (!order || order.brandId !== pickup.brandId || order.pickupLocationId !== pickup.locationId) {
      return { error: new DomainError('ORDER_NOT_IN_PICKUP', `${tn} does not belong to this pickup's brand and location`, HttpStatus.UNPROCESSABLE_ENTITY, { trackingNumber: tn }) };
    }
    if (order.pickupId === pickup.id && order.status === 'PICKED_UP') return { order, alreadyScanned: true };
    if (order.status !== 'CREATED' && order.status !== 'PICKUP_ASSIGNED') {
      return { error: new DomainError('INVALID_TRANSITION', `${tn} is ${order.status} and cannot be picked up`, HttpStatus.CONFLICT, { from: order.status, to: 'PICKED_UP', trackingNumber: tn }) };
    }
    if (order.courierId && order.courierId !== actor.courierId) {
      return { error: new DomainError('NOT_YOUR_ORDER', `${tn} is assigned to another hero's pickup`, HttpStatus.FORBIDDEN, { trackingNumber: tn }) };
    }
    return { order, alreadyScanned: false };
  }

  /** Finishes the pickup: scanned parcels are PICKED_UP, the rest go back to CREATED for the next pickup. */
  async complete(id: string, dto: { trackingNumbers?: string[]; note?: string }, actor: ActorContext) {
    const rejected: Array<{ trackingNumber: string; code: string; message: string }> = [];
    await this.workflow.run(async (tx, fx) => {
      const pickup = await this.lockMine(tx, id, actor);
      if (!ACTIVE.includes(pickup.status)) throw new DomainError('PICKUP_NOT_ACTIVE', `Pickup is ${pickup.status}`, HttpStatus.CONFLICT);
      for (const raw of new Set(dto.trackingNumbers ?? [])) {
        const check = await this.checkScan(tx, pickup, raw, actor);
        if ('error' in check) {
          rejected.push({ trackingNumber: raw, code: check.error.code, message: check.error.message });
          continue;
        }
        if (!check.alreadyScanned) await this.workflow.apply(tx, fx, check.order.id, 'PICKED_UP', actor, { pickupId: id, courierId: actor.courierId });
      }
      const picked = await this.countPicked(tx, id);
      if (picked === 0) throw new DomainError('PICKUP_EMPTY', 'No parcel was scanned — report the pickup as failed instead', HttpStatus.UNPROCESSABLE_ENTITY);
      await this.releaseOrders(tx, fx, id, 'Not handed over at pickup');
      await tx.update(pickups).set({ status: 'COMPLETED', completedAt: new Date(), pickedCount: picked, startedAt: pickup.startedAt ?? new Date(), notes: dto.note ? `${pickup.notes ? `${pickup.notes}\n` : ''}Hero: ${dto.note}`.slice(0, 1000) : pickup.notes }).where(eq(pickups.id, id));
      const [courier] = await tx.select().from(couriers).where(eq(couriers.id, pickup.courierId!)).limit(1);
      await this.postings.pickupEarning(tx, pickup.id, pickup.code, courier);
      await this.audit.record(auditPrincipal(actor), { action: 'pickup.complete', entity: 'Pickup', entityId: id, after: { pickedCount: picked } }, null, tx);
      fx.emit(DomainEvents.PickupCompleted, { pickupId: id, brandId: pickup.brandId, courierId: pickup.courierId, pickedCount: picked } satisfies PickupCompletedEvent);
    });
    return { ...(await this.heroDetail(id, actor)), rejected };
  }

  async fail(id: string, note: string, actor: ActorContext) {
    await this.workflow.run(async (tx, fx) => {
      const pickup = await this.lockMine(tx, id, actor);
      if (!ACTIVE.includes(pickup.status)) throw new DomainError('PICKUP_NOT_ACTIVE', `Pickup is ${pickup.status}`, HttpStatus.CONFLICT);
      if ((await this.countPicked(tx, id)) > 0) throw new DomainError('PICKUP_HAS_SCANNED', 'Some parcels were already scanned — complete the pickup instead', HttpStatus.CONFLICT);
      await tx.update(pickups).set({ status: 'FAILED', failureNote: note, completedAt: new Date() }).where(eq(pickups.id, id));
      await this.releaseOrders(tx, fx, id, `Pickup failed: ${note}`);
      await this.audit.record(auditPrincipal(actor), { action: 'pickup.fail', entity: 'Pickup', entityId: id, after: { note } }, null, tx);
    });
    return this.heroDetail(id, actor);
  }

  // ------------------------------------------------------------------ helpers

  private async countPicked(tx: DbOrTx, id: string) {
    const [{ n }] = await tx.select({ n: count() }).from(orders).where(and(eq(orders.pickupId, id), notInArray(orders.status, [...NOT_COLLECTED])));
    return Number(n);
  }

  private async refreshCount(tx: DbOrTx, id: string) {
    await tx.update(pickups).set({ pickedCount: await this.countPicked(tx, id) }).where(eq(pickups.id, id));
  }

  /** Orders of the pickup that were not collected go back to CREATED without a pickup. */
  private async releaseOrders(tx: Tx, fx: PostCommit, pickupId: string, note: string) {
    const list = await tx.select({ id: orders.id, status: orders.status }).from(orders).where(and(eq(orders.pickupId, pickupId), inArray(orders.status, ['CREATED', 'PICKUP_ASSIGNED']))).orderBy(asc(orders.id));
    for (const o of list) {
      if (o.status === 'PICKUP_ASSIGNED') await this.workflow.apply(tx, fx, o.id, 'CREATED', SYSTEM_ACTOR, { clearPickup: true, note, isPublic: false, reason: 'PICKUP_RELEASED' });
      else await tx.update(orders).set({ pickupId: null }).where(eq(orders.id, o.id));
    }
  }

  private async lock(tx: DbOrTx, id: string): Promise<PickupRow> {
    const [row] = await tx.select().from(pickups).where(eq(pickups.id, id)).for('update').limit(1);
    if (!row) throw notFound('Pickup', id);
    return row;
  }

  private async lockMine(tx: DbOrTx, id: string, actor: ActorContext): Promise<PickupRow> {
    const row = await this.lock(tx, id);
    if (!actor.courierId || row.courierId !== actor.courierId) throw notFound('Pickup', id);
    return row;
  }
}
