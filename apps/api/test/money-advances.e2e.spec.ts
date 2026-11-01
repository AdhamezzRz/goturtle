import { eq } from 'drizzle-orm';
import { applyBp } from '@goturtle/shared';
import { brandAdvances, orders } from '../src/db/schema';
import { PostingsService } from '../src/core/ledger/postings.service';
import { maxAmountWithFee } from '../src/modules/money-programs/advances.service';
import type { TestContext } from './helpers';
import { bootTestApp } from './ops-factories';
import {
  API, assertBalanced, balance, deliveredOrder, insertOrder, ledger, moneyBrand, moneyHero, notificationsFor, postingOf, wallet,
} from './money-factories';

const BANK = { company: 'BANK' } as const;
const FIN_REV = { company: 'REVENUE_FINANCE' } as const;

describe('Money programs — early payouts & COD advances (e2e)', () => {
  let t: TestContext;
  let hero: Awaited<ReturnType<typeof moneyHero>>;

  beforeAll(async () => {
    t = await bootTestApp();
    hero = await moneyHero(t);
  });
  afterAll(() => t.close());

  /** Cash the brand already received ahead of settlements (paid advances). */
  async function advancedToBrand(brandId: string) {
    const advances = await t.db.select().from(brandAdvances).where(eq(brandAdvances.brandId, brandId));
    return advances.filter((a) => a.paidAt).reduce((sum, a) => sum + a.amountCents, 0);
  }

  it('computes the maximum amount so that amount + fee fits exactly', () => {
    expect(maxAmountWithFee(10_100, 100)).toBe(10_000);
    expect(maxAmountWithFee(10_099, 100)).toBe(9_999);
    expect(maxAmountWithFee(0, 100)).toBe(0);
    for (const avail of [1, 99, 101, 12_345, 987_654]) {
      const a = maxAmountWithFee(avail, 250);
      expect(a + applyBp(a, 250)).toBeLessThanOrEqual(avail);
      expect(a + 1 + applyBp(a + 1, 250)).toBeGreaterThan(avail);
    }
  });

  describe('full cycle: early payout + COD advance + settlement recovery', () => {
    let brand: Awaited<ReturnType<typeof moneyBrand>>;
    let walletStart = 0;
    let inTransitIds: string[] = [];
    let earlyId = '';
    let codId = '';

    beforeAll(async () => {
      brand = await moneyBrand(t, { withStaff: true });
      await deliveredOrder(t, { brandId: brand.id, codCents: 100_000, courierId: hero.id });
      await deliveredOrder(t, { brandId: brand.id, codCents: 50_000, courierId: hero.id });
      const a = await insertOrder(t, { brandId: brand.id, status: 'OUT_FOR_DELIVERY', codCents: 80_000, courierId: hero.id });
      const b = await insertOrder(t, { brandId: brand.id, status: 'RECEIVED_AT_HUB', codCents: 40_000 });
      await insertOrder(t, { brandId: brand.id, status: 'CREATED', codCents: 999_000 }); // not picked up yet: no advance against it
      inTransitIds = [a.id, b.id];
      walletStart = await wallet(t, brand.id);
    });

    it('shows eligibility: wallet for early payouts, 50 % of in-transit COD for advances', async () => {
      const res = await brand.owner.get(`${API}/finance/brand/advances/eligibility`).query({ amountCents: 50_000 });
      expect(res.status).toBe(200);
      expect(res.body.earlyPayout).toMatchObject({ walletCents: walletStart, openSettlementsCents: 0, pendingRequestsCents: 0, availableCents: walletStart, feeBp: 100, eligible: true });
      expect(res.body.earlyPayout.maxAmountCents).toBe(maxAmountWithFee(walletStart, 100));
      expect(res.body.earlyPayout.preview).toEqual({ amountCents: 50_000, feeCents: 500, totalCents: 50_500 });
      expect(res.body.codAdvance).toMatchObject({ inTransitOrders: 2, inTransitCodCents: 120_000, maxRateBp: 5000, capCents: 60_000, outstandingCents: 0, availableCents: 60_000, feeBp: 250 });
      expect(res.body.codAdvance.preview).toEqual({ amountCents: 50_000, feeCents: 1250, totalCents: 51_250 });
    });

    it('only the owner can request, within limits', async () => {
      const staff = await brand.staff!.post(`${API}/finance/brand/advances`).send({ type: 'EARLY_PAYOUT', amountCents: 50_000 });
      expect(staff.status).toBe(403);
      const tooMuch = await brand.owner.post(`${API}/finance/brand/advances`).send({ type: 'EARLY_PAYOUT', amountCents: walletStart });
      expect(tooMuch.status).toBe(422);
      expect(tooMuch.body.code).toBe('ADVANCE_NOT_ELIGIBLE');
      const tiny = await brand.owner.post(`${API}/finance/brand/advances`).send({ type: 'EARLY_PAYOUT', amountCents: 5_000 });
      expect(tiny.body.code).toBe('ADVANCE_TOO_SMALL');
      const overCap = await brand.owner.post(`${API}/finance/brand/advances`).send({ type: 'COD_ADVANCE', amountCents: 60_001 });
      expect(overCap.body.code).toBe('ADVANCE_NOT_ELIGIBLE');
    });

    it('early payout: request → approve → pay posts Dr wallet (amount + fee) / Cr bank / Cr finance fees', async () => {
      const req = await brand.owner.post(`${API}/finance/brand/advances`).send({ type: 'EARLY_PAYOUT', amountCents: 50_000, notes: 'Stock purchase' });
      expect(req.status).toBe(201);
      expect(req.body).toMatchObject({ status: 'REQUESTED', amountCents: 50_000, feeCents: 500, totalCents: 50_500 });
      expect(req.body.code).toMatch(/^ADV-\d{6}$/);
      earlyId = req.body.id;
      const elig = await brand.owner.get(`${API}/finance/brand/advances/eligibility`);
      expect(elig.body.earlyPayout.pendingRequestsCents).toBe(50_500);
      expect(elig.body.earlyPayout.availableCents).toBe(walletStart - 50_500);

      const fin = await t.as('finance');
      expect((await fin.post(`${API}/finance/advances/${earlyId}/pay`).send({ reference: 'X1' })).body.code).toBe('INVALID_STATE');
      expect((await fin.post(`${API}/finance/advances/${earlyId}/approve`).send({})).body.status).toBe('APPROVED');
      const [w0, b0, r0] = [await wallet(t, brand.id), await balance(t, BANK), await balance(t, FIN_REV)];
      const paid = await fin.post(`${API}/finance/advances/${earlyId}/pay`).send({ method: 'INSTAPAY', reference: 'IP-EARLY-1' });
      expect(paid.status).toBe(200);
      expect(paid.body).toMatchObject({ status: 'PAID', method: 'INSTAPAY', paymentReference: 'IP-EARLY-1' });
      expect(await wallet(t, brand.id)).toBe(w0 - 50_500);
      expect(await balance(t, BANK)).toBe(b0 - 50_000);
      expect(await balance(t, FIN_REV)).toBe(r0 + 500);
      expect(await postingOf(t, `advance:${earlyId}:paid`)).toEqual({ kind: 'BRAND_ADVANCE', lines: { [`2100:BRAND:${brand.id}`]: 50_500, '1010': -50_000, '4030': -500 } });
      expect((await fin.post(`${API}/finance/advances/${earlyId}/pay`).send({ reference: 'IP-EARLY-1' })).body.code).toBe('INVALID_STATE');
      expect(await notificationsFor(t, brand.ownerUserId, 'advance_update')).toHaveLength(2); // approved + paid
      await assertBalanced(t);
    });

    it('COD advance: Dr 1300 brand advance / Cr bank, fee Dr wallet / Cr finance fees', async () => {
      const req = await brand.owner.post(`${API}/finance/brand/advances`).send({ type: 'COD_ADVANCE', amountCents: 60_000 });
      expect(req.status).toBe(201);
      expect(req.body.feeCents).toBe(1_500);
      codId = req.body.id;
      const again = await brand.owner.post(`${API}/finance/brand/advances`).send({ type: 'COD_ADVANCE', amountCents: 10_000 });
      expect(again.body.code).toBe('ADVANCE_NOT_ELIGIBLE'); // the request already reserves the whole cap
      const fin = await t.as('finance');
      await fin.post(`${API}/finance/advances/${codId}/approve`).send({});
      const [w0, b0] = [await wallet(t, brand.id), await balance(t, BANK)];
      const paid = await fin.post(`${API}/finance/advances/${codId}/pay`).send({ reference: 'IP-COD-1' });
      expect(paid.body).toMatchObject({ status: 'PAID', method: 'INSTAPAY', outstandingCents: 60_000 });
      expect(await balance(t, { brandAdvance: brand.id })).toBe(60_000);
      expect(await balance(t, BANK)).toBe(b0 - 60_000);
      expect(await wallet(t, brand.id)).toBe(w0 - 1_500);
      expect(await postingOf(t, `advance:${codId}:paid`)).toEqual({
        kind: 'BRAND_ADVANCE',
        lines: { [`1300:BRAND:${brand.id}`]: 60_000, '1010': -60_000, [`2100:BRAND:${brand.id}`]: 1_500, '4030': -1_500 },
      });
      const ov = await fin.get(`${API}/finance/advances/overview`);
      expect(ov.body.outstandingByBrand).toEqual(expect.arrayContaining([expect.objectContaining({ brand: expect.objectContaining({ id: brand.id }), outstandingCents: 60_000 })]));
      await assertBalanced(t);
    });

    it('settlement recovers the advance and nets the early payout — the brand is paid exactly once, minus the fees', async () => {
      // The in-transit parcels get delivered (cash) before the settlement runs.
      const postings = t.app.get(PostingsService);
      for (const id of inTransitIds) {
        await t.db.update(orders).set({ status: 'DELIVERED', courierId: hero.id, collectedCents: id === inTransitIds[0] ? 80_000 : 40_000, deliveredAt: new Date() }).where(eq(orders.id, id));
        const [o] = await t.db.select().from(orders).where(eq(orders.id, id));
        await t.db.transaction(async (tx) => {
          const [c] = await ledger(t).lockCouriers(tx, [hero.id]);
          await postings.orderDelivered(tx, o, c);
        });
      }
      const walletBefore = await wallet(t, brand.id);
      const fin = await t.as('finance');
      const gen = await fin.post(`${API}/finance/settlements/generate`).send({ brandId: brand.id });
      expect(gen.status).toBe(201);
      const s = gen.body.created[0];
      // Order part: what the brand would have been paid without any advance.
      const orderNet = s.codCollectedCents - s.feesCents;
      expect(s.codCollectedCents).toBe(270_000);
      expect(s.adjustmentsCents).toBe(-(50_500 + 1_500 + 60_000));
      expect(s.netPayableCents).toBe(orderNet - 112_000);
      expect(s.netPayableCents).toBe(walletBefore - 60_000); // recovery came out of the wallet
      expect(await balance(t, { brandAdvance: brand.id })).toBe(0);
      const [adv] = await t.db.select().from(brandAdvances).where(eq(brandAdvances.id, codId));
      expect(adv).toMatchObject({ status: 'RECOVERED', recoveredCents: 60_000 });
      expect(await postingOf(t, `settlement:${s.id}:recovery:${codId}`)).toEqual({ kind: 'ADVANCE_RECOVERY', lines: { [`2100:BRAND:${brand.id}`]: 60_000, [`1300:BRAND:${brand.id}`]: -60_000 } });

      const detail = await fin.get(`${API}/finance/settlements/${s.id}`);
      const adj = detail.body.adjustmentLines as Array<{ kind: string; amountCents: number }>;
      expect(adj.reduce((sum, l) => sum + l.amountCents, 0)).toBe(s.adjustmentsCents);
      expect(adj.map((l) => l.kind).sort()).toEqual(['ADVANCE_RECOVERY', 'BRAND_ADVANCE', 'BRAND_ADVANCE']);
      expect(detail.body.lines.reduce((sum: number, l: { netCents: number }) => sum + l.netCents, 0)).toBe(orderNet);
      const csv = await fin.get(`${API}/finance/settlements/${s.id}/export.csv`);
      expect(csv.text).toContain('COD advance');

      await fin.post(`${API}/finance/settlements/${s.id}/approve`).send({});
      const paid = await fin.post(`${API}/finance/settlements/${s.id}/pay`).send({ paymentReference: 'SET-PAY-1' });
      expect(paid.body.netPayableCents).toBe(orderNet - 112_000);
      expect(await wallet(t, brand.id)).toBe(0);
      // Total received = early payout + COD advance + settlement = order net − fees (500 + 1 500).
      expect((await advancedToBrand(brand.id)) + paid.body.netPayableCents).toBe(orderNet - 2_000);
      await assertBalanced(t);
    });

    it('a second settlement does not net anything again', async () => {
      const fin = await t.as('finance');
      const gen = await fin.post(`${API}/finance/settlements/generate`).send({ brandId: brand.id });
      expect(gen.body.created).toHaveLength(0);
    });
  });

  it('recovers a COD advance partially when the settlement is small, the rest next time', async () => {
    const brand = await moneyBrand(t);
    await insertOrder(t, { brandId: brand.id, status: 'ASSIGNED', codCents: 200_000, courierId: hero.id });
    await deliveredOrder(t, { brandId: brand.id, codCents: 30_000, courierId: hero.id });
    const req = await brand.owner.post(`${API}/finance/brand/advances`).send({ type: 'COD_ADVANCE', amountCents: 90_000 });
    expect(req.status).toBe(201);
    const fin = await t.as('finance');
    await fin.post(`${API}/finance/advances/${req.body.id}/approve`).send({});
    await fin.post(`${API}/finance/advances/${req.body.id}/pay`).send({ reference: 'P-1' });
    const fee = applyBp(90_000, 250);

    const s1 = (await fin.post(`${API}/finance/settlements/generate`).send({ brandId: brand.id })).body.created[0];
    const orderNet1 = s1.codCollectedCents - s1.feesCents;
    expect(s1.netPayableCents).toBe(0); // everything went to the advance
    expect(s1.adjustmentsCents).toBe(-orderNet1);
    const [a1] = await t.db.select().from(brandAdvances).where(eq(brandAdvances.id, req.body.id));
    expect(a1).toMatchObject({ status: 'PAID', recoveredCents: orderNet1 - fee });
    expect(await balance(t, { brandAdvance: brand.id })).toBe(90_000 - (orderNet1 - fee));

    await deliveredOrder(t, { brandId: brand.id, codCents: 150_000, courierId: hero.id });
    const s2 = (await fin.post(`${API}/finance/settlements/generate`).send({ brandId: brand.id })).body.created[0];
    const orderNet2 = s2.codCollectedCents - s2.feesCents;
    const rest = 90_000 - (orderNet1 - fee);
    expect(s2.adjustmentsCents).toBe(-rest);
    expect(s2.netPayableCents).toBe(orderNet2 - rest);
    const [a2] = await t.db.select().from(brandAdvances).where(eq(brandAdvances.id, req.body.id));
    expect(a2).toMatchObject({ status: 'RECOVERED', recoveredCents: 90_000 });
    expect(await balance(t, { brandAdvance: brand.id })).toBe(0);
    // Advance + both settlements = both orders' net − the fee.
    expect(90_000 + s1.netPayableCents + s2.netPayableCents).toBe(orderNet1 + orderNet2 - fee);
    for (const s of [s1, s2]) {
      await fin.post(`${API}/finance/settlements/${s.id}/approve`).send({});
      if (s.netPayableCents !== 0) await fin.post(`${API}/finance/settlements/${s.id}/pay`).send({ paymentReference: `P-${s.code}` });
    }
    expect(await wallet(t, brand.id)).toBe(0);
    await assertBalanced(t);
  });

  it('cancelled settlements keep the netting exact', async () => {
    const brand = await moneyBrand(t);
    await deliveredOrder(t, { brandId: brand.id, codCents: 120_000, courierId: hero.id });
    const req = await brand.owner.post(`${API}/finance/brand/advances`).send({ type: 'EARLY_PAYOUT', amountCents: 40_000 });
    const fin = await t.as('finance');
    await fin.post(`${API}/finance/advances/${req.body.id}/approve`).send({});
    await fin.post(`${API}/finance/advances/${req.body.id}/pay`).send({ reference: 'E-1' });
    const s1 = (await fin.post(`${API}/finance/settlements/generate`).send({ brandId: brand.id })).body.created[0];
    expect(s1.adjustmentsCents).toBe(-40_400);
    await fin.post(`${API}/finance/settlements/${s1.id}/cancel`).send({ reason: 'Wrong period' });
    const s2 = (await fin.post(`${API}/finance/settlements/generate`).send({ brandId: brand.id })).body.created[0];
    expect(s2.netPayableCents).toBe(s1.netPayableCents);
    expect(s2.netPayableCents).toBe(await wallet(t, brand.id));
    await assertBalanced(t);
  });

  it('cancel / reject flows and brand scoping', async () => {
    const a = await moneyBrand(t);
    const b = await moneyBrand(t);
    await deliveredOrder(t, { brandId: a.id, codCents: 90_000, courierId: hero.id });
    const req = await a.owner.post(`${API}/finance/brand/advances`).send({ type: 'EARLY_PAYOUT', amountCents: 20_000 });
    expect((await b.owner.post(`${API}/finance/brand/advances/${req.body.id}/cancel`).send({})).status).toBe(404);
    expect((await b.owner.get(`${API}/finance/brand/advances`)).body.data).toHaveLength(0);
    expect((await a.owner.get(`${API}/finance/brand/advances`)).body.data).toHaveLength(1);
    const cancelled = await a.owner.post(`${API}/finance/brand/advances/${req.body.id}/cancel`).send({});
    expect(cancelled.body.status).toBe('CANCELLED');
    const second = await a.owner.post(`${API}/finance/brand/advances`).send({ type: 'EARLY_PAYOUT', amountCents: 20_000 });
    const fin = await t.as('finance');
    expect((await fin.post(`${API}/finance/advances/${second.body.id}/reject`).send({ note: 'x' })).status).toBe(400);
    const rejected = await fin.post(`${API}/finance/advances/${second.body.id}/reject`).send({ note: 'Account under review' });
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.notes).toContain('Account under review');
    expect((await fin.post(`${API}/finance/advances/${second.body.id}/approve`).send({})).body.code).toBe('INVALID_STATE');
    expect((await a.owner.get(`${API}/finance/advances`)).status).toBe(403);
    expect((await (await t.as('hub')).post(`${API}/finance/advances/${second.body.id}/approve`).send({})).status).toBe(403);
    // Nothing was paid: no ledger movement.
    expect((await postingOf(t, `advance:${second.body.id}:paid`)).kind).toBeNull();
  });
});
