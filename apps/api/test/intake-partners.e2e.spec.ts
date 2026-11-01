import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import type { TestContext } from './helpers';
import { bootTestApp, createTestBrand, hubId, ledgerOf, orderBody, zoneId, type Agent } from './ops-factories';
import { staffAgent } from './intake-factories';
import { partnerTrackingUrl } from '../src/modules/partners/partner-adapters';
import { AssignmentService } from '../src/modules/dispatch/assignment.service';

const API = '/api/v1';
const rand = () => Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');

/** Partner carriers modelled as virtual heroes: handoff → outcomes → COD custody → remittance, with a balanced ledger. */
describe('Partner carriers (e2e)', () => {
  let t: TestContext;
  let ops: Agent;
  let finance: Agent;
  let brand: Awaited<ReturnType<typeof createTestBrand>>;
  let b: Agent;
  let hubNsr: string;
  let kheima: string;
  let partner: { id: string; code: string; courier: { id: string; code: string } };
  const code = `Q${rand()}`;

  beforeAll(async () => {
    t = await bootTestApp();
    ops = await staffAgent(t, 'ops');
    finance = await staffAgent(t, 'finance');
    brand = await createTestBrand(t);
    b = await brand.login();
    hubNsr = await hubId(t, 'HUB-NSR');
    kheima = await zoneId(t, 'SHB-KHEIMA'); // Qalyubia — no hero covers it in the seed
  });
  afterAll(() => t.close());

  async function atHub(overrides: Record<string, unknown> = {}) {
    const o = await b.post(`${API}/orders`).send(orderBody({ codAmountCents: 100_000, address: { line: '7 Ahmed Orabi St, Shubra El Kheima', zoneId: kheima }, ...overrides }));
    expect(o.status).toBe(201);
    const scan = await ops.post(`${API}/dispatch/scan/inbound`).send({ hubId: hubNsr, trackingNumber: o.body.trackingNumber });
    expect(scan.status).toBe(200);
    return (await t.db.select().from(s.orders).where(eq(s.orders.id, o.body.id)))[0];
  }
  const order = async (id: string) => (await t.db.select().from(s.orders).where(eq(s.orders.id, id)))[0];

  it('creates a partner as a virtual hero with a disabled login and zero hero rates', async () => {
    const res = await ops.post(`${API}/partners`).send({
      code, name: 'Delta Express', governorateCodes: ['qal'], feeCents: 3_000, returnFeeCents: 1_000,
      trackingUrlTemplate: 'https://track.delta.example/{tn}', credentials: { apiKey: 'secret-key' },
    });
    expect(res.status).toBe(201);
    partner = res.body;
    expect(res.body).toMatchObject({ code, apiType: 'MANUAL', governorateCodes: ['QAL'], feeCents: 3_000, effectiveFeeCents: 3_000, credentialsSet: { apiKey: true }, isActive: true });
    expect(JSON.stringify(res.body)).not.toContain('secret-key');
    expect(res.body.courier.code).toBe(`PT-${code}`);
    const [vc] = await t.db.select().from(s.couriers).where(eq(s.couriers.id, res.body.courier.id));
    expect(vc).toMatchObject({ status: 'ACTIVE', perDeliveryRateCents: 0, perPickupRateCents: 0, failedAttemptRateCents: 0 });
    expect(vc.cashLimitCents).toBeGreaterThan(100_000_000);
    const [u] = await t.db.select().from(s.users).where(eq(s.users.id, vc.userId));
    expect(u).toMatchObject({ status: 'SUSPENDED', role: 'COURIER', phone: `partner:${code}` });

    expect((await ops.post(`${API}/partners`).send({ code, name: 'Again' })).status).toBe(409);
    expect((await ops.post(`${API}/partners`).send({ code: 'bad code', name: 'X' })).status).toBe(400);
    expect((await (await staffAgent(t, 'dispatcher')).post(`${API}/partners`).send({ code: `D${rand()}`, name: 'No perm' })).status).toBe(403);
    expect((await b.get(`${API}/partners`)).status).toBe(403);
    // The partner's virtual hero never shows up as an auto-assignment candidate.
    const candidates = await t.app.get(AssignmentService).candidates();
    expect(candidates.some((c) => c.code.startsWith('PT-'))).toBe(false);
    expect((await ops.get(`${API}/partners`)).body.find((p: { id: string }) => p.id === partner.id)).toBeTruthy();
  });

  it('lists parcels at the hub that our heroes do not serve, with the partners that cover them', async () => {
    const remote = await atHub();
    const local = await atHub({ address: { line: '12 Makram Ebeid St, Nasr City' } });
    const q = await ops.get(`${API}/partners/handoff-queue?pageSize=200`);
    expect(q.status).toBe(200);
    const row = q.body.data.find((r: { id: string }) => r.id === remote.id);
    expect(row).toMatchObject({ servedByHeroes: false, governorate: { code: 'QAL' } });
    expect(row.suggestedPartners.map((p: { code: string }) => p.code)).toContain(code);
    expect(q.body.data.some((r: { id: string }) => r.id === local.id)).toBe(false);
    const all = await ops.get(`${API}/partners/handoff-queue?unservedOnly=false&pageSize=200`);
    expect(all.body.data.find((r: { id: string }) => r.id === local.id)).toMatchObject({ servedByHeroes: true });
  });

  it('hands off, records outcomes, keeps COD in partner custody and takes the remittance as a cash handover', async () => {
    const ledger = ledgerOf(t);
    const o = await atHub();
    const created = await b.post(`${API}/orders`).send(orderBody({ address: { line: '7 Ahmed Orabi St, Shubra El Kheima', zoneId: kheima } }));
    const notAtHub = await ops.post(`${API}/partners/${partner.id}/handoff`).send({ orderIds: [created.body.id] });
    expect(notAtHub.status).toBe(409);
    expect(notAtHub.body.code).toBe('ORDER_NOT_AT_HUB');
    expect((await ops.post(`${API}/partners/${partner.id}/handoff`).send({ orderIds: [o.id], partnerTrackingNumbers: [] })).status).toBe(400);

    const aswan = (await ops.post(`${API}/partners`).send({ code: `A${rand()}`, name: 'Upper Egypt Couriers', governorateCodes: ['ASW'] })).body;
    const outside = await ops.post(`${API}/partners/${aswan.id}/handoff`).send({ orderIds: [o.id] });
    expect(outside.status).toBe(422);
    expect(outside.body.code).toBe('PARTNER_NOT_COVERING');

    const walletBefore = await ledger.balance({ brandWallet: brand.brandId });
    const hand = await ops.post(`${API}/partners/${partner.id}/handoff`).send({ orderIds: [o.id], partnerTrackingNumbers: ['DLX-77001'] });
    expect(hand.status).toBe(200);
    expect(hand.body.orders[0]).toMatchObject({ partnerTrackingNumber: 'DLX-77001', partnerTrackingUrl: 'https://track.delta.example/DLX-77001' });
    let row = await order(o.id);
    expect(row).toMatchObject({ status: 'OUT_FOR_DELIVERY', courierId: partner.courier.id, partnerCarrierId: partner.id, partnerTrackingNumber: 'DLX-77001', runsheetId: null });
    expect(row.handedToPartnerAt).toBeTruthy();
    const [evt] = await t.db.select().from(s.orderEvents).where(eq(s.orderEvents.orderId, o.id)).orderBy(s.orderEvents.createdAt);
    expect(evt).toBeTruthy();

    const track = await t.http().get(`${API}/track/${row.trackingNumber}`);
    expect(track.status).toBe(200);
    expect(track.body.partner).toMatchObject({ name: 'Delta Express', trackingNumber: 'DLX-77001', trackingUrl: 'https://track.delta.example/DLX-77001' });
    expect(track.body.hero).toBeNull();

    // Partner attempt fails, then delivers on the next try.
    const failed = await ops.post(`${API}/partners/${partner.id}/status`).send({ updates: [{ trackingNumber: row.trackingNumber, outcome: 'FAILED', reason: 'CUSTOMER_NOT_PRESENT', partnerReference: 'ATT-1' }] });
    expect(failed.body).toMatchObject({ applied: 1, failed: 0 });
    row = await order(o.id);
    expect(row).toMatchObject({ status: 'FAILED_ATTEMPT', attempts: 1, courierId: partner.courier.id });
    expect(await ledger.balance({ courierPayable: partner.courier.id })).toBe(0);

    const delivered = await ops.post(`${API}/partners/${partner.id}/status`).send({ updates: [{ partnerTrackingNumber: 'DLX-77001', outcome: 'DELIVERED', partnerReference: 'POD-9' }, { partnerTrackingNumber: 'UNKNOWN-1', outcome: 'DELIVERED' }] });
    expect(delivered.body).toMatchObject({ applied: 1, failed: 1 });
    expect(delivered.body.results[1]).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    row = await order(o.id);
    expect(row).toMatchObject({ status: 'DELIVERED', collectedCents: row.collectCents, courierId: partner.courier.id });
    const collect = row.collectCents;
    expect(collect).toBe(100_000);
    expect(await ledger.balance({ courierCustody: partner.courier.id })).toBe(collect);
    expect(await ledger.balance({ courierPayable: partner.courier.id })).toBe(3_000);
    expect(await ledger.balance({ brandWallet: brand.brandId })).toBe(walletBefore + collect - row.totalFeesCents);
    expect((await t.http().get(`${API}/track/${row.trackingNumber}`)).body.partner.name).toBe('Delta Express');

    const again = await ops.post(`${API}/partners/${partner.id}/status`).send({ updates: [{ orderId: o.id, outcome: 'DELIVERED' }] });
    expect(again.body.results[0]).toMatchObject({ ok: false, code: 'NOT_WITH_PARTNER' });

    const custody = await finance.get(`${API}/partners/${partner.id}/custody`);
    expect(custody.status).toBe(200);
    expect(custody.body).toMatchObject({ custodyCents: collect, feesPayableCents: 3_000, netOwedToUsCents: collect - 3_000, unremittedOrders: { count: 1, collectedCents: collect } });

    // Remittance = a normal cash handover on the virtual hero.
    const remit = await finance.post(`${API}/cash/handovers`).send({ courierId: partner.courier.id, amountCents: collect, method: 'BANK_TRANSFER', reference: 'DELTA-REMIT-001' });
    expect(remit.status).toBe(201);
    expect(remit.body.status).toBe('CONFIRMED');
    expect(await ledger.balance({ courierCustody: partner.courier.id })).toBe(0);
    expect((await order(o.id)).cashHandoverId).toBe(remit.body.id);
    const after = (await finance.get(`${API}/partners/${partner.id}/custody`)).body;
    expect(after).toMatchObject({ custodyCents: 0, unremittedOrders: { count: 0 } });
    expect(after.recentHandovers[0]).toMatchObject({ id: remit.body.id, status: 'CONFIRMED' });

    const shipments = await ops.get(`${API}/partners/${partner.id}/shipments?state=delivered`);
    expect(shipments.body.data.find((x: { id: string }) => x.id === o.id)).toMatchObject({ remitted: true, partnerTrackingUrl: 'https://track.delta.example/DLX-77001' });

    expect((await ledger.trialBalance()).balanced).toBe(true);
  });

  it('a parcel the partner brings back returns to the hub and on to the brand, with the return fee', async () => {
    const ledger = ledgerOf(t);
    const o = await atHub({ codAmountCents: 50_000 });
    const payableBefore = await ledger.balance({ courierPayable: partner.courier.id });
    expect((await ops.post(`${API}/partners/${partner.id}/handoff`).send({ orderIds: [o.id] })).status).toBe(200);
    expect((await ops.get(`${API}/partners/${partner.id}/shipments?state=active`)).body.data.some((x: { id: string }) => x.id === o.id)).toBe(true);
    const res = await ops.post(`${API}/partners/${partner.id}/status`).send({ updates: [{ orderId: o.id, outcome: 'RETURNED', reason: 'CUSTOMER_REFUSED', note: 'Refused at door' }] });
    expect(res.body.results[0]).toMatchObject({ ok: true, status: 'RETURN_PENDING' });
    const row = await order(o.id);
    expect(row).toMatchObject({ status: 'RETURN_PENDING', courierId: null, partnerCarrierId: partner.id });
    expect(await ledger.balance({ courierPayable: partner.courier.id })).toBe(payableBefore + 1_000);
    expect((await t.http().get(`${API}/track/${row.trackingNumber}`)).body.partner).toBeNull();
    expect((await ops.get(`${API}/partners/${partner.id}/shipments?state=returned`)).body.data.some((x: { id: string }) => x.id === o.id)).toBe(true);
    expect((await ledger.trialBalance()).balanced).toBe(true);
  });

  it('updates and deactivates partners; inactive partners take no new parcels', async () => {
    const upd = await ops.patch(`${API}/partners/${partner.id}`).send({ name: 'Delta Express Co', feeCents: null, credentials: { apiKey: '' } });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ name: 'Delta Express Co', feeCents: null, credentialsSet: {} });
    expect(upd.body.effectiveFeeCents).toBe(4_000); // settings platform.partnerFeeCents default
    const [vcUser] = await t.db.select({ name: s.users.name }).from(s.users).innerJoin(s.couriers, eq(s.couriers.userId, s.users.id)).where(eq(s.couriers.id, partner.courier.id));
    expect(vcUser.name).toBe('Delta Express Co (partner)');
    await ops.patch(`${API}/partners/${partner.id}`).send({ isActive: false });
    const o = await atHub();
    const res = await ops.post(`${API}/partners/${partner.id}/handoff`).send({ orderIds: [o.id] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PARTNER_INACTIVE');
    await ops.patch(`${API}/partners/${partner.id}`).send({ isActive: true });
  });

  it('tracking URL templates', () => {
    expect(partnerTrackingUrl('https://x.example/t/{tn}?l=ar', 'A B')).toBe('https://x.example/t/A%20B?l=ar');
    expect(partnerTrackingUrl('https://x.example/track?n=', 'A1')).toBe('https://x.example/track?n=A1');
    expect(partnerTrackingUrl(null, 'A1')).toBeNull();
    expect(partnerTrackingUrl('https://x/{tn}', null)).toBeNull();
  });
});
