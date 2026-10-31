import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';
import { normalizeEgyptPhone, reliabilityScore } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brands, customers, orders, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { DomainError, notFound } from '../../common/errors';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { offsetOf, paginate } from '../../common/pagination';
import { likeEscape, whereAll } from '../../db/helpers';
import { newId } from '../../db/columns';
import type { CustomerListQuery } from './customers.dto';

export type CustomerRow = typeof customers.$inferSelect;

const SORTS = {
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
  name: customers.name,
  totalOrders: customers.totalOrders,
  deliveredOrders: customers.deliveredOrders,
  refusedOrders: customers.refusedOrders,
  reliabilityScore: customers.reliabilityScore,
} as const;

export const reliabilityLevel = (score: number) => (score >= 75 ? 'GOOD' : score >= 50 ? 'FAIR' : 'POOR');

/**
 * Consignees (customers), keyed by their normalised phone. Counters are
 * maintained by the order workflow through the helpers below.
 */
@Injectable()
export class CustomersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------- staff views

  async list(q: CustomerListQuery) {
    const conds = [];
    if (q.q) {
      const phone = normalizeEgyptPhone(q.q);
      const term = `%${likeEscape(q.q.trim())}%`;
      conds.push(phone ? or(eq(customers.phone, phone), eq(customers.altPhone, phone)) : or(like(customers.name, term), like(customers.phone, term), like(customers.email, term)));
    }
    if (q.isBlocked !== undefined) conds.push(eq(customers.isBlocked, q.isBlocked));
    if (q.minReliability !== undefined) conds.push(gte(customers.reliabilityScore, q.minReliability));
    if (q.maxReliability !== undefined) conds.push(lte(customers.reliabilityScore, q.maxReliability));
    const where = whereAll(...conds);
    const col = SORTS[q.sort ?? 'createdAt'];
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select()
        .from(customers)
        .where(where)
        .orderBy(q.order === 'asc' ? asc(col) : desc(col), desc(customers.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(customers).where(where),
    ]);
    return paginate(rows.map((c) => ({ ...c, reliabilityLevel: reliabilityLevel(c.reliabilityScore) })), Number(n), q);
  }

  async detail(id: string) {
    const customer = await this.get(id);
    const [byStatus, [money], recent, brandRows] = await Promise.all([
      this.db.select({ status: orders.status, n: count() }).from(orders).where(eq(orders.customerId, id)).groupBy(orders.status),
      this.db
        .select({
          collectedCents: sql<number>`coalesce(sum(case when ${orders.status} = 'DELIVERED' then ${orders.collectedCents} else 0 end), 0)`.mapWith(Number),
          avgCodCents: sql<number>`coalesce(round(avg(${orders.codAmountCents})), 0)`.mapWith(Number),
          firstOrderAt: sql<Date | null>`min(${orders.createdAt})`,
          lastOrderAt: sql<Date | null>`max(${orders.createdAt})`,
          failedAttempts: sql<number>`coalesce(sum(${orders.attempts}), 0)`.mapWith(Number),
        })
        .from(orders)
        .where(eq(orders.customerId, id)),
      this.db
        .select({
          id: orders.id,
          trackingNumber: orders.trackingNumber,
          status: orders.status,
          type: orders.type,
          paymentMethod: orders.paymentMethod,
          codAmountCents: orders.codAmountCents,
          collectCents: orders.collectCents,
          attempts: orders.attempts,
          addressLine: orders.addressLine,
          createdAt: orders.createdAt,
          deliveredAt: orders.deliveredAt,
          rating: orders.rating,
          brand: { id: brands.id, code: brands.code, name: brands.name },
          zone: { id: zones.id, code: zones.code, nameEn: zones.nameEn, nameAr: zones.nameAr },
        })
        .from(orders)
        .innerJoin(brands, eq(brands.id, orders.brandId))
        .innerJoin(zones, eq(zones.id, orders.zoneId))
        .where(eq(orders.customerId, id))
        .orderBy(desc(orders.createdAt))
        .limit(20),
      this.db.select({ brandId: orders.brandId, n: count() }).from(orders).where(eq(orders.customerId, id)).groupBy(orders.brandId),
    ]);
    const statusCounts = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
    const sum = (...keys: string[]) => keys.reduce((s, k) => s + (statusCounts[k] ?? 0), 0);
    const completed = customer.deliveredOrders + customer.refusedOrders;
    return {
      ...customer,
      reliabilityLevel: reliabilityLevel(customer.reliabilityScore),
      stats: {
        totalOrders: customer.totalOrders,
        delivered: customer.deliveredOrders,
        refused: customer.refusedOrders,
        returned: sum('RETURNED', 'RETURN_PENDING', 'RETURN_OUT'),
        cancelled: sum('CANCELLED'),
        active: sum('CREATED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED', 'ON_HOLD'),
        byStatus: statusCounts,
        successRate: completed ? Math.round((customer.deliveredOrders / completed) * 1000) / 10 : null,
        collectedCents: money?.collectedCents ?? 0,
        avgCodCents: money?.avgCodCents ?? 0,
        failedAttempts: money?.failedAttempts ?? 0,
        brandsCount: brandRows.length,
        firstOrderAt: money?.firstOrderAt ?? null,
        lastOrderAt: money?.lastOrderAt ?? null,
      },
      recentOrders: recent,
    };
  }

  async get(id: string, db: DbOrTx = this.db): Promise<CustomerRow> {
    const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (!row) throw notFound('Customer', id);
    return row;
  }

  async setBlocked(id: string, blocked: boolean, reason: string | undefined, p: Principal, meta: RequestMetaInfo) {
    const before = await this.get(id);
    if (before.isBlocked === blocked) {
      throw new DomainError(blocked ? 'ALREADY_BLOCKED' : 'NOT_BLOCKED', blocked ? 'Customer is already blocked' : 'Customer is not blocked', HttpStatus.CONFLICT);
    }
    await this.db.update(customers).set({ isBlocked: blocked }).where(eq(customers.id, id));
    await this.audit.record(
      p,
      { action: blocked ? 'customer.block' : 'customer.unblock', entity: 'Customer', entityId: id, before: { isBlocked: before.isBlocked }, after: { isBlocked: blocked, reason: reason ?? null } },
      meta,
    );
    return this.detail(id);
  }

  // ----------------------------------------------------------- workflow helpers

  /**
   * Finds or creates the customer behind a phone and counts one more order.
   * Returns the row as it was BEFORE this order (for risk scoring) plus its id.
   */
  async upsertForOrder(tx: DbOrTx, input: { phone: string; name: string; altPhone?: string | null }): Promise<{ row: CustomerRow; created: boolean }> {
    const [existing] = await tx.select().from(customers).where(eq(customers.phone, input.phone)).for('update').limit(1);
    if (existing) {
      await tx
        .update(customers)
        .set({ totalOrders: sql`${customers.totalOrders} + 1`, ...(input.altPhone && !existing.altPhone ? { altPhone: input.altPhone } : {}) })
        .where(eq(customers.id, existing.id));
      return { row: existing, created: false };
    }
    const id = newId();
    await tx
      .insert(customers)
      .values({ id, phone: input.phone, name: input.name.slice(0, 150), altPhone: input.altPhone ?? null, totalOrders: 1 })
      // A concurrent order for the same new phone may win the insert race.
      .onDuplicateKeyUpdate({ set: { totalOrders: sql`${customers.totalOrders} + 1` } });
    const [row] = await tx.select().from(customers).where(eq(customers.phone, input.phone)).limit(1);
    const created = row.id === id;
    return { row: created ? { ...row, totalOrders: 0 } : { ...row, totalOrders: row.totalOrders - 1 }, created };
  }

  /** Un-counts an order (its recipient phone moved to another customer). */
  async forgetOrder(tx: DbOrTx, customerId: string) {
    await tx.update(customers).set({ totalOrders: sql`greatest(${customers.totalOrders} - 1, 0)` }).where(eq(customers.id, customerId));
  }

  async recordDelivered(tx: DbOrTx, customerId: string) {
    await tx.update(customers).set({ deliveredOrders: sql`${customers.deliveredOrders} + 1` }).where(eq(customers.id, customerId));
    await this.recomputeReliability(tx, customerId);
  }

  async recordRefused(tx: DbOrTx, customerId: string) {
    await tx.update(customers).set({ refusedOrders: sql`${customers.refusedOrders} + 1` }).where(eq(customers.id, customerId));
    await this.recomputeReliability(tx, customerId);
  }

  async recomputeReliability(tx: DbOrTx, customerId: string) {
    const [c] = await tx.select({ d: customers.deliveredOrders, r: customers.refusedOrders }).from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!c) return;
    await tx.update(customers).set({ reliabilityScore: reliabilityScore(c.d, c.r) }).where(eq(customers.id, customerId));
  }

  /** Light lookup used by order screens (no stats). */
  async findByPhone(phone: string) {
    const e164 = normalizeEgyptPhone(phone);
    if (!e164) throw new DomainError('INVALID_PHONE', 'Enter a valid Egyptian mobile number', HttpStatus.BAD_REQUEST);
    const [row] = await this.db.select().from(customers).where(and(eq(customers.phone, e164))).limit(1);
    return row ? { ...row, reliabilityLevel: reliabilityLevel(row.reliabilityScore) } : null;
  }
}
