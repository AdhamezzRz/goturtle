import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { verifyHmacAny, verifyToken, mapSallaOrder, classifySalla, normalizeStoreRef } from '../src/modules/integrations/marketplaces';
import { withDefaultSettings, MappingError } from '../src/modules/integrations/connectors';
import type { TestContext } from './helpers';
import { bootTestApp, createTestBrand, randomPhone, type Agent } from './ops-factories';

const API = '/api/v1';
const hex = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('hex');
const b64 = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('base64');

describe('Marketplace connectors: EasyOrders, Zid, Salla, YouCan (e2e)', () => {
  let t: TestContext;
  let brand: Awaited<ReturnType<typeof createTestBrand>>;
  let owner: Agent;

  beforeAll(async () => {
    t = await bootTestApp();
    brand = await createTestBrand(t);
    owner = await brand.login();
  });
  afterAll(() => t.close());

  async function connect(provider: string, shopDomain: string, credentials: Record<string, string> = {}, settings: Record<string, unknown> = {}) {
    const res = await owner.post(`${API}/integrations`).send({ provider, shopDomain, credentials, settings });
    expect(res.status).toBe(201);
    return res.body as { id: string; webhookUrl: string; inboundSecret: string; provider: string };
  }
  const post = (path: string, body: string, headers: Record<string, string>) => {
    let r = t.http().post(path).set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return r.send(body);
  };
  const orderBy = async (externalId: string) => (await t.db.select().from(s.orders).where(eq(s.orders.externalId, externalId)))[0];

  // ------------------------------------------------------------------ Salla

  it('Salla: X-Salla-Signature HMAC, COD mapping, idempotency and cancellation', async () => {
    const c = await connect('SALLA', 'https://nile-threads.salla.sa/', { webhookSecret: 'salla_whsec_123', accessToken: 'salla_at' });
    expect(c.webhookUrl).toMatch(new RegExp(`/api/v1/integrations/salla/${c.id}/orders$`));
    const listed = (await owner.get(`${API}/integrations/${c.id}`)).body;
    expect(listed.shopDomain).toBe('nile-threads.salla.sa');
    expect(listed.credentialsSet).toEqual({ webhookSecret: true, accessToken: true });
    expect(JSON.stringify(listed)).not.toContain('salla_whsec_123');

    const phone = randomPhone('011');
    const payload = JSON.stringify({
      event: 'order.created', merchant: 1234, created_at: '2026-10-31 10:00:00',
      data: {
        id: 99001, reference_id: 7001, status: { slug: 'under_review' }, payment_method: 'cod', currency: 'EGP',
        amounts: { total: { amount: 1250.5, currency: 'EGP' } },
        customer: { first_name: 'Hana', last_name: 'Fathy', mobile: phone.slice(1), mobile_code: '+20', email: 'h@example.com' },
        shipping: { receiver: { name: 'Hana Fathy', phone: `+2${phone}` }, address: { shipping_address: '12 Makram Ebeid St', block: 'Nasr City', city: 'Cairo', geo_coordinates: { lat: 30.0566, lng: 31.3433 } } },
        items: [{ name: 'Linen shirt', quantity: 2, weight: 0.4 }, { name: 'Cap', quantity: 1, weight: 0.2 }],
      },
    });
    const url = `${API}/integrations/salla/${c.id}/orders`;
    expect((await post(url, payload, { 'X-Salla-Signature': hex('wrong', payload) })).status).toBe(401);
    expect((await post(url, payload, {})).status).toBe(401);
    const tampered = payload.replace('1250.5', '1.5');
    expect((await post(url, tampered, { 'X-Salla-Signature': hex('salla_whsec_123', payload) })).status).toBe(401);

    const ok = await post(url, payload, { 'X-Salla-Signature': hex('salla_whsec_123', payload) });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, action: 'created' });
    const o = await orderBy('salla:99001');
    expect(o).toMatchObject({ source: 'SALLA', brandId: brand.brandId, brandReference: 'SALLA-7001', paymentMethod: 'COD', codAmountCents: 125_050, itemsCount: 3, weightGrams: 1000, recipientName: 'Hana Fathy', lat: 30.0566 });
    expect(o.recipientPhone).toBe(`+2${phone}`);
    expect(o.packageDescription).toBe('2× Linen shirt, 1× Cap');
    expect(o.tags).toContain('salla');

    // Token strategy and the connection's own inbound secret also work; replays are duplicates.
    const dup = await post(url, payload, { Authorization: `Bearer ${c.inboundSecret}` });
    expect(dup.body).toMatchObject({ ok: true, action: 'duplicate', trackingNumber: o.trackingNumber });

    const cancel = JSON.stringify({ event: 'order.cancelled', merchant: 1234, data: { id: 99001, reference_id: 7001, status: { slug: 'canceled' } } });
    const cancelled = await post(url, cancel, { 'X-Salla-Signature': hex('salla_whsec_123', cancel) });
    expect(cancelled.body).toMatchObject({ ok: true, action: 'cancelled' });
    expect((await orderBy('salla:99001')).status).toBe('CANCELLED');

    const other = JSON.stringify({ event: 'product.updated', data: { id: 5 } });
    expect((await post(url, other, { 'X-Salla-Signature': hex('salla_whsec_123', other) })).body.action).toBe('ignored');
  });

  it('Salla: non-EGP orders and bad phones are rejected (200, recorded on the connection)', async () => {
    const c = await connect('SALLA', 'riyadh-store', { webhookSecret: 'sec2' });
    const sar = JSON.stringify({ event: 'order.created', data: { id: 1, reference_id: 1, payment_method: 'cod', amounts: { total: { amount: 100, currency: 'SAR' } }, customer: { mobile: '1001234567', mobile_code: '+20' }, shipping: { receiver: { name: 'X Y' }, address: { shipping_address: 'Nasr City' } } } });
    const res = await post(`${API}/integrations/salla/${c.id}/orders`, sar, { 'X-Salla-Signature': hex('sec2', sar) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, action: 'rejected' });
    expect(res.body.reason).toContain('UNSUPPORTED_CURRENCY');
    const conn = (await owner.get(`${API}/integrations/${c.id}`)).body;
    expect(conn.status).toBe('ERROR');
    expect(conn.lastError).toContain('SAR');
  });

  // ------------------------------------------------------------------ YouCan

  it('YouCan: x-youcan-signature, prepaid detection, cancellation', async () => {
    const c = await connect('YOUCAN', 'nile.youcan.shop', { webhookSecret: 'yc_client_secret' });
    const url = `${API}/integrations/youcan/${c.id}/orders`;
    const phone = randomPhone('012');
    const paid = JSON.stringify({
      id: 'yc-ord-1', ref: '1042', total: 899, currency: 'EGP', status: 'open', payment: { status: 'paid', gateway: 'stripe' },
      customer: { first_name: 'Karim', last_name: 'Adel', phone },
      shipping: { address: { first_name: 'Karim', last_name: 'Adel', phone, first_line: '8 Abbas El Akkad', second_line: 'Nasr City', city: 'Cairo' } },
      variants: [{ quantity: 1, variant: { product: { name: 'Sneakers', weight: 1.2 } } }],
    });
    expect((await post(url, paid, { 'x-youcan-signature': hex('nope', paid) })).status).toBe(401);
    const res = await post(url, paid, { 'x-youcan-signature': hex('yc_client_secret', paid), 'x-youcan-event': 'order.create' });
    expect(res.body).toMatchObject({ ok: true, action: 'created' });
    const o = await orderBy('youcan:yc-ord-1');
    expect(o).toMatchObject({ source: 'YOUCAN', paymentMethod: 'PREPAID', codAmountCents: 0, brandReference: 'YC-1042', weightGrams: 1200, declaredValueCents: 89_900, recipientName: 'Karim Adel' });

    const cod = JSON.stringify({ id: 'yc-ord-2', ref: '1043', total: 450, currency: 'EGP', payment: { status: 'pending', gateway: 'cod' }, customer: { full_name: 'Dina Samy', phone: randomPhone() }, shipping: { address: { first_line: '3 Makram Ebeid', city: 'Nasr City' } }, variants: [{ quantity: 2, variant: { product: { name: 'Socks' } } }] });
    expect((await post(url, cod, { 'x-youcan-signature': b64('yc_client_secret', cod) })).body.action).toBe('created');
    expect(await orderBy('youcan:yc-ord-2')).toMatchObject({ paymentMethod: 'COD', codAmountCents: 45_000, itemsCount: 2 });

    const cancel = JSON.stringify({ id: 'yc-ord-2', ref: '1043', status: 'canceled', canceled_at: '2026-10-31T10:00:00Z' });
    expect((await post(url, cancel, { 'x-youcan-signature': hex('yc_client_secret', cancel) })).body.action).toBe('cancelled');
    expect((await orderBy('youcan:yc-ord-2')).status).toBe('CANCELLED');
  });

  // ------------------------------------------------------------------ Zid

  it('Zid: shared secret (Bearer / ?token=) or X-Zid-Signature, mapping and cancellation', async () => {
    const c = await connect('ZID', '12345', { webhookSecret: 'zid_shared_secret' });
    const url = `${API}/integrations/zid/${c.id}/orders`;
    const order = (status: string) => JSON.stringify({
      id: 555001, code: 'ZD-88', store_id: 12345, currency_code: 'EGP', order_total: '640.00', order_status: { code: status },
      payment: { method: { code: 'zid_cod', name: 'الدفع عند الاستلام', type: 'cod' } },
      customer: { name: 'Salma Hany', mobile: `+2${randomPhone('015')}` },
      shipping: { address: { formatted_address: '22 Makram Ebeid St', district: 'Nasr City', city: { name: 'Cairo' } } },
      products: [{ name: 'Abaya', quantity: 1, weight: { value: 700, unit: 'g' } }],
    });
    const created = order('new');
    expect((await post(url, created, {})).status).toBe(401);
    expect((await post(url, created, { Authorization: 'Bearer wrong' })).status).toBe(401);
    const res = await post(`${url}?token=${encodeURIComponent('zid_shared_secret')}`, created, {});
    expect(res.body).toMatchObject({ ok: true, action: 'created' });
    expect(await orderBy('zid:555001')).toMatchObject({ source: 'ZID', paymentMethod: 'COD', codAmountCents: 64_000, brandReference: 'ZID-ZD-88', weightGrams: 700 });
    expect((await post(url, created, { 'X-Zid-Signature': hex(c.inboundSecret, created) })).body.action).toBe('duplicate');

    const cancelled = order('cancelled');
    expect((await post(url, cancelled, { Authorization: 'Bearer zid_shared_secret' })).body.action).toBe('cancelled');
    expect((await orderBy('zid:555001')).status).toBe('CANCELLED');
  });

  // ------------------------------------------------------------------ EasyOrders

  it('EasyOrders: secret header, Egyptian payload mapping, idempotency, cancellation, rotation', async () => {
    const c = await connect('EASYORDERS', 'nile.easy-orders.net');
    const url = `${API}/integrations/easyorders/${c.id}/orders`;
    const phone = randomPhone('010');
    const body = (status: string) => JSON.stringify({
      id: 'b6c3f1e2-0001', short_id: 'EO1001', full_name: 'Ahmed Tarek', phone, phone_alt: randomPhone('011'), government: 'القاهرة',
      address: '15 شارع مكرم عبيد، مدينة نصر', total_cost: 520, shipping_cost: 50, payment_method: 'cod', status,
      cart_items: [{ quantity: 2, price: 235, product: { name: 'تيشيرت قطن' } }], notes: 'الدور الثالث',
    });
    const created = body('pending');
    expect((await post(url, created, { secret: 'nope' })).status).toBe(401);
    const res = await post(url, created, { secret: c.inboundSecret });
    expect(res.body).toMatchObject({ ok: true, action: 'created' });
    const o = await orderBy('easyorders:b6c3f1e2-0001');
    expect(o).toMatchObject({ source: 'EASYORDERS', paymentMethod: 'COD', codAmountCents: 52_000, brandReference: 'EO-EO1001', recipientName: 'Ahmed Tarek', itemsCount: 2, notes: 'الدور الثالث' });
    expect(o.recipientAltPhone).toMatch(/^\+2011/);
    expect((await post(url, created, { 'X-EasyOrders-Secret': c.inboundSecret })).body.action).toBe('duplicate');

    const rotated = await owner.post(`${API}/integrations/${c.id}/rotate-secret`);
    expect(rotated.status).toBe(200);
    expect((await post(url, body('canceled'), { secret: c.inboundSecret })).status).toBe(401);
    expect((await post(url, body('canceled'), { secret: rotated.body.inboundSecret })).body.action).toBe('cancelled');
    expect((await orderBy('easyorders:b6c3f1e2-0001')).status).toBe('CANCELLED');
  });

  it('connections: validation, pause, credential test without tokens, other brands cannot see them', async () => {
    const bad = await owner.post(`${API}/integrations`).send({ provider: 'ZID', shopDomain: 'not a domain!' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_SHOP_DOMAIN');
    const c = await connect('SALLA', 'paused-store', { webhookSecret: 'p' });
    expect((await owner.patch(`${API}/integrations/${c.id}`).send({ status: 'PAUSED' })).body.status).toBe('PAUSED');
    const evt = JSON.stringify({ event: 'order.created', data: { id: 1 } });
    expect((await post(`${API}/integrations/salla/${c.id}/orders`, evt, { 'X-Salla-Signature': hex('p', evt) })).body.action).toBe('ignored');
    const test = await owner.post(`${API}/integrations/${c.id}/test`);
    expect(test.body).toMatchObject({ ok: false });
    expect(test.body.message).toContain('Salla access token');
    const zid = await connect('ZID', 'store-77', { accessToken: 'only-manager-token' });
    expect((await owner.post(`${API}/integrations/${zid.id}/test`)).body.message).toContain('authorization token');

    const stranger = await (await createTestBrand(t)).login();
    expect((await stranger.get(`${API}/integrations/${c.id}`)).status).toBe(404);
    expect((await t.http().post(`${API}/integrations/salla/${zid.id}/orders`).send({})).status).toBe(404); // wrong platform for this connection
    expect((await t.http().post(`${API}/integrations/magento/${zid.id}/orders`).send({})).status).toBe(404);
  });

  it('pure helpers: hex/base64 HMAC, constant-time tokens, store refs, mapping errors', () => {
    const body = '{"a":1}';
    expect(verifyHmacAny(body, hex('k', body), ['x', 'k'])).toBe(true);
    expect(verifyHmacAny(body, `sha256=${hex('k', body)}`, ['k'])).toBe(true);
    expect(verifyHmacAny(body, b64('k', body), ['k'])).toBe(true);
    expect(verifyHmacAny(body, hex('k', body), ['other'])).toBe(false);
    expect(verifyHmacAny(body, 'garbage', ['k'])).toBe(false);
    expect(verifyToken('Bearer abc', ['abc'])).toBe(true);
    expect(verifyToken('abcd', ['abc'])).toBe(false);
    expect(verifyToken('', ['abc'])).toBe(false);
    expect(normalizeStoreRef('HTTPS://Shop.Example.com/')).toBe('shop.example.com');
    expect(normalizeStoreRef('a b')).toBeNull();
    expect(classifySalla({ event: 'order.status.updated', data: { id: 3, status: { slug: 'canceled' } } }).kind).toBe('cancel');
    expect(() =>
      mapSallaOrder({ id: 1, payment_method: 'cod', amounts: { total: { amount: 10, currency: 'EGP' } }, customer: { mobile: '123' }, shipping: { receiver: { name: 'A B' }, address: { shipping_address: '12 Nasr City St' } } }, {
        brandId: 'b', connectionId: 'c', shopDomain: 's', settings: withDefaultSettings(null),
      }),
    ).toThrow(MappingError);
  });
});
