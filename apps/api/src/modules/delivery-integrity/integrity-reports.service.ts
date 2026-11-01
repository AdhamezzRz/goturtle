import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, like, lt, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { normalizeEgyptPhone, TERMINAL_STATUSES, type AttemptDisputeStatus, type ConfirmationStatus } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { brands, callLogs, couriers, customerAddresses, customers, deliveryAttempts, orderEvents, orders, tickets, users, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { brandScope, type Principal } from '../../common/principal';
import { likeEscape, loadByIds } from '../../db/helpers';
import { HoldsService, integrityMetaOf } from './holds.service';
import { distanceMeters } from './integrity.util';
import type { ConfirmationsQuery, DisputesQuery, HeroIntegrityQuery, HoldsQuery, NetworkRiskQuery } from './integrity.dto';

const DAY = 24 * 3_600_000;
const RTO: Array<typeof orders.$inferSelect.status> = ['RETURN_PENDING', 'RETURN_OUT', 'RETURNED'];
const ACTIVE = notInArray(orders.status, [...TERMINAL_STATUSES]);
const CONFIRMATION_REASONS = ['CONFIRMATION_REQUESTED', 'CONFIRMATION_CONFIRMED', 'CONFIRMATION_DECLINED', 'CONFIRMATION_NO_RESPONSE', 'CUSTOMER_RESCHEDULED', 'INTEGRITY_OVERRIDE', 'HOLD_RELEASED', 'PIN_REUSED', 'ATTEMPT_DISPUTED', 'ATTEMPT_CONFIRMED', 'ATTEMPT_DISPUTE_UPHELD', 'ATTEMPT_DISPUTE_REJECTED'];
const n = (v: unknown) => Number(v ?? 0);
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/** Read models for the Ops integrity page, order detail and brand views. */
@Injectable()
export class IntegrityReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly holds: HoldsService,
  ) {}

  // ------------------------------------------------------------------ KPIs

  async overview(now = new Date()) {
    const s = await this.holds.config();
    const d30 = new Date(now.getTime() - 30 * DAY);
    const d60 = new Date(now.getTime() - 60 * DAY);
    const countWhere = async (where: SQL | undefined) => n((await this.db.select({ n: count() }).from(orders).where(where))[0]?.n);
    const [pending, noResponse, blockedForDispatch, holdRows, confRows, disputeRows, rtoNow, rtoPrev, [cust]] = await Promise.all([
      countWhere(and(eq(orders.confirmationStatus, 'PENDING'), ACTIVE)),
      countWhere(and(eq(orders.confirmationStatus, 'NO_RESPONSE'), ACTIVE)),
      countWhere(and(inArray(orders.confirmationStatus, ['PENDING', 'NO_RESPONSE']), gte(orders.riskScore, s.holdUnconfirmedAboveRisk), ACTIVE)),
      this.db.select({ reason: orders.holdReason, n: count() }).from(orders).where(eq(orders.status, 'ON_HOLD')).groupBy(orders.holdReason),
      this.db.select({ status: orders.confirmationStatus, n: count() }).from(orders).where(gte(orders.confirmationRequestedAt, d30)).groupBy(orders.confirmationStatus),
      this.db
        .select({ status: deliveryAttempts.disputeStatus, n: count() })
        .from(deliveryAttempts)
        .where(and(ne(deliveryAttempts.disputeStatus, 'NONE'), or(eq(deliveryAttempts.disputeStatus, 'DISPUTED'), gte(deliveryAttempts.disputedAt, d30))))
        .groupBy(deliveryAttempts.disputeStatus),
      this.rto(d30, now),
      this.rto(d60, d30),
      this.db
        .select({ blocked: sql<number>`coalesce(sum(${customers.isBlocked}), 0)`.mapWith(Number), prepay: sql<number>`coalesce(sum(${customers.requirePrepayment}), 0)`.mapWith(Number) })
        .from(customers)
        .where(or(eq(customers.isBlocked, true), eq(customers.requirePrepayment, true))),
    ]);
    const conf = Object.fromEntries(confRows.map((r) => [r.status, n(r.n)])) as Partial<Record<ConfirmationStatus, number>>;
    const answered = (conf.CONFIRMED ?? 0) + (conf.RESCHEDULED ?? 0);
    const decided = answered + (conf.DECLINED ?? 0) + (conf.NO_RESPONSE ?? 0);
    const disputes = Object.fromEntries(disputeRows.map((r) => [r.status, n(r.n)])) as Partial<Record<AttemptDisputeStatus, number>>;
    return {
      settings: s,
      confirmations: {
        pending,
        noResponse,
        blockedForDispatch,
        last30: { requested: confRows.reduce((t, r) => t + n(r.n), 0), confirmed: conf.CONFIRMED ?? 0, rescheduled: conf.RESCHEDULED ?? 0, declined: conf.DECLINED ?? 0, noResponse: conf.NO_RESPONSE ?? 0, pending: conf.PENDING ?? 0 },
        confirmationRate: ratio(answered, decided),
      },
      holds: { total: holdRows.reduce((t, r) => t + n(r.n), 0), byReason: holdRows.map((r) => ({ reason: r.reason ?? 'MANUAL', count: n(r.n) })).sort((a, b) => b.count - a.count) },
      disputes: { open: disputes.DISPUTED ?? 0, upheld30: disputes.UPHELD ?? 0, rejected30: disputes.REJECTED ?? 0, confirmedByCustomer30: disputes.CONFIRMED_BY_CUSTOMER ?? 0 },
      rto: { last30: rtoNow, previous30: rtoPrev, change: rtoNow.rate != null && rtoPrev.rate != null ? Math.round((rtoNow.rate - rtoPrev.rate) * 1000) / 1000 : null },
      customers: { blocklisted: cust?.blocked ?? 0, prepayOnly: cust?.prepay ?? 0 },
    };
  }

  /** Return-to-origin rate of orders created in [from, to): returns / (delivered + returns). */
  private async rto(from: Date, to: Date) {
    const rows = await this.db
      .select({ status: orders.status, n: count() })
      .from(orders)
      .where(and(gte(orders.createdAt, from), lt(orders.createdAt, to), inArray(orders.status, ['DELIVERED', ...RTO])))
      .groupBy(orders.status);
    const delivered = n(rows.find((r) => r.status === 'DELIVERED')?.n);
    const returned = rows.filter((r) => RTO.includes(r.status)).reduce((t, r) => t + n(r.n), 0);
    return { delivered, returned, rate: ratio(returned, delivered + returned) };
  }

  // ------------------------------------------------------------------ heroes

  async heroes(q: HeroIntegrityQuery) {
    const s = await this.holds.config();
    const since = new Date(Date.now() - (q.days ?? 30) * DAY);
    const rows = await this.db
      .select({
        courierId: deliveryAttempts.courierId,
        deliveries: sql<number>`sum(case when ${deliveryAttempts.success} then 1 else 0 end)`.mapWith(Number),
        failures: sql<number>`sum(case when ${deliveryAttempts.success} then 0 else 1 end)`.mapWith(Number),
        avgDistance: sql<number | null>`avg(case when ${deliveryAttempts.success} then null else ${deliveryAttempts.distanceMeters} end)`,
        withDistance: sql<number>`sum(case when not ${deliveryAttempts.success} and ${deliveryAttempts.distanceMeters} is not null then 1 else 0 end)`.mapWith(Number),
        far: sql<number>`sum(case when not ${deliveryAttempts.success} and ${deliveryAttempts.distanceMeters} > ${s.failedAttemptGeofenceMeters} then 1 else 0 end)`.mapWith(Number),
        calls: sql<number>`sum(case when ${deliveryAttempts.success} then 0 else ${deliveryAttempts.callCount} end)`.mapWith(Number),
        noCall: sql<number>`sum(case when not ${deliveryAttempts.success} and ${deliveryAttempts.callCount} = 0 then 1 else 0 end)`.mapWith(Number),
        disputes: sql<number>`sum(case when ${deliveryAttempts.disputeStatus} in ('DISPUTED','UPHELD','REJECTED') then 1 else 0 end)`.mapWith(Number),
        open: sql<number>`sum(case when ${deliveryAttempts.disputeStatus} = 'DISPUTED' then 1 else 0 end)`.mapWith(Number),
        upheld: sql<number>`sum(case when ${deliveryAttempts.disputeStatus} = 'UPHELD' then 1 else 0 end)`.mapWith(Number),
        confirmed: sql<number>`sum(case when ${deliveryAttempts.disputeStatus} = 'CONFIRMED_BY_CUSTOMER' then 1 else 0 end)`.mapWith(Number),
      })
      .from(deliveryAttempts)
      .where(gte(deliveryAttempts.createdAt, since))
      .groupBy(deliveryAttempts.courierId);
    const heroes = await this.db
      .select({ id: couriers.id, code: couriers.code, name: users.name, status: couriers.status, rating: couriers.rating })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(inArray(couriers.id, rows.length ? rows.map((r) => r.courierId) : ['-']));
    const byId = new Map(heroes.map((h) => [h.id, h]));
    const data = rows
      .filter((r) => byId.has(r.courierId))
      .map((r) => {
        const failures = n(r.failures);
        const deliveries = n(r.deliveries);
        const decided = n(r.upheld) + Math.max(0, n(r.disputes) - n(r.upheld) - n(r.open));
        const score = failures === 0
          ? 100
          : Math.round(Math.max(0, Math.min(100,
              100 - 40 * (n(r.upheld) / failures) - 15 * (n(r.open) / failures) - 20 * (n(r.noCall) / failures) - 25 * (n(r.withDistance) ? n(r.far) / n(r.withDistance) : 0))));
        return {
          courier: byId.get(r.courierId)!,
          deliveries,
          failedAttempts: failures,
          failureRate: ratio(failures, failures + deliveries),
          avgDistanceAtFailureMeters: r.avgDistance == null ? null : Math.round(Number(r.avgDistance)),
          farFailures: n(r.far),
          callsPerFailure: failures ? Math.round((n(r.calls) / failures) * 10) / 10 : null,
          failuresWithoutCalls: n(r.noCall),
          disputes: n(r.disputes),
          openDisputes: n(r.open),
          upheld: n(r.upheld),
          upheldRate: ratio(n(r.upheld), decided),
          confirmedByCustomer: n(r.confirmed),
          integrityScore: score,
        };
      })
      .sort((a, b) => a.integrityScore - b.integrityScore || b.failedAttempts - a.failedAttempts);
    return { days: q.days ?? 30, geofenceMeters: s.failedAttemptGeofenceMeters, data };
  }

  // ------------------------------------------------------------------ network risk

  /** Phones that refused / declined COD across at least two brands (+ the blocklist). */
  async networkRisk(q: NetworkRiskQuery) {
    const phone = q.q ? normalizeEgyptPhone(q.q) : null;
    const term = q.q && !phone ? `%${likeEscape(q.q.trim())}%` : null;
    const customerFilter = phone ? or(eq(customers.phone, phone), eq(customers.altPhone, phone)) : term ? or(like(customers.name, term), like(customers.phone, term)) : undefined;
    if (q.scope === 'blocked') {
      const where = and(or(eq(customers.isBlocked, true), eq(customers.requirePrepayment, true)), customerFilter);
      const [rows, [{ total }]] = await Promise.all([
        this.db.select().from(customers).where(where).orderBy(desc(customers.blockedAt), desc(customers.updatedAt)).limit(q.pageSize).offset(offsetOf(q)),
        this.db.select({ total: count() }).from(customers).where(where),
      ]);
      return paginate(rows.map((c) => ({ customer: c, refusalBrands: null, refusals: null, declines: null })), n(total), q);
    }
    const [refusals, declines] = await Promise.all([
      this.db
        .select({ customerId: orders.customerId, brandId: orders.brandId, n: count() })
        .from(deliveryAttempts)
        .innerJoin(orders, eq(orders.id, deliveryAttempts.orderId))
        .where(eq(deliveryAttempts.failureReason, 'CUSTOMER_REFUSED'))
        .groupBy(orders.customerId, orders.brandId),
      this.db.select({ customerId: orders.customerId, brandId: orders.brandId, n: count() }).from(orders).where(eq(orders.confirmationStatus, 'DECLINED')).groupBy(orders.customerId, orders.brandId),
    ]);
    const agg = new Map<string, { brands: Set<string>; refusals: number; declines: number }>();
    for (const [rows, key] of [[refusals, 'refusals'], [declines, 'declines']] as const) {
      for (const r of rows) {
        const a = agg.get(r.customerId) ?? { brands: new Set<string>(), refusals: 0, declines: 0 };
        a.brands.add(r.brandId);
        a[key] += n(r.n);
        agg.set(r.customerId, a);
      }
    }
    const minBrands = q.minBrands ?? 2;
    const risky = [...agg.entries()].filter(([, a]) => a.brands.size >= minBrands);
    const custs = await loadByIds(this.db, customers, customers.id, risky.map(([id]) => id));
    let list = risky
      .map(([id, a]) => ({ customer: custs.get(id)!, refusalBrands: a.brands.size, refusals: a.refusals, declines: a.declines }))
      .filter((r) => !!r.customer);
    if (phone) list = list.filter((r) => r.customer.phone === phone || r.customer.altPhone === phone);
    else if (q.q) {
      const t = q.q.trim().toLowerCase();
      list = list.filter((r) => r.customer.name.toLowerCase().includes(t) || r.customer.phone.includes(t));
    }
    list.sort((a, b) => b.refusalBrands - a.refusalBrands || b.refusals + b.declines - (a.refusals + a.declines));
    return paginate(list.slice(offsetOf(q), offsetOf(q) + q.pageSize), list.length, q);
  }

  // ------------------------------------------------------------------ lists

  async holdsList(q: HoldsQuery) {
    const where = and(eq(orders.status, 'ON_HOLD'), q.reason ? eq(orders.holdReason, q.reason) : undefined, this.search(q.q));
    const [rows, [{ total }]] = await Promise.all([
      this.orderRows(where, q, desc(orders.updatedAt)),
      this.db.select({ total: count() }).from(orders).innerJoin(customers, eq(customers.id, orders.customerId)).where(where),
    ]);
    return paginate(rows, n(total), q);
  }

  async confirmationsList(q: ConfirmationsQuery) {
    const s = await this.holds.config();
    const statuses = q.status ? [q.status] : (['PENDING', 'NO_RESPONSE'] as ConfirmationStatus[]);
    const where = and(inArray(orders.confirmationStatus, statuses), ACTIVE, this.search(q.q));
    const [rows, [{ total }]] = await Promise.all([
      this.orderRows(where, q, asc(orders.confirmationRequestedAt)),
      this.db.select({ total: count() }).from(orders).innerJoin(customers, eq(customers.id, orders.customerId)).where(where),
    ]);
    return { ...paginate(rows.map((r) => ({ ...r, blocksDispatch: r.riskScore >= s.holdUnconfirmedAboveRisk })), n(total), q), holdThreshold: s.holdUnconfirmedAboveRisk };
  }

  private search(q?: string): SQL | undefined {
    if (!q?.trim()) return undefined;
    const phone = normalizeEgyptPhone(q);
    if (phone) return or(eq(orders.recipientPhone, phone), eq(orders.recipientAltPhone, phone));
    const term = `%${likeEscape(q.trim())}%`;
    return or(like(orders.trackingNumber, term), like(orders.recipientName, term), like(orders.brandReference, term));
  }

  private async orderRows(where: SQL | undefined, q: { page: number; pageSize: number }, order: SQL) {
    const rows = await this.db
      .select({
        id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, holdReason: orders.holdReason, confirmationStatus: orders.confirmationStatus,
        confirmationRequestedAt: orders.confirmationRequestedAt, confirmationRespondedAt: orders.confirmationRespondedAt, confirmationChannel: orders.confirmationChannel,
        riskScore: orders.riskScore, paymentMethod: orders.paymentMethod, codAmountCents: orders.codAmountCents, collectCents: orders.collectCents,
        recipientName: orders.recipientName, recipientPhone: orders.recipientPhone, scheduledDate: orders.scheduledDate, createdAt: orders.createdAt, updatedAt: orders.updatedAt, metadata: orders.metadata,
        brand: { id: brands.id, name: brands.name, code: brands.code },
        zone: { id: zones.id, code: zones.code, nameEn: zones.nameEn, nameAr: zones.nameAr },
        customer: { id: customers.id, isBlocked: customers.isBlocked, requirePrepayment: customers.requirePrepayment, reliabilityScore: customers.reliabilityScore },
      })
      .from(orders)
      .innerJoin(brands, eq(brands.id, orders.brandId))
      .innerJoin(zones, eq(zones.id, orders.zoneId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .orderBy(order, desc(orders.id))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    return rows.map(({ metadata, ...r }) => {
      const meta = integrityMetaOf(metadata);
      return { ...r, heldAt: meta.heldAt ?? null, holdFrom: meta.holdFrom ?? null, override: meta.override ?? null };
    });
  }

  async disputes(q: DisputesQuery) {
    const s = await this.holds.config();
    const statuses: AttemptDisputeStatus[] = q.status ? [q.status] : ['DISPUTED'];
    const where = inArray(deliveryAttempts.disputeStatus, statuses);
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          attempt: deliveryAttempts,
          order: {
            id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, lat: orders.lat, lng: orders.lng, addressLine: orders.addressLine,
            recipientName: orders.recipientName, recipientPhone: orders.recipientPhone, brandId: orders.brandId,
          },
          hero: { id: couriers.id, code: couriers.code, name: users.name },
          brandName: brands.name,
        })
        .from(deliveryAttempts)
        .innerJoin(orders, eq(orders.id, deliveryAttempts.orderId))
        .innerJoin(brands, eq(brands.id, orders.brandId))
        .innerJoin(couriers, eq(couriers.id, deliveryAttempts.courierId))
        .innerJoin(users, eq(users.id, couriers.userId))
        .where(where)
        .orderBy(desc(deliveryAttempts.disputedAt), desc(deliveryAttempts.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ total: count() }).from(deliveryAttempts).where(where),
    ]);
    const orderIds = rows.map((r) => r.order.id);
    const [calls, ticketRows] = orderIds.length
      ? await Promise.all([
          this.db.select().from(callLogs).where(inArray(callLogs.orderId, orderIds)).orderBy(asc(callLogs.startedAt)),
          this.db.select({ id: tickets.id, code: tickets.code, orderId: tickets.orderId, status: tickets.status }).from(tickets).where(and(inArray(tickets.orderId, orderIds), eq(tickets.category, 'ATTEMPT_DISPUTE'))).orderBy(desc(tickets.createdAt)),
        ])
      : [[], []];
    return {
      ...paginate(
        rows.map((r) => {
          const a = r.attempt;
          const windowStart = a.createdAt.getTime() - 3 * 3_600_000;
          return {
            attemptId: a.id,
            attemptNo: a.attemptNo,
            failureReason: a.failureReason,
            note: a.note,
            photoUrl: a.photoUrl,
            at: a.createdAt,
            heroPosition: a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null,
            distanceMeters: a.distanceMeters,
            withinGeofence: a.distanceMeters == null ? null : a.distanceMeters <= s.failedAttemptGeofenceMeters,
            callCount: a.callCount,
            disputeStatus: a.disputeStatus,
            disputedAt: a.disputedAt,
            customerNote: a.disputeNote,
            order: { ...r.order, destination: r.order.lat != null && r.order.lng != null ? { lat: r.order.lat, lng: r.order.lng } : null, brandName: r.brandName },
            hero: r.hero,
            calls: calls
              .filter((c) => c.orderId === r.order.id && c.courierId === a.courierId && c.startedAt.getTime() >= windowStart && c.startedAt.getTime() <= a.createdAt.getTime() + 60_000)
              .map((c) => ({ id: c.id, status: c.status, provider: c.provider, durationSeconds: c.durationSeconds, startedAt: c.startedAt })),
            ticket: ticketRows.find((t) => t.orderId === r.order.id) ?? null,
          };
        }),
        n(total),
        q,
      ),
      geofenceMeters: s.failedAttemptGeofenceMeters,
    };
  }

  // ------------------------------------------------------------------ one order

  /** Integrity view of one order. Brands get their own orders without hero / call evidence. */
  async order(id: string, p: Principal) {
    const scope = brandScope(p);
    const [o] = await this.db.select().from(orders).where(scope ? and(eq(orders.id, id), eq(orders.brandId, scope)) : eq(orders.id, id)).limit(1);
    if (!o) throw notFound('Order', id);
    const s = await this.holds.config();
    const meta = integrityMetaOf(o.metadata);
    const blocker = this.holds.blockerFor(o, s);
    const [attempts, history] = await Promise.all([
      this.db.select().from(deliveryAttempts).where(eq(deliveryAttempts.orderId, id)).orderBy(asc(deliveryAttempts.attemptNo), asc(deliveryAttempts.createdAt)),
      this.db
        .select({ reason: orderEvents.reason, note: orderEvents.note, status: orderEvents.status, actorType: orderEvents.actorType, actorName: orderEvents.actorName, createdAt: orderEvents.createdAt })
        .from(orderEvents)
        .where(and(eq(orderEvents.orderId, id), or(inArray(orderEvents.reason, CONFIRMATION_REASONS), and(eq(orderEvents.status, 'ON_HOLD'), sql`${orderEvents.fromStatus} <> 'ON_HOLD'`))))
        .orderBy(asc(orderEvents.createdAt)),
    ]);
    const base = {
      orderId: o.id,
      trackingNumber: o.trackingNumber,
      status: o.status,
      riskScore: o.riskScore,
      confirmation: { status: o.confirmationStatus, requestedAt: o.confirmationRequestedAt, respondedAt: o.confirmationRespondedAt, channel: o.confirmationChannel },
      hold: o.status === 'ON_HOLD' ? { reason: o.holdReason, since: meta.heldAt ?? null, from: meta.holdFrom ?? null } : null,
      dispatchBlocked: blocker ? { code: blocker.code, message: blocker.message, ...blocker.details } : null,
      override: meta.override ? { at: meta.override.at, reason: meta.override.reason, byName: meta.override.byName } : null,
      paymentMethod: o.paymentMethod,
      hasPin: o.lat != null && o.lng != null,
    };
    if (scope) {
      return {
        ...base,
        history: history.filter((h) => h.reason?.startsWith('CONFIRMATION') || h.reason === 'CUSTOMER_RESCHEDULED' || h.status === 'ON_HOLD').map(({ actorName: _a, ...h }) => h),
        attempts: attempts.filter((a) => !a.success).map((a) => ({ attemptNo: a.attemptNo, failureReason: a.failureReason, at: a.createdAt, disputeStatus: a.disputeStatus })),
      };
    }
    const calls = await this.db
      .select({ c: callLogs, heroName: users.name, heroCode: couriers.code })
      .from(callLogs)
      .innerJoin(couriers, eq(couriers.id, callLogs.courierId))
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(eq(callLogs.orderId, id))
      .orderBy(desc(callLogs.startedAt))
      .limit(100);
    const heroIds = [...new Set(attempts.map((a) => a.courierId))];
    const heroRows = heroIds.length
      ? await this.db.select({ id: couriers.id, code: couriers.code, name: users.name }).from(couriers).innerJoin(users, eq(users.id, couriers.userId)).where(inArray(couriers.id, heroIds))
      : [];
    const heroMap = new Map(heroRows.map((h) => [h.id, h]));
    const [address] = o.customerAddressId
      ? await this.db
          .select({ id: customerAddresses.id, isVerified: customerAddresses.isVerified, source: customerAddresses.source, deliveredCount: customerAddresses.deliveredCount, usageCount: customerAddresses.usageCount })
          .from(customerAddresses)
          .where(eq(customerAddresses.id, o.customerAddressId))
          .limit(1)
      : [];
    return {
      ...base,
      geofenceMeters: s.failedAttemptGeofenceMeters,
      destination: o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : null,
      approximate: (o.metadata as { geocode?: { lat: number; lng: number; provider: string; confidence: number } } | null)?.geocode ?? null,
      address: address ?? null,
      history,
      attempts: attempts.map((a) => ({
        id: a.id,
        attemptNo: a.attemptNo,
        success: a.success,
        failureReason: a.failureReason,
        note: a.note,
        at: a.createdAt,
        hero: heroMap.get(a.courierId) ?? { id: a.courierId, code: null, name: null },
        position: a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null,
        distanceMeters: a.distanceMeters ?? (a.lat != null && a.lng != null && o.lat != null && o.lng != null ? distanceMeters({ lat: a.lat, lng: a.lng }, { lat: o.lat, lng: o.lng }) : null),
        withinGeofence: a.distanceMeters == null ? null : a.distanceMeters <= s.failedAttemptGeofenceMeters,
        callCount: a.callCount,
        disputeStatus: a.disputeStatus,
        disputedAt: a.disputedAt,
        disputeNote: a.disputeNote,
      })),
      calls: calls.map(({ c, heroName, heroCode }) => ({ id: c.id, status: c.status, provider: c.provider, durationSeconds: c.durationSeconds, startedAt: c.startedAt, endedAt: c.endedAt, hero: { id: c.courierId, name: heroName, code: heroCode } })),
    };
  }
}
