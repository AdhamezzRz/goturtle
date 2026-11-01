import { config } from '../src/config';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { orders } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import type { TestContext } from './helpers';
import { bootTestApp } from './ops-factories';
import {
  API, assertBalanced, balance, feesOf, moneyBrand, moneyHero, notificationsFor, outForDelivery, postingOf, reloadOrder, wallet,
} from './money-factories';

const CLEARING = { company: 'DIGITAL_CLEARING' } as const;
const BANK = { company: 'BANK' } as const;
const GATEWAY = { company: 'PAYMENT_GATEWAY' } as const;

describe('Money programs — digital payment at the door (e2e)', () => {
  let t: TestContext;
  let brand: Awaited<ReturnType<typeof moneyBrand>>;
  let hero: Awaited<ReturnType<typeof moneyHero>>;

  beforeAll(async () => {
    t = await bootTestApp();
    brand = await moneyBrand(t);
    hero = await moneyHero(t);
  });
  afterAll(() => t.close());

  const custody = async () => (await hero.reload()).cashOnHandCents;
  const deliver = (orderId: string, body: Record<string, unknown>) => hero.agent.post(`${API}/hero/tasks/orders/${orderId}/deliver`).send(body);

  it('keeps the cash path exactly as before (custody up, COD_COLLECTED, no collection status)', async () => {
    const o = await outForDelivery(t, { brandId: brand.id, codCents: 40_000, hero });
    const [c0, w0] = [await custody(), await wallet(t, brand.id)];
    const res = await deliver(o.id, { collectedCents: 40_000 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DELIVERED');
    const fees = await feesOf(t, brand.id, { codCents: 40_000 });
    expect(await custody()).toBe(c0 + 40_000);
    expect(await wallet(t, brand.id)).toBe(w0 + 40_000 - fees.totalFeesCents);
    const cod = await postingOf(t, `order:${o.id}:cod`);
    expect(cod.kind).toBe('COD_COLLECTED');
    expect(cod.lines[`1100:HERO:${hero.id}`]).toBe(40_000);
    const row = await reloadOrder(t, o.id);
    expect(row).toMatchObject({ collectionMethod: 'CASH', collectionStatus: 'NOT_APPLICABLE', collectionReference: null });
    await assertBalanced(t);
  });

  it('offers the configured methods and the company InstaPay / wallet to the hero', async () => {
    await t.app.get(SettingsService).set('finance', { instapayAddress: 'goturtle@instapay', walletNumber: '01012345678' }, null);
    const res = await hero.agent.get(`${API}/hero/collections/options`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ instapayAddress: 'goturtle@instapay', walletNumber: '+201012345678', paymentLinkEnabled: false });
    expect(res.body.methods).toEqual(['CASH', 'INSTAPAY', 'WALLET', 'CARD']);
  });

  let instapayOrder: string;
  it('InstaPay: reference required, custody unchanged, money waits in digital clearing', async () => {
    const o = await outForDelivery(t, { brandId: brand.id, codCents: 55_000, hero });
    instapayOrder = o.id;
    const missing = await deliver(o.id, { collectedCents: 55_000, collectionMethod: 'INSTAPAY' });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('COLLECTION_REFERENCE_REQUIRED');
    expect((await reloadOrder(t, o.id)).status).toBe('OUT_FOR_DELIVERY');

    const [c0, w0, cl0] = [await custody(), await wallet(t, brand.id), await balance(t, CLEARING)];
    const res = await deliver(o.id, { collectedCents: 55_000, collectionMethod: 'INSTAPAY', collectionReference: 'IPN-778812' });
    expect(res.status).toBe(200);
    const fees = await feesOf(t, brand.id, { codCents: 55_000 });
    expect(await custody()).toBe(c0); // the hero holds nothing
    expect(await balance(t, CLEARING)).toBe(cl0 + 55_000);
    expect(await wallet(t, brand.id)).toBe(w0 + 55_000 - fees.totalFeesCents); // brand owed exactly as for cash
    const cod = await postingOf(t, `order:${o.id}:cod`);
    expect(cod).toEqual({ kind: 'DIGITAL_COLLECTION', lines: { '1030': 55_000, [`2100:BRAND:${brand.id}`]: -55_000 } });
    expect(await reloadOrder(t, o.id)).toMatchObject({ collectionMethod: 'INSTAPAY', collectionStatus: 'PENDING_CONFIRMATION', collectionReference: 'IPN-778812', collectedCents: 55_000 });

    // Not cash on hand: the hero wallet does not list it, the collections tab does.
    const w = await hero.agent.get(`${API}/hero/me/wallet`);
    expect(w.body.orders.map((x: { id: string }) => x.id)).not.toContain(o.id);
    const mine = await hero.agent.get(`${API}/hero/collections`);
    expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(o.id);
    expect(mine.body.summary.pending).toEqual({ n: 1, cents: 55_000 });
    await assertBalanced(t);
  });

  it('refuses a transfer reference that already paid another parcel', async () => {
    const o = await outForDelivery(t, { brandId: brand.id, codCents: 12_000, hero });
    const res = await deliver(o.id, { collectedCents: 12_000, collectionMethod: 'INSTAPAY', collectionReference: 'IPN-778812' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('COLLECTION_REFERENCE_USED');
  });

  it('finance confirms: Dr bank / Cr clearing, once', async () => {
    const fin = await t.as('finance');
    const list = await fin.get(`${API}/finance/collections`).query({ status: 'PENDING_CONFIRMATION', courierId: hero.id });
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(instapayOrder);
    expect(list.body.summary.pending.n).toBeGreaterThanOrEqual(1);
    const [b0, cl0] = [await balance(t, BANK), await balance(t, CLEARING)];
    const ok = await fin.post(`${API}/finance/collections/${instapayOrder}/confirm`).send({ bankReference: 'CIB-STMT-3010' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ collectionStatus: 'CONFIRMED', decision: { status: 'CONFIRMED', bankReference: 'CIB-STMT-3010' } });
    expect(await balance(t, BANK)).toBe(b0 + 55_000);
    expect(await balance(t, CLEARING)).toBe(cl0 - 55_000);
    const again = await fin.post(`${API}/finance/collections/${instapayOrder}/confirm`).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('COLLECTION_NOT_PENDING');
    await assertBalanced(t);
  });

  it('finance rejects: the amount moves to the hero custody and the hero is told', async () => {
    const o = await outForDelivery(t, { brandId: brand.id, codCents: 30_000, hero });
    await deliver(o.id, { collectedCents: 30_000, collectionMethod: 'WALLET', collectionReference: 'VF-55120' });
    const [c0, cl0, w0] = [await custody(), await balance(t, CLEARING), await wallet(t, brand.id)];
    const fin = await t.as('finance');
    expect((await fin.post(`${API}/finance/collections/${o.id}/reject`).send({ note: '' })).status).toBe(400);
    const res = await fin.post(`${API}/finance/collections/${o.id}/reject`).send({ note: 'No transfer on the Vodafone Cash statement' });
    expect(res.status).toBe(200);
    expect(res.body.collectionStatus).toBe('REJECTED');
    expect(await custody()).toBe(c0 + 30_000);
    expect(await balance(t, CLEARING)).toBe(cl0 - 30_000);
    expect(await wallet(t, brand.id)).toBe(w0); // the brand is still owed its money
    expect((await postingOf(t, `order:${o.id}:collection:rejected`)).lines).toEqual({ [`1100:HERO:${hero.id}`]: 30_000, '1030': -30_000 });
    // Now it is cash the hero must hand over.
    const w = await hero.agent.get(`${API}/hero/me/wallet`);
    expect(w.body.orders.map((x: { id: string }) => x.id)).toContain(o.id);
    expect(await notificationsFor(t, hero.userId, 'collection_rejected')).toHaveLength(1);
    expect((await fin.post(`${API}/finance/collections/${o.id}/confirm`).send({})).body.code).toBe('COLLECTION_NOT_PENDING');
    await assertBalanced(t);
  });

  it('bulk-confirms from pasted bank statement references', async () => {
    const a = await outForDelivery(t, { brandId: brand.id, codCents: 21_000, hero });
    const b = await outForDelivery(t, { brandId: brand.id, codCents: 22_000, hero });
    await deliver(a.id, { collectedCents: 21_000, collectionMethod: 'INSTAPAY', collectionReference: 'BULK-REF-1' });
    await deliver(b.id, { collectedCents: 22_000, collectionMethod: 'CARD', collectionReference: 'POS-REF-2' });
    const b0 = await balance(t, BANK);
    const fin = await t.as('finance');
    const res = await fin.post(`${API}/finance/collections/bulk-confirm`).send({ references: [' BULK-REF-1 ', 'POS-REF-2', 'UNKNOWN-9', 'IPN-778812'], bankReference: 'STMT-31-10' });
    expect(res.status).toBe(200);
    expect(res.body.confirmed.map((c: { orderId: string }) => c.orderId).sort()).toEqual([a.id, b.id].sort());
    expect(res.body.notFound).toEqual(['UNKNOWN-9']);
    expect(res.body.alreadyProcessed).toEqual([expect.objectContaining({ reference: 'IPN-778812', status: 'CONFIRMED' })]);
    expect(await balance(t, BANK)).toBe(b0 + 43_000);
    await assertBalanced(t);
  });

  it('respects the accepted methods setting and keeps payment links hidden while payments are off', async () => {
    const settings = t.app.get(SettingsService);
    await settings.set('finance', { acceptedCollectionMethods: ['CASH', 'INSTAPAY'] }, null);
    const o = await outForDelivery(t, { brandId: brand.id, codCents: 15_000, hero });
    const res = await deliver(o.id, { collectedCents: 15_000, collectionMethod: 'WALLET', collectionReference: 'VF-1' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('COLLECTION_METHOD_NOT_ACCEPTED');
    await settings.set('finance', { acceptedCollectionMethods: ['CASH', 'INSTAPAY', 'WALLET', 'CARD', 'PAYMENT_LINK'] }, null);
    const link = await deliver(o.id, { collectedCents: 15_000, collectionMethod: 'PAYMENT_LINK' });
    expect(link.status).toBe(409);
    expect(link.body.code).toBe('PAYMENTS_DISABLED');
    expect((await hero.agent.post(`${API}/hero/collections/orders/${o.id}/payment-link`).send({})).body.code).toBe('PAYMENTS_DISABLED');
    const bad = await (await t.as('admin')).put(`${API}/settings/finance`).send({ value: { acceptedCollectionMethods: ['BITCOIN'] } });
    expect(bad.status).toBe(400);
  });

  describe('payment link at the door (gateway enabled)', () => {
    const original = config.payments.provider;
    beforeAll(() => {
      config.payments.provider = 'paymob';
    });
    afterAll(() => {
      config.payments.provider = original;
    });

    /** Stores a door payment link on the order (what createDoorLink saves after Paymob answers). */
    async function withDoorLink(orderId: string, amountCents: number) {
      const ref = `gt_${orderId}_${Date.now().toString(36)}`;
      const o = await reloadOrder(t, orderId);
      const payment = { provider: 'paymob', status: 'PENDING', amountCents, specialReference: ref, intentionId: 'int_1', checkoutUrl: 'https://accept.paymob.com/unifiedcheckout/?x', createdAt: new Date().toISOString(), atDoor: true };
      await t.db.update(orders).set({ metadata: { ...(o.metadata ?? {}), payment } }).where(eq(orders.id, orderId));
      return ref;
    }
    const webhook = (ref: string, amountCents: number, id: string) =>
      t.app.get(PaymentsService).applyTransaction({ transactionId: id, success: true, pending: false, amountCents, currency: 'EGP', merchantRef: ref, extraOrderId: null });

    it('requires the link first; paid before the hand-over → confirmed at once via the gateway', async () => {
      const o = await outForDelivery(t, { brandId: brand.id, codCents: 33_000, hero });
      expect((await deliver(o.id, { collectedCents: 33_000, collectionMethod: 'PAYMENT_LINK' })).body.code).toBe('PAYMENT_LINK_REQUIRED');
      const ref = await withDoorLink(o.id, 33_000);
      const paid = await webhook(ref, 33_000, 'txn-door-1');
      expect(paid.action).toBe('paid');
      const after = await reloadOrder(t, o.id);
      expect(after).toMatchObject({ status: 'OUT_FOR_DELIVERY', paymentMethod: 'COD', collectCents: 33_000 }); // still COD until the hero hands it over
      const status = await hero.agent.get(`${API}/hero/collections/orders/${o.id}/payment-link`);
      expect(status.body.payment).toMatchObject({ status: 'PAID', amountCents: 33_000 });

      const [c0, g0, cl0] = [await custody(), await balance(t, GATEWAY), await balance(t, CLEARING)];
      const res = await deliver(o.id, { collectedCents: 33_000, collectionMethod: 'PAYMENT_LINK' });
      expect(res.status).toBe(200);
      expect(await custody()).toBe(c0);
      expect(await balance(t, GATEWAY)).toBe(g0 + 33_000);
      expect(await balance(t, CLEARING)).toBe(cl0);
      expect(await reloadOrder(t, o.id)).toMatchObject({ collectionMethod: 'PAYMENT_LINK', collectionStatus: 'CONFIRMED', collectionReference: 'paymob:txn-door-1' });
      expect((await webhook(ref, 33_000, 'txn-door-1')).action).toBe('already_paid');
      await assertBalanced(t);
    });

    it('delivered first → pending in clearing, the webhook confirms it into the gateway', async () => {
      const o = await outForDelivery(t, { brandId: brand.id, codCents: 27_500, hero });
      const ref = await withDoorLink(o.id, 27_500);
      const cl0 = await balance(t, CLEARING);
      expect((await deliver(o.id, { collectedCents: 27_500, collectionMethod: 'PAYMENT_LINK' })).status).toBe(200);
      expect(await reloadOrder(t, o.id)).toMatchObject({ collectionStatus: 'PENDING_CONFIRMATION' });
      expect(await balance(t, CLEARING)).toBe(cl0 + 27_500);
      const g0 = await balance(t, GATEWAY);
      expect((await webhook(ref, 27_500, 'txn-door-2')).action).toBe('paid');
      expect(await reloadOrder(t, o.id)).toMatchObject({ collectionStatus: 'CONFIRMED', paymentMethod: 'COD' });
      expect(await balance(t, CLEARING)).toBe(cl0);
      expect(await balance(t, GATEWAY)).toBe(g0 + 27_500);
      expect((await postingOf(t, `order:${o.id}:collection:confirmed`)).lines).toEqual({ '1020': 27_500, '1030': -27_500 });
      await assertBalanced(t);
    });
  });

  it('keeps finance endpoints away from brands and heroes', async () => {
    expect((await brand.owner.get(`${API}/finance/collections`)).status).toBe(403);
    expect((await hero.agent.post(`${API}/finance/collections/${instapayOrder}/confirm`).send({})).status).toBe(403);
    expect((await brand.owner.get(`${API}/hero/collections`)).status).toBe(403);
  });
});
