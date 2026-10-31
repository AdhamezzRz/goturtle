import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { normalizeEgyptPhone } from '@goturtle/shared';
import { createTestApp, type TestContext } from './helpers';
import { orderBody, randomPhone } from './ops-factories';
import { JobsService } from '../src/core/jobs.service';
import { LedgerService } from '../src/core/ledger/ledger.service';
import * as s from '../src/db/schema';

const API = '/api/v1';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls `check` until it returns a truthy value (async event listeners need a moment). */
async function eventually<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 4000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > until) throw new Error('condition not met in time');
    await wait(50);
  }
}

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

/**
 * Cross-module flows that only work once operations, workforce and platform are
 * merged: API key → order → signed webhook delivered to a real HTTP receiver,
 * Shopify inbound orders, OTP SMS, ticket privacy, settings, analytics, payments.
 */
describe('Platform integrations (e2e)', () => {
  let t: TestContext;
  let receiver: Server;
  let receiverUrl: string;
  const received: Received[] = [];
  let failNext = 0;

  beforeAll(async () => {
    t = await createTestApp();
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        if (failNext > 0) {
          failNext--;
          res.writeHead(500).end('boom');
        } else res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks/goturtle`;
  });

  afterAll(async () => {
    await new Promise((r) => receiver.close(r));
    await t.close();
  });

  it('creates an order with an API key and delivers a correctly signed webhook (with retry)', async () => {
    const owner = await t.as('brandNile');
    const key = await owner.post(`${API}/api-keys`).send({ name: 'Shop backend', scopes: ['*'] });
    expect(key.status).toBe(201);
    expect(key.body.key).toMatch(/^gt_live_/);

    const ep = await owner.post(`${API}/webhooks/endpoints`).send({ url: receiverUrl, events: ['order.created'], description: 'test receiver' });
    expect(ep.status).toBe(201);
    const secret: string = ep.body.secret;
    expect(secret).toBeTruthy();

    const created = await t.http().post(`${API}/orders`).set('X-Api-Key', key.body.key).send(orderBody({ brandReference: `API-${Date.now()}` }));
    expect(created.status).toBe(201);
    expect(created.body.source).toBe('API');

    const delivery = await eventually(async () => {
      const [row] = await t.db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.endpointId, ep.body.id)).limit(1);
      return row;
    });
    expect(delivery.event).toBe('order.created');

    // First attempt fails (receiver returns 500) → FAILED with a scheduled retry.
    failNext = 1;
    const jobs = t.app.get(JobsService);
    await jobs.tick({ force: ['webhooks.deliver'] });
    const [afterFail] = await t.db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.id, delivery.id));
    expect(afterFail.status).toBe('FAILED');
    expect(afterFail.lastResponseCode).toBe(500);
    expect(afterFail.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Make it due again and deliver successfully.
    await t.db.update(s.webhookDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(s.webhookDeliveries.id, delivery.id));
    await jobs.tick({ force: ['webhooks.deliver'] });
    const [done] = await t.db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.id, delivery.id));
    expect(done.status).toBe('SUCCESS');

    const last = received[received.length - 1];
    expect(last.headers['x-goturtle-event']).toBe('order.created');
    const sig = String(last.headers['x-goturtle-signature']);
    const ts = /t=(\d+)/.exec(sig)?.[1];
    const v1 = /v1=([a-f0-9]+)/.exec(sig)?.[1];
    expect(v1).toBe(createHmac('sha256', secret).update(`${ts}.${last.body}`).digest('hex'));
    const payload = JSON.parse(last.body);
    expect(payload.data.trackingNumber).toBe(created.body.trackingNumber);

    // Revoked keys stop working.
    expect((await owner.post(`${API}/api-keys/${key.body.id}/revoke`)).status).toBeLessThan(300);
    const denied = await t.http().get(`${API}/orders`).set('X-Api-Key', key.body.key);
    expect(denied.status).toBe(401);
  });

  it('accepts Shopify orders only with a valid HMAC and is idempotent', async () => {
    const owner = await t.as('brandGadgets');
    const conn = await owner.post(`${API}/integrations`).send({ provider: 'SHOPIFY', shopDomain: 'cairo-gadgets.myshopify.com', settings: { autoCreate: true } });
    expect(conn.status).toBe(201);
    const secret: string = conn.body.inboundSecret;
    expect(secret).toMatch(/^gtin_/);

    const phone = randomPhone().replace('+20', '0');
    const shopifyOrder = {
      id: 5_550_001 + Math.floor(Math.random() * 1000),
      name: `#${Math.floor(Math.random() * 90000) + 10000}`,
      total_price: '1499.00',
      financial_status: 'pending',
      payment_gateway_names: ['Cash on Delivery (COD)'],
      phone,
      shipping_address: { first_name: 'Karim', last_name: 'Adel', address1: '45 Makram Ebeid St', address2: 'Floor 4', city: 'Nasr City', province: 'Cairo', phone },
      line_items: [{ title: 'Smart watch', quantity: 1, grams: 300 }],
    };
    const raw = JSON.stringify(shopifyOrder);
    const hmac = createHmac('sha256', secret).update(raw).digest('base64');
    const url = `${API}/integrations/shopify/${conn.body.id}/orders`;
    const send = (sig: string) =>
      request(t.app.getHttpServer()).post(url).set('Content-Type', 'application/json').set('X-Shopify-Topic', 'orders/create').set('X-Shopify-Hmac-Sha256', sig).send(raw);

    expect((await send('bad-signature')).status).toBe(401);
    const ok = await send(hmac);
    expect(ok.status).toBe(200);
    expect((await send(hmac)).status).toBe(200); // retry from Shopify → no duplicate

    const rows = await t.db.select().from(s.orders).where(and(eq(s.orders.externalId, String(shopifyOrder.id)), eq(s.orders.source, 'SHOPIFY')));
    expect(rows).toHaveLength(1);
    expect(rows[0].codAmountCents).toBe(149_900);
    expect(rows[0].brandReference).toBe(shopifyOrder.name);
  });

  it('sends the customer OTP by SMS and stores only a masked copy', async () => {
    const owner = await t.as('brandBloom');
    const phone = randomPhone();
    const order = await owner.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Hana', phone } }));
    expect(order.status).toBe(201);
    const otp = await t.http().post(`${API}/auth/customer/otp`).send({ phone, trackingNumber: order.body.trackingNumber });
    expect(otp.status).toBe(200);

    const sms = await eventually(async () => {
      const [row] = await t.db
        .select()
        .from(s.notifications)
        .where(and(eq(s.notifications.recipient, normalizeEgyptPhone(phone)!), eq(s.notifications.channel, 'SMS'), eq(s.notifications.template, 'otp_tracking')));
      return row;
    });
    expect(sms.status).toBe('SENT');
    // The real code goes to the SMS provider; the stored log copy is masked so codes never sit in the DB.
    expect(sms.body).not.toContain(otp.body.devCode);
    expect(sms.body).toContain('••••••');
  });

  it('keeps internal ticket notes away from the brand', async () => {
    const brand = await t.as('brandNile');
    const ticket = await brand.post(`${API}/tickets`).send({ subject: 'Where is my parcel?', category: 'DELAY', body: 'Customer is waiting since yesterday' });
    expect(ticket.status).toBe(201);
    const support = await t.as('support');
    expect((await support.post(`${API}/tickets/${ticket.body.id}/messages`).send({ body: 'Hero was sick, reassigning', isInternal: true })).status).toBe(201);
    expect((await support.post(`${API}/tickets/${ticket.body.id}/messages`).send({ body: 'We are on it — delivery today.' })).status).toBe(201);
    expect((await brand.post(`${API}/tickets/${ticket.body.id}/messages`).send({ body: 'sneaky', isInternal: true })).status).toBe(403);

    const brandView = await brand.get(`${API}/tickets/${ticket.body.id}`);
    const staffView = await support.get(`${API}/tickets/${ticket.body.id}`);
    const bodies = (v: request.Response) => (v.body.messages as Array<{ body: string }>).map((m) => m.body);
    expect(bodies(brandView)).not.toContain('Hero was sick, reassigning');
    expect(bodies(staffView)).toContain('Hero was sick, reassigning');
    expect(ticket.body.slaDueAt).toBeTruthy();

    const otherBrand = await t.as('brandGadgets');
    expect((await otherBrand.get(`${API}/tickets/${ticket.body.id}`)).status).toBe(404);
  });

  it('validates settings and exposes only public ones', async () => {
    const admin = await t.as('admin');
    const ok = await admin.put(`${API}/settings/company`).send({ value: { name: 'GoTurtle Logistics', supportPhone: '+201000000999' } });
    expect(ok.status).toBeLessThan(300);
    const bad = await admin.put(`${API}/settings/operations`).send({ value: { maxAttempts: 'many' } });
    expect(bad.status).toBe(400);
    const pub = await t.http().get(`${API}/settings/public`);
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.body)).toContain('GoTurtle Logistics');
    expect((await (await t.as('dispatcher')).get(`${API}/settings`)).status).toBe(403);
  });

  it('serves scoped analytics and keeps the ledger balanced', async () => {
    const admin = await t.as('admin');
    const ops = await admin.get(`${API}/analytics/ops/overview`);
    expect(ops.status).toBe(200);
    expect(ops.body).toBeTruthy();
    const brand = await (await t.as('brandNile')).get(`${API}/analytics/brand/overview`);
    expect(brand.status).toBe(200);
    expect((await (await t.as('brandNile')).get(`${API}/analytics/ops/overview`)).status).toBe(403);

    const tb = await t.app.get(LedgerService).trialBalance();
    expect(tb.balanced).toBe(true);
  });

  it('refuses payment links while payments are disabled', async () => {
    const brand = await t.as('brandNile');
    const order = await brand.post(`${API}/orders`).send(orderBody());
    const link = await brand.post(`${API}/payments/orders/${order.body.id}/link`);
    expect(link.status).toBeGreaterThanOrEqual(400);
    expect(link.body.code).toBe('PAYMENTS_DISABLED');
  });
});
