import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { generateTrackingNumber, type OrderStatus } from '@goturtle/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { config } from '../src/config';
import { DB } from '../src/core/database.module';
import type { Db } from '../src/db/client';
import { brands, couriers, customers, deliveryAttempts, orders, users, zones } from '../src/db/schema';
import { ORDER_INTAKE, type CreateOrderInput, type CreatedOrderRef, type OrderIntake } from '../src/modules/orders/orders.contract';
import type { ActorContext } from '../src/common/actor';
import { ACCOUNTS, type AccountName } from './helpers';

/** Test double for the Orders module's ORDER_INTAKE: records calls and inserts real order rows. */
export class FakeOrderIntake implements OrderIntake {
  db!: Db;
  readonly created: Array<{ input: CreateOrderInput; actor: ActorContext }> = [];
  readonly cancelled: Array<{ brandId: string; externalId: string; reason?: string }> = [];

  async create(input: CreateOrderInput, actor: ActorContext): Promise<CreatedOrderRef> {
    this.created.push({ input, actor });
    const id = await insertOrder(this.db, {
      brandId: input.brandId, brandReference: input.brandReference ?? null, source: input.source, externalId: input.externalId ?? null,
      recipientName: input.recipient.name, recipientPhone: input.recipient.phone, addressLine: input.address.line,
      codAmountCents: input.codAmountCents, paymentMethod: input.paymentMethod ?? 'COD', metadata: input.metadata ?? null,
    });
    const [o] = await this.db.select().from(orders).where(eq(orders.id, id));
    return { id, trackingNumber: o.trackingNumber, status: o.status, totalFeesCents: o.totalFeesCents, collectCents: o.collectCents, riskScore: 0 };
  }

  async cancelByExternalId(brandId: string, externalId: string, _actor: ActorContext, reason?: string): Promise<boolean> {
    this.cancelled.push({ brandId, externalId, reason });
    const [res] = (await this.db
      .update(orders)
      .set({ status: 'CANCELLED', cancelledAt: new Date() })
      .where(eq(orders.externalId, externalId))) as unknown as [{ affectedRows: number }];
    return res.affectedRows > 0;
  }
}

export interface PlatformTestContext {
  app: NestExpressApplication;
  db: Db;
  events: EventEmitter2;
  intake: FakeOrderIntake;
  http: () => ReturnType<typeof request>;
  login: (who: AccountName) => Promise<{ token: string; user: any }>;
  loginWith: (identifier: string, password: string) => Promise<string>;
  as: (who: AccountName | { token: string }) => Promise<{
    get: (url: string) => request.Test;
    post: (url: string) => request.Test;
    patch: (url: string) => request.Test;
    put: (url: string) => request.Test;
    delete: (url: string) => request.Test;
  }>;
  get: <T>(token: unknown) => T;
  close: () => Promise<void>;
}

/**
 * Like test/helpers createTestApp(), but with a fake ORDER_INTAKE (the real
 * one belongs to the Orders module). The fake is both provided globally and
 * used to override the token in case OrdersModule already provides it.
 */
export async function createPlatformTestApp(): Promise<PlatformTestContext> {
  const intake = new FakeOrderIntake();
  @Global()
  @Module({ providers: [{ provide: ORDER_INTAKE, useValue: intake }], exports: [ORDER_INTAKE] })
  class FakeIntakeModule {}

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, FakeIntakeModule] })
    .overrideProvider(ORDER_INTAKE)
    .useValue(intake)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configureApp(app);
  await app.init();
  const db = app.get<Db>(DB);
  intake.db = db;
  const server = app.getHttpServer();
  const tokens = new Map<AccountName, { token: string; user: any }>();

  // Seeded accounts get tokens minted directly (the login route is rate limited to 10/min);
  // real password logins are exercised with loginWith().
  const jwt = app.get(JwtService);
  const login = async (who: AccountName) => {
    const cached = tokens.get(who);
    if (cached) return cached;
    const [u] = await db.select().from(users).where(eq(users.phone, ACCOUNTS[who].identifier)).limit(1);
    if (!u) throw new Error(`account ${who} not seeded`);
    const token = await jwt.signAsync({ sub: u.id, typ: 'access', role: u.role }, { secret: config.jwt.accessSecret, expiresIn: '1h' });
    const out = { token, user: { id: u.id, role: u.role, brandId: u.brandId } };
    tokens.set(who, out);
    return out;
  };
  const loginWith = async (identifier: string, password: string) => {
    const res = await request(server).post('/api/v1/auth/login').send({ identifier, password });
    if (res.status !== 200) throw new Error(`login ${identifier} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.accessToken as string;
  };
  const as = async (who: AccountName | { token: string }) => {
    const token = typeof who === 'string' ? (await login(who)).token : who.token;
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string) => auth(request(server).post(url)),
      patch: (url: string) => auth(request(server).patch(url)),
      put: (url: string) => auth(request(server).put(url)),
      delete: (url: string) => auth(request(server).delete(url)),
    };
  };
  return {
    app, db, intake, login, loginWith, as,
    events: app.get(EventEmitter2),
    http: () => request(server),
    get: <T>(token: unknown) => app.get(token as never) as T,
    close: () => app.close(),
  };
}

// ---------------------------------------------------------------- lookups

export async function brandIdOf(db: Db, code: string): Promise<string> {
  const [b] = await db.select({ id: brands.id }).from(brands).where(eq(brands.code, code)).limit(1);
  if (!b) throw new Error(`brand ${code} not seeded`);
  return b.id;
}

export async function zoneIdOf(db: Db, code: string): Promise<string> {
  const [z] = await db.select({ id: zones.id }).from(zones).where(eq(zones.code, code)).limit(1);
  if (!z) throw new Error(`zone ${code} not seeded`);
  return z.id;
}

export async function courierIdOf(db: Db, code: string): Promise<string> {
  const [c] = await db.select({ id: couriers.id }).from(couriers).where(eq(couriers.code, code)).limit(1);
  if (!c) throw new Error(`hero ${code} not seeded`);
  return c.id;
}

export async function userIdOf(db: Db, phone: string): Promise<string> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
  if (!u) throw new Error(`user ${phone} not found`);
  return u.id;
}

let phoneSeq = Math.floor(Math.random() * 9_000_000);
/** A fresh, valid Egyptian mobile in E.164 (unique per call). */
export function uniquePhone(prefix: '10' | '11' | '12' | '15' = '15'): string {
  phoneSeq = (phoneSeq + 1) % 100_000_000;
  return `+20${prefix}${String(phoneSeq).padStart(8, '0')}`;
}

// ---------------------------------------------------------------- factories

export interface OrderOverrides {
  brandId: string;
  status?: OrderStatus;
  zoneCode?: string;
  zoneId?: string;
  brandReference?: string | null;
  source?: (typeof orders.$inferInsert)['source'];
  externalId?: string | null;
  recipientName?: string;
  recipientPhone?: string;
  addressLine?: string;
  paymentMethod?: 'COD' | 'PREPAID';
  codAmountCents?: number;
  collectCents?: number;
  collectedCents?: number;
  totalFeesCents?: number;
  vatCents?: number;
  courierId?: string | null;
  hubId?: string | null;
  createdAt?: Date;
  deliveredAt?: Date | null;
  returnedAt?: Date | null;
  cancelledAt?: Date | null;
  promisedBy?: Date | null;
  attempts?: number;
  deliveryOtpRequired?: boolean;
  internalNotes?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Inserts an order row directly (the order lifecycle is owned by the operations module). */
export async function insertOrder(db: Db, o: OrderOverrides): Promise<string> {
  const phone = o.recipientPhone ?? uniquePhone('10');
  const [existing] = await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, phone)).limit(1);
  const customerId = existing?.id ?? (await db.insert(customers).values({ phone, name: o.recipientName ?? 'Test Customer' }).$returningId())[0].id;
  const zoneId = o.zoneId ?? (await zoneIdOf(db, o.zoneCode ?? 'CAI-NASR'));
  const cod = o.codAmountCents ?? 50_000;
  for (let i = 0; ; i++) {
    try {
      const [row] = await db
        .insert(orders)
        .values({
          trackingNumber: generateTrackingNumber(), brandId: o.brandId, brandReference: o.brandReference ?? null, status: o.status ?? 'CREATED',
          source: o.source ?? 'PORTAL', customerId, recipientName: o.recipientName ?? 'Test Customer', recipientPhone: phone,
          addressLine: o.addressLine ?? '10 Test St, Nasr City', zoneId, paymentMethod: o.paymentMethod ?? 'COD', codAmountCents: cod,
          collectCents: o.collectCents ?? cod, collectedCents: o.collectedCents ?? 0, totalFeesCents: o.totalFeesCents ?? 0, vatCents: o.vatCents ?? 0,
          courierId: o.courierId ?? null, hubId: o.hubId ?? null, externalId: o.externalId ?? null, attempts: o.attempts ?? 0,
          deliveredAt: o.deliveredAt ?? null, returnedAt: o.returnedAt ?? null, cancelledAt: o.cancelledAt ?? null, promisedBy: o.promisedBy ?? null,
          deliveryOtpRequired: o.deliveryOtpRequired ?? false, internalNotes: o.internalNotes ?? null, metadata: o.metadata ?? null,
          ...(o.createdAt ? { createdAt: o.createdAt } : {}),
        })
        .$returningId();
      return row.id;
    } catch (err) {
      if (i < 3 && String((err as { cause?: { code?: string } }).cause?.code ?? err).includes('ER_DUP_ENTRY') && !o.brandReference) continue;
      throw err;
    }
  }
}

export async function insertAttempt(db: Db, a: { orderId: string; courierId: string; attemptNo?: number; success: boolean; failureReason?: (typeof deliveryAttempts.$inferInsert)['failureReason']; at: Date }) {
  await db.insert(deliveryAttempts).values({
    orderId: a.orderId, courierId: a.courierId, attemptNo: a.attemptNo ?? 1, success: a.success, failureReason: a.failureReason ?? null, createdAt: a.at,
  });
}

/** Polls until `fn` returns a truthy value (async listeners run after the request returns). */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 5000, everyMs = 50): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
