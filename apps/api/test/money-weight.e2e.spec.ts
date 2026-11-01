import { and, eq } from 'drizzle-orm';
import { ledgerTransactions, orders, tickets } from '../src/db/schema';
import { PostingsService } from '../src/core/ledger/postings.service';
import { toleranceGrams, volumetricGrams } from '../src/modules/money-programs/weight.service';
import type { TestContext } from './helpers';
import { bootTestApp } from './ops-factories';
import { API, assertBalanced, balance, feesOf, insertOrder, ledger, moneyBrand, moneyHero, notificationsFor, postingOf, reloadOrder, wallet } from './money-factories';

const SHIPPING = { company: 'REVENUE_SHIPPING' } as const;
const VAT = { company: 'VAT_PAYABLE' } as const;

describe('Quality — hub weighing, re-pricing & weight disputes (e2e)', () => {
  let t: TestContext;
  let brand: Awaited<ReturnType<typeof moneyBrand>>;
  let other: Awaited<ReturnType<typeof moneyBrand>>;

  beforeAll(async () => {
    t = await bootTestApp();
    brand = await moneyBrand(t);
    other = await moneyBrand(t);
  });
  afterAll(() => t.close());

  const weigh = async (body: Record<string, unknown>) => (await t.as('hub')).post(`${API}/quality/weigh`).send(body);
  const atHub = (weightGrams = 1000, codCents = 40_000) => insertOrder(t, { brandId: brand.id, status: 'RECEIVED_AT_HUB', codCents, weightGrams });
  /** Expected re-pricing: the brand's quote at the billable weight minus the quote at the declared weight. */
  async function expectedDelta(declared: number, billable: number, codCents = 40_000) {
    const [a, b] = [await feesOf(t, brand.id, { codCents, weightGrams: declared }), await feesOf(t, brand.id, { codCents, weightGrams: billable })];
    return { feeCents: b.subtotalCents - a.subtotalCents, vatCents: b.vatCents - a.vatCents, totalCents: b.totalFeesCents - a.totalFeesCents };
  }

  it('knows tolerance and volumetric weight', () => {
    expect(toleranceGrams(1000, { weightToleranceGrams: 200, weightTolerancePct: 10 })).toBe(200);
    expect(toleranceGrams(5000, { weightToleranceGrams: 200, weightTolerancePct: 10 })).toBe(500);
    expect(volumetricGrams({ l: 40, w: 30, h: 20 }, 5000)).toBe(4800);
    expect(volumetricGrams(null, 5000)).toBe(0);
  });

  it('within tolerance: records the weight, no money moves', async () => {
    const o = await atHub(1000);
    const w0 = await wallet(t, brand.id);
    const res = await weigh({ trackingNumber: o.trackingNumber, weightGrams: 1190 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'NONE', declaredGrams: 1000, actualGrams: 1190, billableGrams: 1190, adjustmentCents: 0, alreadyWeighed: false });
    expect(await wallet(t, brand.id)).toBe(w0);
    expect((await postingOf(t, `order:${o.id}:weight_adjustment`)).kind).toBeNull();
  });

  let adjusted: Awaited<ReturnType<typeof atHub>>;
  let delta: Awaited<ReturnType<typeof expectedDelta>>;
  it('beyond tolerance: re-prices with the rate card and posts FEE_ADJUSTMENT incl. VAT — once', async () => {
    adjusted = await atHub(1000);
    delta = await expectedDelta(1000, 5200);
    expect(delta.totalCents).toBeGreaterThan(0);
    const [w0, r0, v0] = [await wallet(t, brand.id), await balance(t, SHIPPING), await balance(t, VAT)];
    const res = await weigh({ trackingNumber: adjusted.trackingNumber.toLowerCase(), weightGrams: 5200 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ADJUSTED', billableGrams: 5200, adjustmentCents: delta.totalCents, feeCents: delta.feeCents, vatCents: delta.vatCents, canDispute: true });
    expect(await wallet(t, brand.id)).toBe(w0 - delta.totalCents);
    expect(await balance(t, SHIPPING)).toBe(r0 + delta.feeCents);
    expect(await balance(t, VAT)).toBe(v0 + delta.vatCents);
    expect(await postingOf(t, `order:${adjusted.id}:weight_adjustment`)).toEqual({
      kind: 'FEE_ADJUSTMENT',
      lines: { [`2100:BRAND:${brand.id}`]: delta.totalCents, '4000': -delta.feeCents, '2300': -delta.vatCents },
    });
    expect(await reloadOrder(t, adjusted.id)).toMatchObject({ actualWeightGrams: 5200, weightStatus: 'ADJUSTED', weightAdjustmentCents: delta.totalCents, weightGrams: 1000 });
    const again = await weigh({ trackingNumber: adjusted.trackingNumber, weightGrams: 9000 });
    expect(again.body).toMatchObject({ alreadyWeighed: true, actualGrams: 5200, adjustmentCents: delta.totalCents });
    expect(await wallet(t, brand.id)).toBe(w0 - delta.totalCents);
    expect(await notificationsFor(t, brand.ownerUserId, 'weight_adjusted')).toHaveLength(1);
    await assertBalanced(t);
  });

  it('uses the volumetric weight when the parcel is big but light', async () => {
    const o = await atHub(1000);
    const exp = await expectedDelta(1000, 12_000);
    const res = await weigh({ trackingNumber: o.trackingNumber, weightGrams: 900, dimensionsCm: { l: 50, w: 40, h: 30 } });
    expect(res.body).toMatchObject({ status: 'ADJUSTED', actualGrams: 900, volumetricGrams: 12_000, billableGrams: 12_000, adjustmentCents: exp.totalCents, dimensionsCm: { l: 50, w: 40, h: 30 } });
    await assertBalanced(t);
  });

  it('refuses final parcels, bad input and non-hub users', async () => {
    const done = await insertOrder(t, { brandId: brand.id, status: 'DELIVERED', codCents: 0 });
    expect((await weigh({ trackingNumber: done.trackingNumber, weightGrams: 9000 })).body.code).toBe('NOT_WEIGHABLE');
    expect((await weigh({ trackingNumber: 'GT0000000000', weightGrams: 0 })).status).toBe(400);
    expect((await weigh({ trackingNumber: 'NOT-A-TN', weightGrams: 900 })).body.code).toBe('INVALID_TRACKING_NUMBER');
    expect((await brand.owner.post(`${API}/quality/weigh`).send({ trackingNumber: done.trackingNumber, weightGrams: 900 })).status).toBe(403);
    expect((await (await t.as('finance')).post(`${API}/quality/weigh`).send({ trackingNumber: done.trackingNumber, weightGrams: 900 })).status).toBe(403);
  });

  it('brand disputes within the window → DISPUTED + WEIGHT_DISPUTE ticket; ops reverses it exactly', async () => {
    const before = await wallet(t, brand.id) + delta.totalCents; // balance before the adjustment
    expect((await other.owner.post(`${API}/quality/weight-disputes`).send({ orderId: adjusted.id, note: 'Not our parcel at all' })).status).toBe(404);
    const res = await brand.owner.post(`${API}/quality/weight-disputes`).send({ orderId: adjusted.id, note: 'Our scale shows 1.1 kg, photo attached', evidence: ['/api/v1/files/ticket_attachment/2026-10/x.jpg'] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DISPUTED');
    expect(res.body.dispute.ticket).toMatchObject({ status: 'OPEN' });
    const [ticket] = await t.db.select().from(tickets).where(and(eq(tickets.orderId, adjusted.id), eq(tickets.category, 'WEIGHT_DISPUTE')));
    expect(ticket).toBeTruthy();
    expect((await brand.owner.post(`${API}/quality/weight-disputes`).send({ orderId: adjusted.id, note: 'Second time please' })).body.code).toBe('NOT_DISPUTABLE');
    expect((await brand.owner.post(`${API}/quality/weight-disputes/${adjusted.id}/resolve`).send({ decision: 'REVERSED', note: 'ok' })).status).toBe(403);

    const ops = await t.as('ops');
    const queue = await ops.get(`${API}/quality/weights`).query({ status: 'DISPUTED' });
    expect(queue.body.data.map((r: { id: string }) => r.id)).toContain(adjusted.id);
    const [r0, v0] = [await balance(t, SHIPPING), await balance(t, VAT)];
    const done = await ops.post(`${API}/quality/weight-disputes/${adjusted.id}/resolve`).send({ decision: 'REVERSED', note: 'Re-weighed: 1.1 kg, scale was miscalibrated' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('REVERSED');
    expect(await wallet(t, brand.id)).toBe(before);
    expect(await balance(t, SHIPPING)).toBe(r0 - delta.feeCents);
    expect(await balance(t, VAT)).toBe(v0 - delta.vatCents);
    expect(await postingOf(t, `order:${adjusted.id}:weight_adjustment:reversal`)).toEqual({
      kind: 'FEE_REVERSAL',
      lines: { [`2100:BRAND:${brand.id}`]: -delta.totalCents, '4000': delta.feeCents, '2300': delta.vatCents },
    });
    const [tk] = await t.db.select().from(tickets).where(eq(tickets.id, ticket.id));
    expect(tk.status).toBe('RESOLVED');
    expect(await notificationsFor(t, brand.ownerUserId, 'weight_dispute_resolved')).toHaveLength(1);
    expect((await ops.post(`${API}/quality/weight-disputes/${adjusted.id}/resolve`).send({ decision: 'ACCEPTED', note: 'again' })).body.code).toBe('NOT_DISPUTED');
    await assertBalanced(t);
  });

  it('ACCEPTED keeps the adjustment; disputes close after the window', async () => {
    const a = await atHub(1000);
    await weigh({ trackingNumber: a.trackingNumber, weightGrams: 4500 });
    const w0 = await wallet(t, brand.id);
    await brand.owner.post(`${API}/quality/weight-disputes`).send({ orderId: a.id, note: 'Please check again' });
    const res = await (await t.as('ops')).post(`${API}/quality/weight-disputes/${a.id}/resolve`).send({ decision: 'ACCEPTED', note: 'Photo of the scale confirms 4.5 kg' });
    expect(res.body.status).toBe('ACCEPTED');
    expect(await wallet(t, brand.id)).toBe(w0);

    const late = await atHub(1000);
    await weigh({ trackingNumber: late.trackingNumber, weightGrams: 4500 });
    await t.db.update(ledgerTransactions).set({ createdAt: new Date(Date.now() - 49 * 3_600_000) }).where(eq(ledgerTransactions.reference, `order:${late.id}:weight_adjustment`));
    const panel = await brand.owner.get(`${API}/quality/orders/${late.id}/weight`);
    expect(panel.body.canDispute).toBe(false);
    const closed = await brand.owner.post(`${API}/quality/weight-disputes`).send({ orderId: late.id, note: 'Too late but trying' });
    expect(closed.status).toBe(422);
    expect(closed.body.code).toBe('DISPUTE_WINDOW_CLOSED');
    expect((await other.owner.get(`${API}/quality/orders/${late.id}/weight`)).status).toBe(404);
  });

  it('the weight fee is part of the order fees in the settlement', async () => {
    const own = await moneyBrand(t);
    const hero = await moneyHero(t);
    const o = await insertOrder(t, { brandId: own.id, status: 'RECEIVED_AT_HUB', codCents: 60_000, weightGrams: 1000 });
    const w = await weigh({ trackingNumber: o.trackingNumber, weightGrams: 6000 });
    const adj = w.body.adjustmentCents;
    expect(adj).toBeGreaterThan(0);
    await t.db.update(orders).set({ status: 'DELIVERED', courierId: hero.id, collectedCents: 60_000, deliveredAt: new Date() }).where(eq(orders.id, o.id));
    const row = await reloadOrder(t, o.id);
    await t.db.transaction(async (tx) => {
      const [c] = await ledger(t).lockCouriers(tx, [hero.id]);
      await t.app.get(PostingsService).orderDelivered(tx, row, c);
    });
    const s = (await (await t.as('finance')).post(`${API}/finance/settlements/generate`).send({ brandId: own.id })).body.created[0];
    expect(s.feesCents).toBe(row.totalFeesCents + adj);
    expect(s.adjustmentsCents).toBe(0);
    expect(s.netPayableCents).toBe(await wallet(t, own.id));
    await assertBalanced(t);
  });
});
