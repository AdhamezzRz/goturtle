import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { DomainEvents } from '@goturtle/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { DB } from '../src/core/database.module';
import type { Db } from '../src/db/client';
import * as s from '../src/db/schema';
import { sha256 } from '../src/common/crypto';
import { PUSH_SENDER, PushService, type PushSender, type PushTarget } from '../src/modules/push/push.service';
import { ACCOUNTS, type TestContext } from './helpers';
import { bearer, createTestBrand, tokenFor, type Agent } from './ops-factories';

const API = '/api/v1';

/** Records every push; endpoints containing "gone" answer 410, "flaky" 500, "boom" throw. */
class StubSender implements PushSender {
  readonly sent: Array<{ endpoint: string; payload: Record<string, unknown>; opts: { ttlSeconds: number; urgency: string; topic?: string } }> = [];
  async send(target: PushTarget, payload: string, opts: { ttlSeconds: number; urgency: 'normal' | 'high'; topic?: string }) {
    if (target.endpoint.includes('boom')) throw new Error('socket hang up');
    this.sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload), opts });
    return { statusCode: target.endpoint.includes('gone') ? 410 : target.endpoint.includes('flaky') ? 500 : 201 };
  }
  to(endpoint: string) {
    return this.sent.filter((x) => x.endpoint === endpoint);
  }
}

const keys = () => ({ p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' });
const endpoint = (tag: string) => `https://fcm.googleapis.com/fcm/send/${tag}-${Math.random().toString(36).slice(2)}`;
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const until = Date.now() + ms;
  while (!cond() && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

describe('Web Push (e2e, stubbed sender)', () => {
  let app: NestExpressApplication;
  let db: Db;
  let t: TestContext;
  const stub = new StubSender();
  const env = { ...process.env };
  let hero: Agent;
  let heroUserId: string;
  let heroCourierId: string;

  beforeAll(async () => {
    const vapid = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
    process.env.VAPID_SUBJECT = 'mailto:test@goturtle.test';
    process.env.PUSH_COALESCE_MS = '30';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PUSH_SENDER).useValue(stub).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
    configureApp(app);
    await app.init();
    db = app.get<Db>(DB);
    t = { app, db, http: () => request(app.getHttpServer()) } as unknown as TestContext;
    const [u] = await db.select({ id: s.users.id, courierId: s.couriers.id }).from(s.users).innerJoin(s.couriers, eq(s.couriers.userId, s.users.id)).where(eq(s.users.phone, ACCOUNTS.hero1.identifier));
    heroUserId = u.id;
    heroCourierId = u.courierId;
    hero = bearer(t, await tokenFor(t, heroUserId, 'COURIER'));
  });
  afterAll(async () => {
    process.env = { ...env };
    await app.close();
  });

  const subsOf = (userId: string) => db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, userId));

  it('exposes the VAPID public key without auth', async () => {
    const res = await t.http().get(`${API}/push/public-key`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, publicKey: process.env.VAPID_PUBLIC_KEY });
  });

  it('subscribes (upsert by endpoint hash), reports status, validates and unsubscribes', async () => {
    const ep = endpoint('hero');
    const first = await hero.post(`${API}/push/subscribe`).send({ endpoint: ep, keys: keys() });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ subscribed: true, enabled: true });
    expect((await hero.post(`${API}/push/subscribe`).send({ endpoint: ep, keys: keys() })).status).toBe(200);
    const rows = (await subsOf(heroUserId)).filter((r) => r.endpoint === ep);
    expect(rows).toHaveLength(1);
    expect(rows[0].endpointHash).toBe(sha256(ep));

    const status = await hero.get(`${API}/push/status?endpoint=${encodeURIComponent(ep)}`);
    expect(status.body).toMatchObject({ enabled: true, thisDevice: true });

    expect((await hero.post(`${API}/push/subscribe`).send({ endpoint: 'http://127.0.0.1/x', keys: keys() })).status).toBe(400);
    expect((await hero.post(`${API}/push/subscribe`).send({ endpoint: ep, keys: { p256dh: 'short', auth: 'x' } })).status).toBe(400);
    expect((await t.http().post(`${API}/push/subscribe`).send({ endpoint: ep, keys: keys() })).status).toBe(401);

    // The same browser signing in as someone else moves the subscription.
    const brand = await createTestBrand(t);
    const owner = await brand.login();
    expect((await owner.post(`${API}/push/subscribe`).send({ endpoint: ep, keys: keys() })).status).toBe(200);
    expect((await subsOf(heroUserId)).some((r) => r.endpoint === ep)).toBe(false);
    expect((await subsOf(brand.ownerId)).some((r) => r.endpoint === ep)).toBe(true);

    const del = await owner.delete(`${API}/push/subscribe`).send({ endpoint: ep });
    expect(del.body).toEqual({ unsubscribed: true });
    expect((await owner.delete(`${API}/push/subscribe`).send({ endpoint: ep })).body).toEqual({ unsubscribed: false });
  });

  it('sends a localized test push, prunes expired endpoints and counts failures', async () => {
    const ok = endpoint('ok');
    const gone = endpoint('gone');
    const flaky = endpoint('flaky');
    const boom = endpoint('boom');
    for (const ep of [ok, gone, flaky, boom]) expect((await hero.post(`${API}/push/subscribe`).send({ endpoint: ep, keys: keys() })).status).toBe(200);
    const res = await hero.post(`${API}/push/test`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, sent: 1, pruned: 1 });
    expect(res.body.failed).toBeGreaterThanOrEqual(2);
    const msg = stub.to(ok)[0];
    expect(msg.payload).toMatchObject({ url: '/', tag: 'test', icon: '/icon-192.png', badge: '/icon-192.png' });
    expect(String(msg.payload.title)).toMatch(/الإشعارات|Notifications/);
    expect(msg.opts.ttlSeconds).toBeGreaterThan(0);
    const rows = await subsOf(heroUserId);
    expect(rows.some((r) => r.endpoint === gone)).toBe(false);
    expect(rows.find((r) => r.endpoint === flaky)?.failures).toBe(1);
    expect(rows.find((r) => r.endpoint === boom)?.failures).toBe(1);
    expect(rows.find((r) => r.endpoint === ok)?.lastUsedAt).toBeTruthy();
    for (const ep of [flaky, boom]) await hero.delete(`${API}/push/subscribe`).send({ endpoint: ep });
    // A subscription that keeps failing is dropped after 10 attempts.
    const bad = endpoint('flaky');
    await hero.post(`${API}/push/subscribe`).send({ endpoint: bad, keys: keys() });
    await db.update(s.pushSubscriptions).set({ failures: 9 }).where(eq(s.pushSubscriptions.endpointHash, sha256(bad)));
    const again = await app.get(PushService).sendToUser(heroUserId, { title: 'x', body: 'y' });
    expect(again.pruned).toBe(1);
    expect((await subsOf(heroUserId)).some((r) => r.endpoint === bad)).toBe(false);
  });

  it('notifies the hero when a runsheet is dispatched and coalesces pickup bursts', async () => {
    const ep = endpoint('hero-events');
    await hero.post(`${API}/push/subscribe`).send({ endpoint: ep, keys: keys() });
    const events = app.get(EventEmitter2);
    await events.emitAsync(DomainEvents.RunsheetDispatched, { runsheetId: 'rs1', code: 'RS-009001', courierId: heroCourierId, orderCount: 7, expectedCodCents: 0, override: false });
    expect(await waitFor(() => stub.to(ep).length === 1)).toBe(true);
    expect(stub.to(ep)[0].payload).toMatchObject({ url: '/hero', tag: 'runsheet-rs1' });
    expect(String(stub.to(ep)[0].payload.body)).toContain('RS-009001');
    expect(stub.to(ep)[0].opts.urgency).toBe('high');

    for (let i = 0; i < 3; i++) {
      await events.emitAsync(DomainEvents.OrderStatusChanged, { orderId: `o${i}`, trackingNumber: `GT${i}`, brandId: 'b', courierId: heroCourierId, from: 'CREATED', to: 'PICKUP_ASSIGNED', actorType: 'STAFF', at: new Date() });
    }
    expect(await waitFor(() => stub.to(ep).length === 2)).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(stub.to(ep)).toHaveLength(2);
    expect(stub.to(ep)[1].payload.tag).toBe('pickup');
    expect(String(stub.to(ep)[1].payload.body)).toMatch(/3/);
  });

  it('notifies brand owners about failed attempts, returns and paid settlements', async () => {
    const brand = await createTestBrand(t);
    const owner = await brand.login();
    const ep = endpoint('owner');
    await owner.post(`${API}/push/subscribe`).send({ endpoint: ep, keys: keys() });
    const events = app.get(EventEmitter2);
    await events.emitAsync(DomainEvents.OrderStatusChanged, { orderId: 'ord1', trackingNumber: 'GT0001', brandId: brand.brandId, courierId: heroCourierId, from: 'OUT_FOR_DELIVERY', to: 'FAILED_ATTEMPT', reason: 'CUSTOMER_REFUSED', actorType: 'COURIER', at: new Date() });
    await events.emitAsync(DomainEvents.OrderStatusChanged, { orderId: 'ord2', trackingNumber: 'GT0002', brandId: brand.brandId, courierId: null, from: 'RETURN_OUT', to: 'RETURNED', actorType: 'COURIER', at: new Date() });
    await events.emitAsync(DomainEvents.OrderStatusChanged, { orderId: 'ord3', trackingNumber: 'GT0003', brandId: brand.brandId, courierId: null, from: 'OUT_FOR_DELIVERY', to: 'DELIVERED', actorType: 'COURIER', at: new Date() });
    expect(await waitFor(() => stub.to(ep).length >= 2)).toBe(true);
    const [failed, returned] = stub.to(ep);
    expect(failed.payload).toMatchObject({ url: '/brand/orders/ord1', tag: 'order-ord1' });
    expect(String(failed.payload.body)).toContain('GT0001');
    expect(String(failed.payload.body)).toMatch(/رفض|refused/);
    expect(returned.payload.url).toBe('/brand/orders/ord2');
    // Another brand's owner hears nothing.
    expect(stub.sent.filter((x) => String(x.payload.body).includes('GT0001'))).toHaveLength(1);
    expect(stub.to(ep)).toHaveLength(2); // DELIVERED is not pushed

    await db.insert(s.settlements).values({ id: 'stl-push-1', code: 'ST-PUSH-1', brandId: brand.brandId, periodStart: new Date(), periodEnd: new Date(), netPayableCents: 123_456, status: 'PAID' });
    await events.emitAsync(DomainEvents.SettlementPaid, { settlementId: 'stl-push-1', brandId: brand.brandId, netPayableCents: 123_456 });
    expect(await waitFor(() => stub.to(ep).length === 3)).toBe(true);
    expect(stub.to(ep)[2].payload.url).toBe('/brand/wallet/settlements/stl-push-1');
    expect(String(stub.to(ep)[2].payload.body)).toContain('ST-PUSH-1');
  });

  it('is disabled gracefully without VAPID keys', async () => {
    const saved = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      expect((await t.http().get(`${API}/push/public-key`)).body).toEqual({ enabled: false, publicKey: null });
      const before = stub.sent.length;
      expect((await hero.post(`${API}/push/test`)).body).toEqual({ enabled: false, sent: 0, failed: 0, pruned: 0 });
      expect(stub.sent.length).toBe(before);
      expect((await hero.post(`${API}/push/subscribe`).send({ endpoint: endpoint('later'), keys: keys() })).body.enabled).toBe(false);
    } finally {
      process.env.VAPID_PRIVATE_KEY = saved;
    }
  });
});
