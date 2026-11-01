import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { LINK_CODE_ALPHABET } from '../src/modules/order-links/order-links.service';
import type { TestContext } from './helpers';
import { bootTestApp, createTestBrand, randomPhone, type Agent } from './ops-factories';
import { staffAgent } from './intake-factories';

const API = '/api/v1';
const CODE_RE = new RegExp(`^[${LINK_CODE_ALPHABET}]{8}$`);

describe('Order links (e2e)', () => {
  let t: TestContext;
  let brand: Awaited<ReturnType<typeof createTestBrand>>;
  let b: Agent;
  let other: Agent;

  beforeAll(async () => {
    t = await bootTestApp();
    brand = await createTestBrand(t);
    b = await brand.login();
    other = await (await createTestBrand(t)).login();
  });
  afterAll(() => t.close());

  const linkBody = (overrides: Record<string, unknown> = {}) => ({
    title: 'Summer linen shirt',
    description: '100% Egyptian linen',
    items: [
      { name: 'Linen shirt — L', quantity: 2, priceCents: 45_000 },
      { name: 'Cap', quantity: 1, priceCents: 15_000 },
    ],
    weightGrams: 800,
    allowOpening: true,
    notes: 'Fragile buttons',
    ...overrides,
  });
  const buyer = (overrides: Record<string, unknown> = {}) => ({
    name: 'Mona Adel',
    phone: randomPhone('010'),
    addressLine: '12 Makram Ebeid St, Nasr City',
    building: '12',
    floor: '3',
    apartment: '7',
    landmark: 'Near City Stars',
    notes: 'Call before arriving',
    ...overrides,
  });
  const linkRow = async (id: string) => (await t.db.select().from(s.orderLinks).where(eq(s.orderLinks.id, id)))[0];

  it('creates a link with an unambiguous 8-char code and the COD auto-summed from the items', async () => {
    const res = await b.post(`${API}/order-links`).send(linkBody());
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(CODE_RE);
    expect(res.body.codAmountCents).toBe(105_000);
    expect(res.body.itemsTotalCents).toBe(105_000);
    expect(res.body.url).toMatch(new RegExp(`/o/${res.body.code}$`));
    expect(res.body.availability).toBe('OPEN');
    expect(res.body.stats).toMatchObject({ orders: 0, delivered: 0 });

    const prepaid = await b.post(`${API}/order-links`).send(linkBody({ paymentMethod: 'PREPAID' }));
    expect(prepaid.status).toBe(201);
    expect(prepaid.body.codAmountCents).toBe(0);

    const override = await b.post(`${API}/order-links`).send(linkBody({ codAmountCents: 99_000 }));
    expect(override.body.codAmountCents).toBe(99_000);
  });

  it('validates input and scopes links to their brand', async () => {
    const free = await b.post(`${API}/order-links`).send(linkBody({ items: [{ name: 'Gift', quantity: 1, priceCents: 0 }] }));
    expect(free.status).toBe(422);
    expect(free.body.code).toBe('INVALID_COD');
    const bad = await b.post(`${API}/order-links`).send(linkBody({ items: [] }));
    expect(bad.status).toBe(400);
    const scheduled = await b.post(`${API}/order-links`).send(linkBody({ serviceLevel: 'SCHEDULED' }));
    expect(scheduled.status).toBe(400);

    const mine = (await b.post(`${API}/order-links`).send(linkBody())).body;
    expect((await other.get(`${API}/order-links/${mine.id}`)).status).toBe(404);
    expect((await other.patch(`${API}/order-links/${mine.id}`).send({ isActive: false })).status).toBe(404);
    const list = await other.get(`${API}/order-links`);
    expect(list.body.data.some((l: { id: string }) => l.id === mine.id)).toBe(false);
    const staff = await (await staffAgent(t, 'ops')).get(`${API}/order-links?brandId=${brand.brandId}`);
    expect(staff.status).toBe(200);
    expect(staff.body.data.every((l: { brandId: string }) => l.brandId === brand.brandId)).toBe(true);
  });

  it('serves the public form with rate-limit headers, a quote and zone detection', async () => {
    const link = (await b.post(`${API}/order-links`).send(linkBody())).body;
    const res = await t.http().get(`${API}/public/order-links/${link.code.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.body).toMatchObject({ code: link.code, title: 'Summer linen shirt', codAmountCents: 105_000, paymentMethod: 'COD', serviceLevel: 'STANDARD', allowOpening: true });
    expect(res.body.brand.name).toBe(`Test Brand ${brand.code}`);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.brandId).toBeUndefined();
    expect(res.body.usesCount).toBeUndefined();

    const detect = await t.http().post(`${API}/public/detect-zone`).send({ address: 'شارع مكرم عبيد، مدينة نصر' });
    expect(detect.status).toBe(200);
    expect(detect.headers['x-ratelimit-limit']).toBeDefined();
    expect(detect.body.zone.code).toBe('CAI-NASR');
    const none = await t.http().post(`${API}/public/detect-zone`).send({ address: 'somewhere unknown' });
    expect(none.body.zone).toBeNull();
    expect(none.body.hint).toBeTruthy();

    const quote = await t.http().post(`${API}/public/order-links/${link.code}/quote`).send({ zoneId: detect.body.zone.id });
    expect(quote.status).toBe(200);
    expect(quote.body.feesPaidBy).toBe('BRAND');
    expect(quote.body.totalToPayCents).toBe(105_000);

    expect((await t.http().get(`${API}/public/order-links/ZZZZZZZZ`)).status).toBe(404);
    expect((await t.http().get(`${API}/public/order-links/bad`)).status).toBe(404);
  });

  it('the buyer places an ORDER_LINK order that is already confirmed', async () => {
    const link = (await b.post(`${API}/order-links`).send(linkBody())).body;
    const form = buyer();
    const res = await t.http().post(`${API}/public/order-links/${link.code}/orders`).send(form);
    expect(res.status).toBe(201);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.body.trackingNumber).toBeTruthy();
    expect(res.body.reference).toBe(`LINK-${link.code}-1`);
    expect(res.body.amountToPayCents).toBe(105_000);
    expect(res.body.trackingUrl).toContain(`/t/${res.body.trackingNumber}`);

    const [o] = await t.db.select().from(s.orders).where(eq(s.orders.trackingNumber, res.body.trackingNumber));
    expect(o).toMatchObject({
      source: 'ORDER_LINK', orderLinkId: link.id, brandId: brand.brandId, brandReference: `LINK-${link.code}-1`, confirmationStatus: 'CONFIRMED',
      confirmationChannel: 'ORDER_LINK', paymentMethod: 'COD', codAmountCents: 105_000, itemsCount: 3, weightGrams: 800, allowOpening: true,
      recipientName: 'Mona Adel', building: '12', floor: '3', apartment: '7', landmark: 'Near City Stars', status: 'CREATED',
    });
    expect(o.recipientPhone).toMatch(/^\+201/);
    expect(o.packageDescription).toContain('2× Linen shirt — L');
    expect(o.notes).toBe('Fragile buttons — Call before arriving');
    expect(o.confirmationRespondedAt).toBeTruthy();
    expect(o.tags).toContain('order-link');

    const second = await t.http().post(`${API}/public/order-links/${link.code}/orders`).send(buyer());
    expect(second.body.reference).toBe(`LINK-${link.code}-2`);

    expect((await linkRow(link.id)).usesCount).toBe(2);
    const stats = (await b.get(`${API}/order-links/${link.id}`)).body;
    expect(stats.usesCount).toBe(2);
    expect(stats.stats).toMatchObject({ orders: 2, delivered: 0, active: 2 });
    const orders = await b.get(`${API}/order-links/${link.id}/orders`);
    expect(orders.body).toHaveLength(2);
  });

  it('rejects bad phones, unknown areas and the honeypot without using the link', async () => {
    const link = (await b.post(`${API}/order-links`).send(linkBody())).body;
    const badPhone = await t.http().post(`${API}/public/order-links/${link.code}/orders`).send(buyer({ phone: '0123' + '45' }));
    expect(badPhone.status).toBe(400);
    const landline = await t.http().post(`${API}/public/order-links/${link.code}/orders`).send(buyer({ phone: '0223456789' }));
    expect(landline.status).toBe(400);
    expect(landline.body.code).toBe('INVALID_PHONE');
    const bot = await t.http().post(`${API}/public/order-links/${link.code}/orders`).send(buyer({ website: 'http://spam.example' }));
    expect(bot.status).toBe(400);
    expect(bot.body.code).toBe('INVALID_SUBMISSION');
    const nowhere = await t.http().post(`${API}/public/order-links/${link.code}/orders`).send(buyer({ addressLine: 'Unknown street number nine' }));
    expect(nowhere.status).toBe(422);
    expect(nowhere.body.code).toBe('ZONE_NOT_DETECTED');
    const unknownField = await t.http().post(`${API}/public/order-links/${link.code}/orders`).send({ ...buyer(), brandId: brand.brandId });
    expect(unknownField.status).toBe(400);
    expect((await linkRow(link.id)).usesCount).toBe(0);
    expect(await t.db.select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.orderLinkId, link.id))).toHaveLength(0);

    // An explicitly chosen zone works without any recognisable district in the text.
    const [zone] = await t.db.select().from(s.zones).where(eq(s.zones.code, 'CAI-HELIO'));
    const chosen = await t.http().post(`${API}/public/order-links/${link.code}/orders`).send(buyer({ addressLine: 'Unknown street number nine', zoneId: zone.id }));
    expect(chosen.status).toBe(201);
  });

  it('enforces max uses atomically, expiry and deactivation', async () => {
    const limited = (await b.post(`${API}/order-links`).send(linkBody({ maxUses: 2 }))).body;
    const burst = await Promise.all(Array.from({ length: 4 }, () => t.http().post(`${API}/public/order-links/${limited.code}/orders`).send(buyer())));
    const ok = burst.filter((r) => r.status === 201);
    expect(ok).toHaveLength(2);
    expect(new Set(ok.map((r) => r.body.reference)).size).toBe(2);
    for (const r of burst.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('ORDER_LINK_UNAVAILABLE');
    }
    expect((await linkRow(limited.id)).usesCount).toBe(2);
    const exhausted = await t.http().get(`${API}/public/order-links/${limited.code}`);
    expect(exhausted.status).toBe(404);
    expect(exhausted.body.details.reason).toBe('EXHAUSTED');
    expect((await b.get(`${API}/order-links/${limited.id}`)).body.availability).toBe('EXHAUSTED');

    const expired = (await b.post(`${API}/order-links`).send(linkBody({ expiresAt: new Date(Date.now() - 60_000).toISOString() }))).body;
    const exp = await t.http().get(`${API}/public/order-links/${expired.code}`);
    expect(exp.status).toBe(404);
    expect(exp.body.details.reason).toBe('EXPIRED');
    expect((await t.http().post(`${API}/public/order-links/${expired.code}/orders`).send(buyer())).status).toBe(404);

    const live = (await b.post(`${API}/order-links`).send(linkBody())).body;
    expect((await b.patch(`${API}/order-links/${live.id}`).send({ isActive: false })).body.isActive).toBe(false);
    const off = await t.http().get(`${API}/public/order-links/${live.code}`);
    expect(off.status).toBe(404);
    expect(off.body.details.reason).toBe('INACTIVE');
    const back = await b.patch(`${API}/order-links/${live.id}`).send({ isActive: true, items: [{ name: 'Dress', quantity: 1, priceCents: 70_000 }] });
    expect(back.body.codAmountCents).toBe(70_000);
    expect((await t.http().get(`${API}/public/order-links/${live.code}`)).body.codAmountCents).toBe(70_000);
  });

  it('deletes unused links only', async () => {
    const used = (await b.post(`${API}/order-links`).send(linkBody())).body;
    expect((await t.http().post(`${API}/public/order-links/${used.code}/orders`).send(buyer())).status).toBe(201);
    const refused = await b.delete(`${API}/order-links/${used.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ORDER_LINK_IN_USE');
    const unused = (await b.post(`${API}/order-links`).send(linkBody())).body;
    expect((await b.delete(`${API}/order-links/${unused.id}`)).status).toBe(200);
    expect(await linkRow(unused.id)).toBeUndefined();
  });

  it('a suspended brand’s links stop taking orders', async () => {
    const tmp = await createTestBrand(t);
    const link = (await (await tmp.login()).post(`${API}/order-links`).send(linkBody())).body;
    await t.db.update(s.brands).set({ status: 'SUSPENDED' }).where(eq(s.brands.id, tmp.brandId));
    const res = await t.http().get(`${API}/public/order-links/${link.code}`);
    expect(res.status).toBe(404);
    expect(res.body.details.reason).toBe('BRAND_INACTIVE');
  });
});
