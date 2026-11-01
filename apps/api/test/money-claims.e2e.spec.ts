import { eq } from 'drizzle-orm';
import { courierAdjustments, orderEvents } from '../src/db/schema';
import { SettingsService } from '../src/modules/settings/settings.service';
import type { TestContext } from './helpers';
import { bootTestApp } from './ops-factories';
import { API, assertBalanced, balance, insertOrder, moneyBrand, moneyHero, notificationsFor, postingOf, wallet } from './money-factories';

const HOUR = 3_600_000;
const CLAIMS = { company: 'EXPENSE_CLAIMS' } as const;

describe('Claims — lost / damaged / missing / wrong / delayed (e2e)', () => {
  let t: TestContext;
  let brand: Awaited<ReturnType<typeof moneyBrand>>;
  let other: Awaited<ReturnType<typeof moneyBrand>>;
  let hero: Awaited<ReturnType<typeof moneyHero>>;

  beforeAll(async () => {
    t = await bootTestApp();
    brand = await moneyBrand(t);
    other = await moneyBrand(t);
    hero = await moneyHero(t);
    const fin = await t.app.get(SettingsService).get('finance');
    expect(fin.claimDefaultCapCents).toBe(500_000);
    expect(fin.claimWindowHours).toBe(72);
  });
  afterAll(() => t.close());

  const file = (body: Record<string, unknown>, who = brand) => who.owner.post(`${API}/claims`).send({ description: 'The parcel arrived in a bad state, photos attached.', ...body });

  it('validates eligibility per type', async () => {
    const delivered = await insertOrder(t, { brandId: brand.id, status: 'DELIVERED', codCents: 50_000, courierId: hero.id, deliveredAt: new Date(Date.now() - 2 * HOUR) });
    const lost = await file({ orderId: delivered.id, type: 'LOST', claimedCents: 10_000 });
    expect(lost.status).toBe(422);
    expect(lost.body.code).toBe('CLAIM_NOT_ELIGIBLE');

    const old = await insertOrder(t, { brandId: brand.id, status: 'DELIVERED', codCents: 50_000, courierId: hero.id, deliveredAt: new Date(Date.now() - 100 * HOUR) });
    expect((await file({ orderId: old.id, type: 'DAMAGED', claimedCents: 10_000 })).body.code).toBe('CLAIM_NOT_ELIGIBLE');
    expect((await file({ orderId: delivered.id, type: 'DELAYED', claimedCents: 10_000 })).body.code).toBe('CLAIM_NOT_ELIGIBLE'); // no promise

    const moving = await insertOrder(t, { brandId: brand.id, status: 'RECEIVED_AT_HUB', codCents: 20_000 });
    expect((await file({ orderId: moving.id, type: 'LOST', claimedCents: 10_000 })).body.code).toBe('CLAIM_NOT_ELIGIBLE'); // moved recently

    expect((await file({ trackingNumber: delivered.trackingNumber, type: 'MISSING_ITEMS', claimedCents: 10_000, evidence: ['javascript:alert(1)'] })).status).toBe(400);
    expect((await file({ type: 'DAMAGED', claimedCents: 10_000 })).body.code).toBe('ORDER_REQUIRED');
    expect((await file({ orderId: delivered.id, type: 'DAMAGED', claimedCents: 10_000 }, other)).body.code).toBe('INVALID_ORDER');
  });

  it('accepts a stuck parcel as LOST and caps liability at the declared value or the default cap', async () => {
    const stuck = await insertOrder(t, { brandId: brand.id, status: 'RECEIVED_AT_HUB', codCents: 30_000, declaredValueCents: 80_000, updatedAt: new Date(Date.now() - 200 * HOUR) });
    await t.db.insert(orderEvents).values({ orderId: stuck.id, status: 'RECEIVED_AT_HUB', fromStatus: 'PICKED_UP', actorType: 'STAFF', actorName: 'Hub', createdAt: new Date(Date.now() - 150 * HOUR) });
    const res = await file({ orderId: stuck.id, type: 'LOST', claimedCents: 120_000, evidence: ['/api/v1/files/ticket_attachment/2026-10/abc.jpg'] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'OPEN', type: 'LOST', claimedCents: 120_000, liabilityCapCents: 80_000, capBasis: 'DECLARED_VALUE', courier: null });
    expect(res.body.code).toMatch(/^CL-\d{6}$/);

    const lost = await insertOrder(t, { brandId: brand.id, status: 'LOST', codCents: 0 });
    const big = await file({ orderId: lost.id, type: 'LOST', claimedCents: 900_000 });
    expect(big.body).toMatchObject({ liabilityCapCents: 500_000, capBasis: 'DEFAULT_CAP' });
    const small = await insertOrder(t, { brandId: brand.id, status: 'LOST', codCents: 0 });
    expect((await file({ orderId: small.id, type: 'LOST', claimedCents: 40_000 })).body.liabilityCapCents).toBe(40_000);
  });

  it('allows one open claim per order and type', async () => {
    const o = await insertOrder(t, { brandId: brand.id, status: 'DELIVERED', codCents: 70_000, courierId: hero.id, deliveredAt: new Date(Date.now() - HOUR), promisedBy: new Date(Date.now() - 5 * HOUR) });
    expect((await file({ orderId: o.id, type: 'DAMAGED', claimedCents: 25_000 })).status).toBe(201);
    const dup = await file({ orderId: o.id, type: 'DAMAGED', claimedCents: 25_000 });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CLAIM_EXISTS');
    expect((await file({ orderId: o.id, type: 'DELAYED', claimedCents: 5_000 })).status).toBe(201);
  });

  it('review → approve (with hero charge) → pay: Dr 5300 claims / Cr brand wallet, settled next time', async () => {
    const o = await insertOrder(t, { brandId: brand.id, status: 'DELIVERED', codCents: 60_000, courierId: hero.id, deliveredAt: new Date(Date.now() - HOUR), declaredValueCents: 45_000 });
    const filed = await file({ orderId: o.id, type: 'WRONG_ITEM', claimedCents: 50_000 });
    expect(filed.body.liabilityCapCents).toBe(45_000);
    const id = filed.body.id;
    const support = await t.as('support');
    const fin = await t.as('finance');
    expect((await brand.owner.post(`${API}/claims/${id}/review`).send({})).status).toBe(403);
    expect((await (await t.as('hub')).post(`${API}/claims/${id}/review`).send({})).status).toBe(403);
    expect((await support.post(`${API}/claims/${id}/review`).send({})).body.status).toBe('UNDER_REVIEW');
    expect((await support.post(`${API}/claims/${id}/approve`).send({ approvedCents: 40_000, decisionNote: 'ok' })).status).toBe(403);
    expect((await fin.post(`${API}/claims/${id}/pay`).send({})).body.code).toBe('INVALID_STATE');
    const above = await fin.post(`${API}/claims/${id}/approve`).send({ approvedCents: 45_001, decisionNote: 'Wrong item confirmed' });
    expect(above.status).toBe(422);
    expect(above.body.code).toBe('ABOVE_LIABILITY_CAP');
    expect((await fin.post(`${API}/claims/${id}/approve`).send({ approvedCents: 40_000, decisionNote: 'Too much', chargeHeroCents: 40_001 })).body.code).toBe('CHARGE_ABOVE_APPROVED');

    const payable0 = await balance(t, { courierPayable: hero.id });
    const ok = await fin.post(`${API}/claims/${id}/approve`).send({ approvedCents: 40_000, decisionNote: 'Wrong item confirmed by the hub photo', chargeHeroCents: 15_000 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'APPROVED', approvedCents: 40_000, decisionNote: 'Wrong item confirmed by the hub photo' });
    expect(await balance(t, { courierPayable: hero.id })).toBe(payable0 - 15_000);
    const [penalty] = await t.db.select().from(courierAdjustments).where(eq(courierAdjustments.orderId, o.id));
    expect(penalty).toMatchObject({ type: 'PENALTY', amountCents: 15_000, courierId: hero.id });
    expect(penalty.reason).toContain(filed.body.code);

    const [w0, e0] = [await wallet(t, brand.id), await balance(t, CLAIMS)];
    const paid = await fin.post(`${API}/claims/${id}/pay`).send({});
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.paidAt).toBeTruthy();
    expect(await wallet(t, brand.id)).toBe(w0 + 40_000);
    expect(await balance(t, CLAIMS)).toBe(e0 + 40_000);
    expect(await postingOf(t, `claim:${id}:payout`)).toEqual({ kind: 'CLAIM_PAYOUT', lines: { '5300': 40_000, [`2100:BRAND:${brand.id}`]: -40_000 } });
    expect((await fin.post(`${API}/claims/${id}/pay`).send({})).body.code).toBe('INVALID_STATE');

    const detail = await brand.owner.get(`${API}/claims/${id}`);
    expect(detail.body.timeline.map((x: { status: string }) => x.status)).toEqual(['OPEN', 'UNDER_REVIEW', 'APPROVED', 'PAID']);
    expect(detail.body.courier).toBeNull();
    expect(detail.body.timeline.every((x: { chargeHeroCents: number | null }) => x.chargeHeroCents === null)).toBe(true);
    expect((await notificationsFor(t, brand.ownerUserId, 'claim_update')).length).toBe(3);
    await assertBalanced(t);
  });

  it('pays the claim out with the next settlement as an adjustment', async () => {
    const claimsBrand = await moneyBrand(t);
    const lost = await insertOrder(t, { brandId: claimsBrand.id, status: 'LOST', codCents: 0, declaredValueCents: 33_000 });
    const filed = await file({ orderId: lost.id, type: 'LOST', claimedCents: 33_000 }, claimsBrand);
    const fin = await t.as('finance');
    await fin.post(`${API}/claims/${filed.body.id}/approve`).send({ approvedCents: 33_000, decisionNote: 'Lost in transit' });
    await fin.post(`${API}/claims/${filed.body.id}/pay`).send({});
    const gen = await fin.post(`${API}/finance/settlements/generate`).send({ brandId: claimsBrand.id });
    expect(gen.body.created).toHaveLength(1);
    const s = gen.body.created[0];
    expect(s).toMatchObject({ ordersCount: 0, adjustmentsCents: 33_000, netPayableCents: 33_000 });
    const detail = await fin.get(`${API}/finance/settlements/${s.id}`);
    expect(detail.body.adjustmentLines).toEqual([expect.objectContaining({ kind: 'CLAIM_PAYOUT', amountCents: 33_000, orderId: lost.id })]);
    await fin.post(`${API}/finance/settlements/${s.id}/approve`).send({});
    await fin.post(`${API}/finance/settlements/${s.id}/pay`).send({ paymentReference: 'CLAIM-PAY' });
    expect(await wallet(t, claimsBrand.id)).toBe(0);
    await assertBalanced(t);
  });

  it('rejects with a note and scopes reads per brand', async () => {
    const o = await insertOrder(t, { brandId: brand.id, status: 'RETURNED', codCents: 0, returnedAt: new Date(Date.now() - 3 * HOUR) });
    const filed = await file({ orderId: o.id, type: 'DAMAGED', claimedCents: 9_000 });
    expect(filed.status).toBe(201);
    expect((await other.owner.get(`${API}/claims/${filed.body.id}`)).status).toBe(404);
    expect((await other.owner.get(`${API}/claims`)).body.data.every((c: { brandId: string }) => c.brandId === other.id)).toBe(true);
    const support = await t.as('support');
    expect((await support.post(`${API}/claims/${filed.body.id}/reject`).send({ note: '' })).status).toBe(400);
    const res = await support.post(`${API}/claims/${filed.body.id}/reject`).send({ note: 'Packaging was intact at hand-over' });
    expect(res.body).toMatchObject({ status: 'REJECTED', decisionNote: 'Packaging was intact at hand-over' });
    // A rejected claim does not block a new one.
    expect((await file({ orderId: o.id, type: 'DAMAGED', claimedCents: 9_000 })).status).toBe(201);
    const list = await (await t.as('ops')).get(`${API}/claims`).query({ brandId: brand.id, status: 'REJECTED' });
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(filed.body.id);
    expect(list.body.data[0].courier === null || typeof list.body.data[0].courier === 'object').toBe(true);
  });
});
