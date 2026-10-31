import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import type { TestContext } from './helpers';
import { bootTestApp, courierByCode, createTestBrand, hubId, orderBody } from './ops-factories';

const API = '/api/v1';

/**
 * Assignment engine & dispatch. Maadi is covered by HR-00004 (primary) and
 * HR-00005 (primary); Helwan only by HR-00005. No other test file uses them.
 */
describe('Dispatch (e2e)', () => {
  let t: TestContext;
  let hubMad: string;
  let hero4: string;
  let hero5: string;
  const limits = new Map<string, number>();

  beforeAll(async () => {
    t = await bootTestApp();
    hubMad = await hubId(t, 'HUB-MAD');
    const c4 = await courierByCode(t, 'HR-00004');
    const c5 = await courierByCode(t, 'HR-00005');
    hero4 = c4.id;
    hero5 = c5.id;
    limits.set(hero4, c4.cashLimitCents).set(hero5, c5.cashLimitCents);
    await t.db.update(s.couriers).set({ availability: 'ONLINE', lastLat: 29.961, lastLng: 31.258, lastSeenAt: new Date() }).where(eq(s.couriers.id, hero4));
  });
  afterAll(async () => {
    for (const [id, cashLimitCents] of limits) await t.db.update(s.couriers).set({ cashLimitCents }).where(eq(s.couriers.id, id));
    await t.close();
  });

  async function atMaadiHub(body: Record<string, unknown>) {
    const brand = await createTestBrand(t, { zone: 'CAI-MAADI' });
    const b = await brand.login();
    const created = await b.post(`${API}/orders`).send(orderBody(body));
    expect(created.status).toBe(201);
    const scan = await (await t.as('ops')).post(`${API}/dispatch/scan/inbound`).send({ hubId: hubMad, trackingNumber: created.body.trackingNumber });
    expect(scan.status).toBe(200);
    return { order: created.body, scan: scan.body, brand };
  }

  it('suggests heroes covering the zone and excludes those over their cash limit', async () => {
    const { order, scan } = await atMaadiHub({ address: { line: 'Road 9, Maadi' }, codAmountCents: 200_000 });
    expect(scan.sort.bin).toBe('CAI-MAADI');
    expect(['HR-00004', 'HR-00005']).toContain(scan.sort.suggestedHero.code);
    const ops = await t.as('dispatcher');
    const before = await ops.get(`${API}/dispatch/suggest/${order.id}`);
    expect(before.status).toBe(200);
    const codes = before.body.candidates.map((c: { courier: { code: string } }) => c.courier.code);
    expect(codes.sort()).toEqual(['HR-00004', 'HR-00005']);
    expect(before.body.candidates[0].courier.code).toBe('HR-00004'); // online + next to the zone
    expect(Object.keys(before.body.candidates[0].breakdown)).toEqual(['zone', 'availability', 'distance', 'capacity', 'rating', 'cash']);

    await t.db.update(s.couriers).set({ cashLimitCents: 1_000 }).where(eq(s.couriers.id, hero5));
    const after = await ops.get(`${API}/dispatch/suggest/${order.id}`);
    expect(after.body.candidates.map((c: { courier: { code: string } }) => c.courier.code)).toEqual(['HR-00004']);
    const rejected = after.body.ineligible.find((c: { courier: { code: string } }) => c.courier.code === 'HR-00005');
    expect(rejected.reasons).toContain('CASH_LIMIT');
  });

  it('auto-assigns by zone and cash headroom, then commits to a DRAFT runsheet', async () => {
    await t.db.update(s.couriers).set({ cashLimitCents: 1_000 }).where(eq(s.couriers.id, hero5));
    const maadi = await atMaadiHub({ address: { line: 'Degla, Maadi' }, codAmountCents: 120_000 });
    const helwan = await atMaadiHub({ address: { line: 'Helwan, near the metro station' }, codAmountCents: 80_000 });
    const nasr = await atMaadiHub({ address: { line: 'Makram Ebeid, Nasr City' }, codAmountCents: 10_000 });
    const ops = await t.as('dispatcher');
    const ids = [maadi.order.id, helwan.order.id];

    const plan = await ops.post(`${API}/dispatch/auto-assign`).send({ orderIds: [...ids, nasr.order.id, 'missing-id'], commit: false });
    expect(plan.status).toBe(200);
    expect(plan.body.commit).toBe(false);
    expect(plan.body.assignments).toHaveLength(2); // Maadi → HR-00004, Nasr City → one of its heroes
    expect(plan.body.assignments.find((a: { orderId: string }) => a.orderId === maadi.order.id).courier.code).toBe('HR-00004');
    const unassigned = plan.body.unassigned.find((u: { orderId: string }) => u.orderId === helwan.order.id);
    expect(unassigned.reasons).toContain('CASH_LIMIT'); // only HR-00005 covers Helwan
    expect(plan.body.skipped).toEqual([{ orderId: 'missing-id', reasons: ['NOT_FOUND'] }]);
    expect((await t.db.select({ st: s.orders.status }).from(s.orders).where(eq(s.orders.id, maadi.order.id)))[0].st).toBe('RECEIVED_AT_HUB');

    await t.db.update(s.couriers).set({ cashLimitCents: limits.get(hero5)! }).where(eq(s.couriers.id, hero5));
    const commit = await ops.post(`${API}/dispatch/auto-assign`).send({ orderIds: ids, commit: true });
    expect(commit.body.assignments).toHaveLength(2);
    expect(commit.body.runsheets.length).toBeGreaterThanOrEqual(1);
    const rsId = commit.body.runsheets.find((r: { courierId: string }) => r.courierId === hero4)?.id;
    const rs = await ops.get(`${API}/runsheets/${rsId}`);
    expect(rs.body.status).toBe('DRAFT');
    expect(rs.body.stops.map((x: { id: string }) => x.id)).toContain(maadi.order.id);
    expect((await ops.get(`${API}/orders/${helwan.order.id}`)).body.status).toBe('ASSIGNED');
    const list = await ops.get(`${API}/runsheets?courierId=${hero4}&status=DRAFT`);
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(rsId);
  });

  it('blocks dispatch over the cash limit unless an ops manager overrides', async () => {
    const { order } = await atMaadiHub({ address: { line: 'Sarayat, Maadi' }, codAmountCents: 300_000 });
    const dispatcher = await t.as('dispatcher');
    const rs = (await dispatcher.post(`${API}/runsheets`).send({ courierId: hero4, orderIds: [order.id], hubId: hubMad })).body;
    await t.db.update(s.couriers).set({ cashLimitCents: 100_000 }).where(eq(s.couriers.id, hero4));
    const blocked = await dispatcher.post(`${API}/runsheets/${rs.id}/dispatch`).send({});
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('CASH_LIMIT_EXCEEDED');
    expect(blocked.body.details.excessCents).toBeGreaterThan(0);
    expect((await dispatcher.post(`${API}/runsheets/${rs.id}/dispatch`).send({ override: true })).body.code).toBe('OVERRIDE_NOT_ALLOWED');
    const ok = await (await t.as('ops')).post(`${API}/runsheets/${rs.id}/dispatch`).send({ override: true });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('DISPATCHED');
    await t.db.update(s.couriers).set({ cashLimitCents: limits.get(hero4)! }).where(eq(s.couriers.id, hero4));

    const live = await dispatcher.get(`${API}/dispatch/live?hubId=${hubMad}`);
    expect(live.status).toBe(200);
    const h = live.body.heroes.find((x: { code: string }) => x.code === 'HR-00004');
    expect(h.runsheet.id).toBe(rs.id);
    expect(h.runsheet.progress.pending).toBe(1);
    expect(live.body.orders.map((o: { id: string }) => o.id)).toContain(order.id);
    expect(live.body.counters.outForDelivery).toBeGreaterThanOrEqual(1);
    const audit = await t.db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, rs.id));
    expect(audit.map((a) => a.action)).toContain('runsheet.dispatch_override');
  });

  it('tags SLA breaches once and lists them as at risk', async () => {
    const { order } = await atMaadiHub({ address: { line: 'Zahraa El Maadi' } });
    await t.db.update(s.orders).set({ promisedBy: new Date(Date.now() - 3_600_000) }).where(eq(s.orders.id, order.id));
    const admin = await t.as('admin');
    for (let i = 0; i < 2; i++) expect((await admin.post(`${API}/system/jobs/run?name=dispatch.sla`)).status).toBe(200);
    const [row] = await t.db.select({ tags: s.orders.tags }).from(s.orders).where(eq(s.orders.id, order.id));
    expect(row.tags!.filter((x) => x === 'SLA_BREACH')).toHaveLength(1);
    const ops = await t.as('ops');
    const live = await ops.get(`${API}/dispatch/live?hubId=${hubMad}`);
    const risk = live.body.slaAtRisk.find((o: { id: string }) => o.id === order.id);
    expect(risk.overdue).toBe(true);
    expect((await ops.get(`${API}/orders?slaBreached=true&hubId=${hubMad}`)).body.data.map((o: { id: string }) => o.id)).toContain(order.id);
  });

  it('enforces hub scope and permissions on scans', async () => {
    const brand = await createTestBrand(t, { zone: 'CAI-MAADI' });
    const order = (await (await brand.login()).post(`${API}/orders`).send(orderBody({ address: { line: 'Road 9, Maadi' } }))).body;
    const hubUser = await t.as('hub'); // HUB-NSR operator
    const wrong = await hubUser.post(`${API}/dispatch/scan/inbound`).send({ hubId: hubMad, trackingNumber: order.trackingNumber });
    expect(wrong.status).toBe(403);
    const ok = await hubUser.post(`${API}/dispatch/scan/inbound`).send({ hubId: await hubId(t, 'HUB-NSR'), trackingNumber: order.trackingNumber });
    expect(ok.body.sort).toMatchObject({ isCorrectHub: false, transferTo: 'HUB-MAD' });
    expect((await (await t.as('support')).post(`${API}/dispatch/scan/inbound`).send({ hubId: hubMad, trackingNumber: order.trackingNumber })).status).toBe(403);
    expect((await (await t.as('brandNile')).get(`${API}/dispatch/live`)).status).toBe(403);
    const bad = await (await t.as('ops')).post(`${API}/dispatch/scan/inbound`).send({ hubId: hubMad, trackingNumber: 'GT1234567890' });
    expect([400, 404]).toContain(bad.status);
  });
});
