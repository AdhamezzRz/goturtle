import { randomInt } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { generateTrackingNumber, type EmploymentType, type OrderStatus } from '@goturtle/shared';
import { brands, couriers, customers, deliveryAttempts, hubs, orders, users, zones } from '../src/db/schema';
import { PostingsService } from '../src/core/ledger/postings.service';
import { LedgerService } from '../src/core/ledger/ledger.service';
import { DomainEvents, type OrderStatusChangedEvent } from '../src/core/events';
import { hashPassword } from '../src/modules/auth/auth.service';
import { DEMO_PASSWORD, type TestContext } from './helpers';

/**
 * Factories for workforce & finance tests. The orders module is built in
 * parallel, so orders are inserted directly and their money is posted through
 * the real PostingsService — exactly what the orders module does on delivery.
 */

export type OrderRow = typeof orders.$inferSelect;
export type CourierRow = typeof couriers.$inferSelect;

let seq = 0;
const unique = () => `${Date.now().toString(36).slice(-5)}${(seq++).toString(36)}${randomInt(36 ** 2).toString(36)}`.toUpperCase();
export const randomPhone = () => `+2015${String(randomInt(10 ** 8)).padStart(8, '0')}`;

export async function heroByCode(t: TestContext, code: string): Promise<CourierRow> {
  const [c] = await t.db.select().from(couriers).where(eq(couriers.code, code)).limit(1);
  if (!c) throw new Error(`hero ${code} not seeded`);
  return c;
}

export async function reloadHero(t: TestContext, id: string): Promise<CourierRow> {
  const [c] = await t.db.select().from(couriers).where(eq(couriers.id, id)).limit(1);
  return c;
}

export async function brandByCode(t: TestContext, code: string) {
  const [b] = await t.db.select().from(brands).where(eq(brands.code, code)).limit(1);
  if (!b) throw new Error(`brand ${code} not seeded`);
  return b;
}

export async function hubByCode(t: TestContext, code: string) {
  const [h] = await t.db.select().from(hubs).where(eq(hubs.code, code)).limit(1);
  return h;
}

export async function zoneByCode(t: TestContext, code: string) {
  const [z] = await t.db.select().from(zones).where(eq(zones.code, code)).limit(1);
  return z;
}

/** A logged-in supertest builder for any phone/password (fresh heroes and brand owners). */
export async function loginWith(t: TestContext, identifier: string, password = DEMO_PASSWORD) {
  const res = await t.http().post('/api/v1/auth/login').send({ identifier, password });
  if (res.status !== 200) throw new Error(`login ${identifier} failed: ${res.status} ${JSON.stringify(res.body)}`);
  const token = res.body.accessToken as string;
  const server = t.app.getHttpServer();
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    user: res.body.user,
    get: (url: string) => auth(request(server).get(url)),
    post: (url: string) => auth(request(server).post(url)),
    patch: (url: string) => auth(request(server).patch(url)),
  };
}

/** An isolated active hero (own ledger accounts) with a known password. */
export async function createHero(
  t: TestContext,
  opts: { employmentType?: EmploymentType; hubCode?: string; hourlyRateCents?: number; monthlySalaryCents?: number; perDeliveryRateCents?: number; cashLimitCents?: number; status?: CourierRow['status'] } = {},
) {
  const phone = randomPhone();
  const type = opts.employmentType ?? 'FREELANCE';
  const hub = await hubByCode(t, opts.hubCode ?? 'HUB-NSR');
  const [u] = await t.db.insert(users).values({ name: `Test Hero ${unique()}`, phone, role: 'COURIER', passwordHash: await hashPassword(DEMO_PASSWORD) }).$returningId();
  const [c] = await t.db
    .insert(couriers)
    .values({
      userId: u.id, code: `TH-${unique()}`.slice(0, 20), employmentType: type, status: opts.status ?? 'ACTIVE', homeHubId: hub.id,
      perDeliveryRateCents: opts.perDeliveryRateCents ?? (type === 'FREELANCE' ? 2200 : 500), perPickupRateCents: 500, failedAttemptRateCents: 700,
      hourlyRateCents: opts.hourlyRateCents ?? (type === 'SHIFT' ? 4500 : 0), monthlySalaryCents: opts.monthlySalaryCents ?? (type === 'FULL_TIME' ? 900000 : 0),
      cashLimitCents: opts.cashLimitCents ?? 600000,
    })
    .$returningId();
  return { ...(await reloadHero(t, c.id)), phone };
}

/** An isolated active brand with an owner login. */
export async function createBrand(t: TestContext, opts: { cycle?: (typeof brands.$inferSelect)['settlementCycle'] } = {}) {
  const code = `T${unique()}`.slice(0, 12);
  const ownerPhone = randomPhone();
  const [b] = await t.db
    .insert(brands)
    .values({ code, name: `Test Brand ${code}`, phone: randomPhone(), status: 'ACTIVE', settlementCycle: opts.cycle ?? 'MONTHLY', payoutMethod: 'INSTAPAY' })
    .$returningId();
  await t.db.insert(users).values({ name: `Owner ${code}`, phone: ownerPhone, role: 'BRAND_OWNER', brandId: b.id, passwordHash: await hashPassword(DEMO_PASSWORD) });
  const [brand] = await t.db.select().from(brands).where(eq(brands.id, b.id)).limit(1);
  return { ...brand, ownerPhone };
}

async function customerId(t: TestContext): Promise<string> {
  const phone = randomPhone();
  const [c] = await t.db.insert(customers).values({ phone, name: 'Test Customer' }).$returningId();
  return c.id;
}

/** Fees like the rate card: shipping 55 EGP, COD fee 1 % (min 5 EGP), VAT 14 %. */
export function feesFor(codCents: number, shippingFeeCents = 5500) {
  const codFeeCents = codCents > 0 ? Math.max(500, Math.round(codCents / 100)) : 0;
  const vatCents = Math.round(((shippingFeeCents + codFeeCents) * 1400) / 10_000);
  return { shippingFeeCents, codFeeCents, extraFeesCents: 0, vatCents, totalFeesCents: shippingFeeCents + codFeeCents + vatCents };
}

interface OrderOpts {
  brandId: string;
  courierId?: string | null;
  codCents?: number;
  status?: OrderStatus;
  deliveredAt?: Date;
  promisedBy?: Date | null;
  outForDeliveryAt?: Date;
}

async function insertOrder(t: TestContext, o: OrderOpts & { status: OrderStatus; collectedCents?: number; returnedAt?: Date | null; attempts?: number }): Promise<OrderRow> {
  const zone = await zoneByCode(t, 'CAI-NASR');
  const cod = o.codCents ?? 0;
  const fees = feesFor(cod);
  const [row] = await t.db
    .insert(orders)
    .values({
      trackingNumber: generateTrackingNumber(), brandId: o.brandId, status: o.status, customerId: await customerId(t), recipientName: 'Test Recipient',
      recipientPhone: randomPhone(), addressLine: '1 Abbas El Akkad, Nasr City', zoneId: zone.id, courierId: o.courierId ?? null,
      paymentMethod: cod > 0 ? 'COD' : 'PREPAID', codAmountCents: cod, collectCents: cod, collectedCents: o.collectedCents ?? 0, ...fees,
      attempts: o.attempts ?? 1, promisedBy: o.promisedBy ?? null, outForDeliveryAt: o.outForDeliveryAt ?? null,
      deliveredAt: o.status === 'DELIVERED' ? o.deliveredAt ?? new Date() : null, returnedAt: o.returnedAt ?? null,
    })
    .$returningId();
  const [order] = await t.db.select().from(orders).where(eq(orders.id, row.id)).limit(1);
  return order;
}

/** A DELIVERED order collected by the hero, posted with PostingsService.orderDelivered (custody, wallet, fees, earning). */
export async function deliverOrder(t: TestContext, o: OrderOpts): Promise<OrderRow> {
  const deliveredAt = o.deliveredAt ?? new Date();
  const order = await insertOrder(t, {
    ...o, status: 'DELIVERED', collectedCents: o.codCents ?? 0, deliveredAt,
    outForDeliveryAt: o.outForDeliveryAt ?? new Date(deliveredAt.getTime() - 45 * 60_000),
  });
  const postings = t.app.get(PostingsService);
  const ledger = t.app.get(LedgerService);
  await t.db.transaction(async (tx) => {
    const [courier] = o.courierId ? await ledger.lockCouriers(tx, [o.courierId]) : [null];
    await postings.orderDelivered(tx, order, courier ?? null);
    if (o.courierId) await tx.insert(deliveryAttempts).values({ orderId: order.id, courierId: o.courierId, attemptNo: 1, success: true, createdAt: deliveredAt });
  });
  return order;
}

/** A RETURNED order: shipping fee (no COD fee) + return fee charged to the brand. */
export async function returnOrder(t: TestContext, o: OrderOpts & { returnFeeCents?: number }): Promise<OrderRow> {
  const order = await insertOrder(t, { ...o, status: 'RETURNED', returnedAt: new Date(), collectedCents: 0 });
  const fee = o.returnFeeCents ?? 2750;
  await t.db.transaction(async (tx) => {
    await t.app.get(PostingsService).orderReturned(tx, order, fee, Math.round(fee * 0.14));
  });
  return order;
}

/** A failed attempt by the hero (attempt row + attempt earning). */
export async function failAttempt(t: TestContext, o: OrderOpts): Promise<OrderRow> {
  const order = await insertOrder(t, { ...o, status: 'FAILED_ATTEMPT', attempts: 1 });
  await t.db.transaction(async (tx) => {
    const [courier] = await t.app.get(LedgerService).lockCouriers(tx, [o.courierId!]);
    await tx.insert(deliveryAttempts).values({ orderId: order.id, courierId: o.courierId!, attemptNo: 1, success: false, failureReason: 'CUSTOMER_UNREACHABLE' });
    await t.app.get(PostingsService).failedAttemptEarning(tx, order, courier, 1);
  });
  return order;
}

export function emitStatus(t: TestContext, order: OrderRow, to: OrderStatus, from: OrderStatus | null = 'OUT_FOR_DELIVERY') {
  t.app.get(EventEmitter2).emit(DomainEvents.OrderStatusChanged, {
    orderId: order.id, trackingNumber: order.trackingNumber, brandId: order.brandId, courierId: order.courierId, from, to, actorType: 'COURIER', at: new Date(),
  } satisfies OrderStatusChangedEvent);
}

/** Polls until `check` returns a truthy value (async listeners). */
export async function eventually<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > until) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 50));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function assertBalanced(t: TestContext) {
  const tb = await t.app.get(LedgerService).trialBalance();
  expect(tb.balanced).toBe(true);
  return tb;
}
