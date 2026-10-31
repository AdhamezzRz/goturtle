import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { DomainEvents } from '@goturtle/shared';
import * as s from '../src/db/schema';
import { cairoToday } from '../src/db/helpers';
import { CoreEvents, type OtpRequestedEvent } from '../src/core/events';
import type { TestContext } from './helpers';
import { bootTestApp, courierByCode, createTestBrand, hubId, ledgerOf, orderBody, randomPhone, type Agent } from './ops-factories';

const API = '/api/v1';

/** Full first-mile → last-mile flows with money checks. Uses heroes HR-00001 and HR-00002 only. */
describe('Order lifecycle (e2e)', () => {
  let t: TestContext;
  let hubNsr: string;
  let hero1Id: string;
  const otpCodes = new Map<string, string>();
  const events: string[] = [];

  beforeAll(async () => {
    t = await bootTestApp();
    hubNsr = await hubId(t, 'HUB-NSR');
    hero1Id = (await courierByCode(t, 'HR-00001')).id;
    const emitter = t.app.get(EventEmitter2);
    emitter.on(CoreEvents.OtpRequested, (e: OtpRequestedEvent) => e.orderId && otpCodes.set(e.orderId, e.code));
    emitter.on(DomainEvents.OrderStatusChanged, (e: { to: string }) => events.push(e.to));
    emitter.on(DomainEvents.PickupCompleted, () => events.push('PICKUP_COMPLETED'));
  });
  afterAll(() => t.close());

  const walletOf = (brandId: string) => ledgerOf(t).balance({ brandWallet: brandId });
  const payableOf = (courierId: string) => ledgerOf(t).balance({ courierPayable: courierId });
  const cashOf = async (code: string) => (await courierByCode(t, code)).cashOnHandCents;

  async function toHub(orderId: string) {
    const hub = await t.as('hub');
    const [o] = await t.db.select({ tn: s.orders.trackingNumber }).from(s.orders).where(eq(s.orders.id, orderId));
    const res = await hub.post(`${API}/dispatch/scan/inbound`).send({ hubId: hubNsr, trackingNumber: o.tn });
    expect(res.status).toBe(200);
    return res.body;
  }

  async function dispatchRunsheet(courierId: string, orderIds: string[]) {
    const d = await t.as('dispatcher');
    const rs = await d.post(`${API}/runsheets`).send({ courierId, orderIds });
    expect(rs.status).toBe(201);
    const out = await d.post(`${API}/runsheets/${rs.body.id}/dispatch`).send({});
    expect(out.status).toBe(200);
    expect(out.body.status).toBe('DISPATCHED');
    return out.body;
  }

  it('pickup → hub → runsheet → optimize → dispatch → deliver with COD and a balanced ledger', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const o1 = (await b.post(`${API}/orders`).send(orderBody({ codAmountCents: 150_000, address: { line: '5 Abbas El Akkad, Nasr City', lat: 30.0590, lng: 31.3420 } }))).body;
    const o2 = (await b.post(`${API}/orders`).send(orderBody({ codAmountCents: 90_000, address: { line: 'Korba, Heliopolis', lat: 30.0911, lng: 31.3225 } }))).body;
    const o3 = (await b.post(`${API}/orders`).send(orderBody({ codAmountCents: 10_000 }))).body;
    expect([o1.status, o2.status, o3.status]).toEqual(['CREATED', 'CREATED', 'CREATED']);

    const walletBefore = await walletOf(brand.brandId);
    const payableBefore = await payableOf(hero1Id);
    const cashBefore = await cashOf('HR-00001');

    // 1. brand requests a pickup → waiting orders attached
    const pickup = await b.post(`${API}/pickups`).send({ scheduledDate: cairoToday(), timeWindow: '10:00-14:00', expectedCount: 2 });
    expect(pickup.status).toBe(201);
    expect(pickup.body.code).toMatch(/^PU-\d{6}$/);
    expect(pickup.body.ordersCount).toBe(3);
    expect(pickup.body.expectedCount).toBe(3);
    const dup = await b.post(`${API}/pickups`).send({ scheduledDate: pickup.body.scheduledDate });
    expect(dup.body.code).toBe('PICKUP_EXISTS');

    // 2. ops assigns the hero
    const dispatcher = await t.as('dispatcher');
    const assigned = await dispatcher.post(`${API}/pickups/${pickup.body.id}/assign`).send({ courierId: hero1Id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.status).toBe('ASSIGNED');
    expect(assigned.body.orders.every((o: { status: string }) => o.status === 'PICKUP_ASSIGNED')).toBe(true);
    // the brand can still cancel before the parcel is collected
    expect((await b.post(`${API}/orders/${o1.id}/cancel`).send({})).body.status).toBe('CANCELLED');
    const hero = await t.as('hero1');
    const agenda = await hero.get(`${API}/hero/tasks/today`);
    expect(agenda.status).toBe(200);
    expect(agenda.body.pickups.map((x: { id: string }) => x.id)).toContain(pickup.body.id);

    // 3. hero scans two parcels; a foreign parcel is rejected
    const foreign = (await (await t.as('brandNile')).post(`${API}/orders`).send(orderBody())).body;
    const bad = await hero.post(`${API}/hero/tasks/pickups/${pickup.body.id}/scan`).send({ trackingNumber: foreign.trackingNumber });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('ORDER_NOT_IN_PICKUP');
    const scan = await hero.post(`${API}/hero/tasks/pickups/${pickup.body.id}/scan`).send({ trackingNumber: o2.trackingNumber });
    expect(scan.body).toMatchObject({ status: 'PICKED_UP', alreadyScanned: false, scannedCount: 1 });
    expect((await hero.post(`${API}/hero/tasks/pickups/${pickup.body.id}/scan`).send({ trackingNumber: o2.trackingNumber })).body.alreadyScanned).toBe(true);
    // a fresh order (created after the pickup was requested) can be scanned too
    const o4 = (await b.post(`${API}/orders`).send(orderBody({ codAmountCents: 60_000, address: { line: 'Makram Ebeid, Nasr City', lat: 30.0556, lng: 31.3500 } }))).body;
    const done = await hero.post(`${API}/hero/tasks/pickups/${pickup.body.id}/complete`).send({ trackingNumbers: [o4.trackingNumber, 'GT0000000000'] });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.pickedCount).toBe(2);
    expect(done.body.rejected).toHaveLength(1);
    const left = (await b.get(`${API}/orders/${o3.id}`)).body;
    expect(left.status).toBe('CREATED');
    expect(left.pickup).toBeNull();
    expect(events).toContain('PICKUP_COMPLETED');
    expect((await b.post(`${API}/orders/${o2.id}/cancel`).send({})).body.code).toBe('NOT_CANCELLABLE');

    // 4. hub inbound scan with sorting info
    const sorted = await toHub(o2.id);
    expect(sorted.order.status).toBe('RECEIVED_AT_HUB');
    expect(sorted.sort.bin).toBe('CAI-HELIO');
    expect(sorted.sort.isCorrectHub).toBe(true);
    expect((await toHub(o2.id)).alreadyScanned).toBe(true);
    await toHub(o4.id);

    // 5. runsheet → optimize → dispatch
    const rs = await dispatcher.post(`${API}/runsheets`).send({ courierId: hero1Id, orderIds: [o2.id, o4.id] });
    expect(rs.status).toBe(201);
    expect(rs.body.status).toBe('DRAFT');
    expect(rs.body.expectedCodCents).toBe(150_000);
    const opt = await dispatcher.post(`${API}/runsheets/${rs.body.id}/optimize`).send({});
    expect(opt.status).toBe(200);
    expect(opt.body.route).toHaveLength(2);
    expect(opt.body.totalDistanceKm).toBeGreaterThan(0);
    expect(opt.body.stops.map((x: { routeSequence: number }) => x.routeSequence)).toEqual([1, 2]);
    expect(opt.body.stops[0].id).toBe(o4.id); // Makram Ebeid is next to the Nasr City hub
    const manifest = await dispatcher.get(`${API}/runsheets/${rs.body.id}/manifest`);
    expect(manifest.body.totals).toMatchObject({ stops: 2, codCents: 150_000 });
    const dispatched = await dispatcher.post(`${API}/runsheets/${rs.body.id}/dispatch`).send({});
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.stops.every((x: { status: string }) => x.status === 'OUT_FOR_DELIVERY')).toBe(true);
    expect((await dispatcher.post(`${API}/runsheets/${rs.body.id}/orders`).send({ orderIds: [o3.id] })).body.code).toBe('RUNSHEET_LOCKED');

    // 6. hero delivers
    expect((await hero.post(`${API}/hero/tasks/runsheets/${rs.body.id}/start`).send({})).body.status).toBe('IN_PROGRESS');
    const stop = await hero.get(`${API}/hero/tasks/orders/${o4.id}`);
    expect(stop.body).toMatchObject({ collectCents: 60_000, otpRequired: false });
    expect(stop.body.mapsUrl).toContain('destination=30.0556,31.35');
    const wrong = await hero.post(`${API}/hero/tasks/orders/${o4.id}/deliver`).send({ collectedCents: 50_000 });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('COLLECTED_MISMATCH');
    expect((await hero.post(`${API}/hero/tasks/orders/${o4.id}/deliver`).send({ collectedCents: 60_000, receivedBy: 'Self', lat: 30.0556, lng: 31.35 })).body.status).toBe('DELIVERED');
    expect((await hero.post(`${API}/hero/tasks/orders/${o2.id}/deliver`).send({ collectedCents: 90_000 })).body.status).toBe('DELIVERED');
    const after = await dispatcher.get(`${API}/runsheets/${rs.body.id}`);
    expect(after.body.status).toBe('COMPLETED');
    expect(after.body.collectedCents).toBe(150_000);
    expect(after.body.progress).toMatchObject({ total: 2, delivered: 2, percent: 100 });
    const closed = await dispatcher.post(`${API}/runsheets/${rs.body.id}/close`).send({});
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.reconciliation).toMatchObject({ delivered: 2, collectedCents: 150_000, varianceCents: 0 });

    // 7. money
    const ledger = ledgerOf(t);
    expect((await ledger.trialBalance()).balanced).toBe(true);
    expect((await cashOf('HR-00001')) - cashBefore).toBe(150_000);
    const fees = (await b.get(`${API}/orders/${o2.id}`)).body.totalFeesCents + (await b.get(`${API}/orders/${o4.id}`)).body.totalFeesCents;
    expect((await walletOf(brand.brandId)) - walletBefore).toBe(150_000 - fees);
    const hero1 = await courierByCode(t, 'HR-00001');
    expect((await payableOf(hero1Id)) - payableBefore).toBe(2 * hero1.perDeliveryRateCents + hero1.perPickupRateCents);
    const staffView = (await (await t.as('finance')).get(`${API}/orders/${o2.id}`)).body;
    expect(staffView.ledger.map((x: { kind: string }) => x.kind).sort()).toEqual(['COD_COLLECTED', 'COURIER_EARNING', 'ORDER_FEES']);
    expect(staffView.timeline.map((e: { status: string }) => e.status)).toEqual(
      expect.arrayContaining(['CREATED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED']),
    );
    expect(staffView.attempts).toHaveLength(1);
    expect(staffView.attempts[0].success).toBe(true);
    expect(events).toEqual(expect.arrayContaining(['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']));
  });

  it('failed attempts → automatic return → returned to the brand with a return fee', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const ops = await t.as('ops');
    const order = (await b.post(`${API}/orders`).send(orderBody({ codAmountCents: 50_000 }))).body;
    expect((await ops.patch(`${API}/orders/${order.id}`).send({ maxAttempts: 2 })).body.maxAttempts).toBe(2);
    const payableBefore = await payableOf(hero1Id);
    const hero = await t.as('hero1');

    await toHub(order.id);
    const rs1 = await dispatchRunsheet(hero1Id, [order.id]);
    const f1 = await hero.post(`${API}/hero/tasks/orders/${order.id}/fail`).send({ reason: 'CUSTOMER_UNREACHABLE', note: 'Phone off', lat: 30.05, lng: 31.34 });
    expect(f1.status).toBe(200);
    expect(f1.body.status).toBe('FAILED_ATTEMPT');
    expect(f1.body.attempts).toBe(1);
    const dispatcher = await t.as('dispatcher');
    const blocked = await dispatcher.post(`${API}/runsheets/${rs1.id}/close`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('RUNSHEET_OPEN_STOPS');
    expect((await hero.post(`${API}/hero/tasks/orders/${order.id}/return-to-hub`).send({})).body.ok).toBe(true);
    await toHub(order.id);
    expect((await dispatcher.post(`${API}/runsheets/${rs1.id}/close`).send({})).body.reconciliation.backAtHub).toBe(1);

    await dispatchRunsheet(hero1Id, [order.id]);
    const f2 = await hero.post(`${API}/hero/tasks/orders/${order.id}/fail`).send({ reason: 'CUSTOMER_NOT_PRESENT', note: 'Nobody home' });
    expect(f2.body.status).toBe('RETURN_PENDING');
    const detail = (await ops.get(`${API}/orders/${order.id}`)).body;
    const auto = detail.timeline.find((e: { status: string }) => e.status === 'RETURN_PENDING');
    expect(auto).toMatchObject({ actorType: 'SYSTEM', reason: 'MAX_ATTEMPTS' });
    expect(detail.attempts.map((a: { failureReason: string }) => a.failureReason)).toEqual(['CUSTOMER_UNREACHABLE', 'CUSTOMER_NOT_PRESENT']);

    // back at the hub (status stays RETURN_PENDING), then out with a hero to the brand
    const back = await toHub(order.id);
    expect(back.action).toBe('RETURN_RECEIVED');
    expect(back.sort.isReturn).toBe(true);
    const out = await dispatcher.post(`${API}/dispatch/returns/assign`).send({ courierId: hero1Id, orderIds: [order.id] });
    expect(out.body.orders[0].status).toBe('RETURN_OUT');
    const agenda = await hero.get(`${API}/hero/tasks/today`);
    expect(agenda.body.returns.find((r: { orderId: string }) => r.orderId === order.id).destination).toBe('BRAND');
    const returned = await hero.post(`${API}/hero/tasks/orders/${order.id}/returned`).send({ receivedBy: 'Warehouse keeper' });
    expect(returned.body.status).toBe('RETURNED');

    // fees: shipping 55 + VAT on shipping only (COD fee waived) + return fee 50% of shipping + VAT
    const final = (await ops.get(`${API}/orders/${order.id}`)).body;
    expect(final.fees.returnFee).toMatchObject({ feeCents: 2750, vatCents: 385, codFeeWaived: true });
    expect(await walletOf(brand.brandId)).toBe(-(5500 + 770 + 2750 + 385));
    expect((await payableOf(hero1Id)) - payableBefore).toBe(2 * (await courierByCode(t, 'HR-00001')).failedAttemptRateCents);
    expect((await ledgerOf(t).trialBalance()).balanced).toBe(true);
  });

  it('a refusal returns immediately and counts against the customer', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const phone = randomPhone('015');
    const order = (await b.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Hossam', phone } }))).body;
    await toHub(order.id);
    const hero2Id = (await courierByCode(t, 'HR-00002')).id;
    await dispatchRunsheet(hero2Id, [order.id]);
    const hero2 = await t.as('hero2');
    const hero1 = await t.as('hero1');
    expect((await hero1.post(`${API}/hero/tasks/orders/${order.id}/fail`).send({ reason: 'CUSTOMER_REFUSED' })).status).toBe(404);
    const res = await hero2.post(`${API}/hero/tasks/orders/${order.id}/fail`).send({ reason: 'CUSTOMER_REFUSED', note: 'Did not order it' });
    expect(res.body.status).toBe('RETURN_PENDING');
    const [c] = await t.db.select().from(s.customers).where(eq(s.customers.phone, `+20${phone.slice(1)}`));
    expect(c.refusedOrders).toBe(1);
    expect(c.reliabilityScore).toBe(Math.round((4 / 6) * 100));
  });

  it('rejects invalid transitions and foreign heroes', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const order = (await b.post(`${API}/orders`).send(orderBody())).body;
    const hero = await t.as('hero1');
    expect((await hero.post(`${API}/hero/tasks/orders/${order.id}/deliver`).send({ collectedCents: order.collectCents })).status).toBe(404);
    await toHub(order.id);
    const d = await t.as('dispatcher');
    const rs = await d.post(`${API}/runsheets`).send({ courierId: hero1Id, orderIds: [order.id] });
    const early = await hero.post(`${API}/hero/tasks/orders/${order.id}/deliver`).send({ collectedCents: order.collectCents });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('INVALID_TRANSITION');
    expect(early.body.details).toMatchObject({ from: 'ASSIGNED', to: 'DELIVERED' });
    expect((await hero.get(`${API}/hero/tasks/runsheets/${rs.body.id}`)).status).toBe(200);
    expect((await (await t.as('hero2')).get(`${API}/hero/tasks/runsheets/${rs.body.id}`)).status).toBe(404);
    expect((await hero.post(`${API}/orders/${order.id}/status`).send({ status: 'DELIVERED' })).status).toBe(403);
    expect((await hero.post(`${API}/hero/tasks/runsheets/${rs.body.id}/start`).send({})).body.code).toBe('RUNSHEET_NOT_DISPATCHED');
    // back to the pool
    const removed = await d.delete(`${API}/runsheets/${rs.body.id}/orders`).send({ orderIds: [order.id] });
    expect(removed.body.stops).toHaveLength(0);
    expect((await b.get(`${API}/orders/${order.id}`)).body.status).toBe('RECEIVED_AT_HUB');
    expect((await d.post(`${API}/runsheets/${rs.body.id}/dispatch`).send({})).body.code).toBe('RUNSHEET_EMPTY');
  });

  it('requires the recipient OTP when the order asks for it', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const order = (await b.post(`${API}/orders`).send(orderBody({ deliveryOtpRequired: true, codAmountCents: 30_000 }))).body;
    await toHub(order.id);
    await dispatchRunsheet(hero1Id, [order.id]);
    const issued = otpCodes.get(order.id);
    expect(issued).toMatch(/^\d{4}$/);
    const hero = await t.as('hero1');
    expect((await hero.get(`${API}/hero/tasks/orders/${order.id}`)).body.otpRequired).toBe(true);
    const missing = await hero.post(`${API}/hero/tasks/orders/${order.id}/deliver`).send({ collectedCents: 30_000 });
    expect(missing.body.code).toBe('OTP_REQUIRED');
    const wrongCode = issued === '0000' ? '1111' : '0000';
    expect((await hero.post(`${API}/hero/tasks/orders/${order.id}/deliver`).send({ collectedCents: 30_000, otp: wrongCode })).body.code).toBe('OTP_INVALID');
    const resent = await hero.post(`${API}/hero/tasks/orders/${order.id}/resend-otp`).send({});
    expect(resent.body.sent).toBe(true);
    expect((await hero.post(`${API}/hero/tasks/orders/${order.id}/deliver`).send({ collectedCents: 30_000, otp: issued })).body.code).toBe('OTP_INVALID'); // the resend replaced the first code
    const ok = await hero.post(`${API}/hero/tasks/orders/${order.id}/deliver`).send({ collectedCents: 30_000, otp: resent.body.devCode });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('DELIVERED');
  });

  it('creates the return leg when an exchange is delivered', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const order = (await b.post(`${API}/orders`).send(orderBody({ type: 'EXCHANGE', codAmountCents: 0, paymentMethod: 'PREPAID' }))).body;
    expect(order.extraFeesCents).toBe(0);
    await toHub(order.id);
    await dispatchRunsheet(hero1Id, [order.id]);
    const hero = await t.as('hero1');
    expect((await hero.post(`${API}/hero/tasks/orders/${order.id}/deliver`).send({ collectedCents: 0 })).body.status).toBe('DELIVERED');
    const detail = (await b.get(`${API}/orders/${order.id}`)).body;
    expect(detail.childOrders).toHaveLength(1);
    const leg = (await b.get(`${API}/orders/${detail.childOrders[0].id}`)).body;
    expect(leg).toMatchObject({ type: 'RETURN', status: 'PICKED_UP', collectCents: 0, totalFeesCents: 0, parentOrderId: order.id });
    expect(leg.courier.code).toBe('HR-00001');
    expect(leg.pickupLocation.id).toBe(brand.locationId);
  });
});
