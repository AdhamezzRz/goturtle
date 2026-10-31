import request from 'supertest';
import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { addDays } from '../src/modules/orders/ops-kit';
import { cairoToday } from '../src/db/helpers';
import type { TestContext } from './helpers';
import { bearer, bootTestApp, courierByCode, createTestBrand, customerToken, customerTokenFor, hubId, orderBody, randomPhone, tokenFor } from './ops-factories';

const API = '/api/v1';

/** Public tracking & customer self-service. Uses hero HR-00006 (Mohandessin / Dokki / Zamalek) only. */
describe('Tracking (e2e)', () => {
  let t: TestContext;
  let hero6: string;
  beforeAll(async () => {
    t = await bootTestApp();
    hero6 = (await courierByCode(t, 'HR-00006')).id;
  });
  afterAll(() => t.close());

  const publicTrack = (tn: string, token?: string) => {
    const r = request(t.app.getHttpServer()).get(`${API}/track/${tn}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('hides sensitive data publicly and unlocks details and live position for the verified customer', async () => {
    const brand = await createTestBrand(t, { zone: 'GIZ-MOHANDESSIN' });
    const b = await brand.login();
    const phone = randomPhone('012');
    const e164 = `+20${phone.slice(1)}`;
    const order = (await b.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Nada Kamal Ibrahim', phone }, address: { line: '٢٢ شارع جامعة الدول العربية، المهندسين', building: '22', floor: '5' }, codAmountCents: 95_000 }))).body;
    expect(order.zone.code).toBe('GIZ-MOHANDESSIN');

    const pub = await publicTrack(order.trackingNumber);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ trackingNumber: order.trackingNumber, status: 'CREATED', step: 0, verified: false, brand: { name: `Test Brand ${brand.code}` } });
    expect(pub.body.statusLabel.ar).toBe('تم الإنشاء');
    expect(pub.body.recipient).toEqual({ firstName: 'Nada', phone: `${phone.slice(0, 4)}****${phone.slice(-3)}` });
    expect(pub.body.destination.zone.en).toBe('Mohandessin & Agouza');
    const text = JSON.stringify(pub.body);
    expect(text).not.toContain(e164);
    expect(text).not.toContain('جامعة الدول');
    expect(text).not.toContain('95000');
    expect(pub.body.details).toBeUndefined();
    expect((await publicTrack('GT12345')).status).toBe(400);

    // real OTP flow once (the endpoint is rate limited) — other sessions are minted directly
    const token = await customerToken(t, phone, order.trackingNumber);
    const mine = await publicTrack(order.trackingNumber, token);
    expect(mine.body.verified).toBe(true);
    expect(mine.body.details).toMatchObject({ amountToPayCents: 95_000, phone: e164 });
    expect(mine.body.can).toEqual({ reschedule: true, editAddress: true, rate: false });
    const stranger = await publicTrack(order.trackingNumber, await customerTokenFor(t, '+201099999999'));
    expect(stranger.body.verified).toBe(false);

    // customer pins the address and adds a landmark
    const cust = bearer(t, token);
    const far = await cust.patch(`${API}/track/${order.trackingNumber}/address`).send({ lat: 30.0444, lng: 31.6 });
    expect(far.body.code).toBe('PIN_OUT_OF_ZONE');
    const addr = await cust.patch(`${API}/track/${order.trackingNumber}/address`).send({ landmark: 'Above Cilantro', lat: 30.0571, lng: 31.2012, notes: 'Ring twice' });
    expect(addr.status).toBe(200);
    expect(addr.body.details.address).toMatchObject({ landmark: 'Above Cilantro', lat: 30.0571 });
    expect(addr.body.timeline.some((e: { reason: string }) => e.reason === 'CUSTOMER_ADDRESS_UPDATE')).toBe(true);

    // out for delivery with HR-00006
    await (await t.as('ops')).post(`${API}/dispatch/scan/inbound`).send({ hubId: await hubId(t, 'HUB-GIZ'), trackingNumber: order.trackingNumber });
    const d = await t.as('dispatcher');
    const rs = (await d.post(`${API}/runsheets`).send({ courierId: hero6, orderIds: [order.id] })).body;
    expect((await d.post(`${API}/runsheets/${rs.id}/dispatch`).send({})).status).toBe(200);
    await t.db.update(s.couriers).set({ lastLat: 30.055, lastLng: 31.205, lastSeenAt: new Date() }).where(eq(s.couriers.id, hero6));

    const outPublic = (await publicTrack(order.trackingNumber)).body;
    expect(outPublic.status).toBe('OUT_FOR_DELIVERY');
    expect(outPublic.step).toBe(3);
    expect(outPublic.hero).toMatchObject({ firstName: 'Hassan', vehicleType: 'CAR' });
    expect(outPublic.heroLocation).toBeNull();
    expect(new Date(outPublic.eta).getTime()).toBeGreaterThan(Date.now() - 60_000);
    const outMine = (await publicTrack(order.trackingNumber, token)).body;
    expect(outMine.heroLocation).toMatchObject({ lat: 30.055, lng: 31.205 });
    expect((await cust.patch(`${API}/track/${order.trackingNumber}/address`).send({ landmark: 'x' })).body.code).toBe('ADDRESS_LOCKED');
    expect((await cust.post(`${API}/track/${order.trackingNumber}/reschedule`).send({ date: addDays(cairoToday(), 2) })).body.code).toBe('RESCHEDULE_NOT_ALLOWED');

    // delivered → rate once
    const heroAgent = bearer(t, await tokenFor(t, (await courierByCode(t, 'HR-00006')).userId, 'COURIER'));
    expect((await heroAgent.post(`${API}/hero/tasks/orders/${order.id}/deliver`).send({ collectedCents: 95_000 })).body.status).toBe('DELIVERED');
    const before = await courierByCode(t, 'HR-00006');
    const rate = await cust.post(`${API}/track/${order.trackingNumber}/rate`).send({ rating: 5, comment: 'Fast and polite' });
    expect(rate.status).toBe(200);
    const after = await courierByCode(t, 'HR-00006');
    expect(after.ratingCount).toBe(before.ratingCount + 1);
    expect(after.rating).toBeCloseTo((before.rating * before.ratingCount + 5) / (before.ratingCount + 1), 2);
    expect((await cust.post(`${API}/track/${order.trackingNumber}/rate`).send({ rating: 1 })).body.code).toBe('ALREADY_RATED');
    expect((await publicTrack(order.trackingNumber)).body.heroLocation).toBeNull();

    const list = await cust.get(`${API}/track/me/orders`);
    expect(list.body.orders.map((o: { trackingNumber: string }) => o.trackingNumber)).toContain(order.trackingNumber);
    // customer tokens cannot reach staff or brand endpoints
    expect((await cust.get(`${API}/orders`)).status).toBe(403);
  });

  it('lets the customer reschedule before dispatch and after a failed attempt', async () => {
    const brand = await createTestBrand(t, { zone: 'GIZ-DOKKI' });
    const b = await brand.login();
    const phone = randomPhone('010');
    const e164 = `+20${phone.slice(1)}`;
    const order = (await b.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Yara', phone }, address: { line: 'Mesaha Square, Dokki' } }))).body;
    const cust = bearer(t, await customerTokenFor(t, e164));
    expect((await cust.post(`${API}/track/${order.trackingNumber}/reschedule`).send({ date: addDays(cairoToday(), 9) })).body.code).toBe('INVALID_DATE');
    const day = addDays(cairoToday(), 3);
    const res = await cust.post(`${API}/track/${order.trackingNumber}/reschedule`).send({ date: day, note: 'Travelling' });
    expect(res.status).toBe(200);
    expect(res.body.scheduledDate).toBe(day);
    expect(res.body.status).toBe('CREATED');
    expect(res.body.timeline.at(-1)).toMatchObject({ reason: 'CUSTOMER_RESCHEDULED', isStatusChange: false });

    // failed attempt → RESCHEDULED by the customer
    await (await t.as('ops')).post(`${API}/dispatch/scan/inbound`).send({ hubId: await hubId(t, 'HUB-GIZ'), trackingNumber: order.trackingNumber });
    const d = await t.as('dispatcher');
    const rs = (await d.post(`${API}/runsheets`).send({ courierId: hero6, orderIds: [order.id] })).body;
    await d.post(`${API}/runsheets/${rs.id}/dispatch`).send({});
    const heroAgent = bearer(t, await tokenFor(t, (await courierByCode(t, 'HR-00006')).userId, 'COURIER'));
    expect((await heroAgent.post(`${API}/hero/tasks/orders/${order.id}/fail`).send({ reason: 'CUSTOMER_NOT_PRESENT' })).body.status).toBe('FAILED_ATTEMPT');
    const next = addDays(cairoToday(), 1);
    const again = await cust.post(`${API}/track/${order.trackingNumber}/reschedule`).send({ date: next });
    expect(again.body.status).toBe('RESCHEDULED');
    expect(again.body.scheduledDate).toBe(next);
    const staff = (await (await t.as('support')).get(`${API}/orders/${order.id}`)).body;
    expect(staff.timeline.at(-1)).toMatchObject({ status: 'RESCHEDULED', actorType: 'CUSTOMER' });
    // other customers cannot act on the shipment
    const other = bearer(t, await customerTokenFor(t, '+201011111111'));
    expect((await other.post(`${API}/track/${order.trackingNumber}/reschedule`).send({ date: next })).status).toBe(404);
  });
});
