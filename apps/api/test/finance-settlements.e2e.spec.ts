import { eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { orders, settlements } from '../src/db/schema';
import { LedgerService } from '../src/core/ledger/ledger.service';
import { DomainEvents, type SettlementPaidEvent } from '../src/core/events';
import { cairoDateTime, cairoToday } from '../src/db/helpers';
import { isSettlementDay, nextSettlementDay, SettlementsService } from '../src/modules/finance/settlements.service';
import { addDays } from '../src/modules/couriers/workforce.util';
import { createTestApp, type TestContext } from './helpers';
import { assertBalanced, createBrand, createHero, deliverOrder, feesFor, loginWith, returnOrder } from './workforce-factories';

const API = '/api/v1';

describe('Finance — brand settlements, brand portal & reports (e2e)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const wallet = (brandId: string) => t.app.get(LedgerService).balance({ brandWallet: brandId });

  it('knows the settlement calendar (Cairo days)', () => {
    expect(isSettlementDay('DAILY', '2026-10-31')).toBe(true);
    expect(isSettlementDay('WEEKLY', '2026-11-01')).toBe(true); // Sunday
    expect(isSettlementDay('WEEKLY', '2026-10-31')).toBe(false);
    expect(isSettlementDay('BIWEEKLY', '2026-01-04')).toBe(true);
    expect(isSettlementDay('BIWEEKLY', '2026-01-11')).toBe(false);
    expect(isSettlementDay('BIWEEKLY', '2026-01-18')).toBe(true);
    expect(isSettlementDay('MONTHLY', '2026-11-01')).toBe(true);
    expect(nextSettlementDay('MONTHLY', '2026-10-31')).toBe('2026-11-01');
    expect(nextSettlementDay('WEEKLY', '2026-10-27')).toBe('2026-11-01');
  });

  describe('lifecycle', () => {
    let brand: Awaited<ReturnType<typeof createBrand>>;
    let settlementId: string;
    let expected: { cod: number; fees: number; vat: number };

    beforeAll(async () => {
      brand = await createBrand(t);
      const hero = await createHero(t);
      const a = await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 100000 });
      const b = await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 50000 });
      const prepaid = await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 0 });
      const ret = await returnOrder(t, { brandId: brand.id, codCents: 0, returnFeeCents: 2750 });
      void [a, b, prepaid, ret];
      const returnFees = feesFor(0).shippingFeeCents + Math.round((feesFor(0).vatCents * 5500) / 5500) + 2750 + Math.round(2750 * 0.14);
      expected = {
        cod: 150000,
        fees: feesFor(100000).totalFeesCents + feesFor(50000).totalFeesCents + feesFor(0).totalFeesCents + returnFees,
        vat: feesFor(100000).vatCents + feesFor(50000).vatCents + feesFor(0).vatCents * 2 + Math.round(2750 * 0.14),
      };
    });

    it('generates a DRAFT whose numbers match the ledger exactly (cod − fees = wallet balance)', async () => {
      const walletBefore = await wallet(brand.id);
      expect(walletBefore).toBe(expected.cod - expected.fees);
      const fin = await t.as('finance');
      const res = await fin.post(`${API}/finance/settlements/generate`).send({ brandId: brand.id });
      expect(res.status).toBe(201);
      expect(res.body.created).toHaveLength(1);
      const s = res.body.created[0];
      settlementId = s.id;
      expect(s).toMatchObject({ status: 'DRAFT', ordersCount: 4, codCollectedCents: expected.cod, feesCents: expected.fees, vatCents: expected.vat, adjustmentsCents: 0, netPayableCents: walletBefore });
      expect(s.code).toMatch(/^SET-\d{6}$/);
      expect(s.invoiceNumber).toMatch(new RegExp(`^INV-${cairoToday().slice(0, 4)}-\\d{6}$`));
      const linked = await t.db.select({ id: orders.id }).from(orders).where(eq(orders.settlementId, s.id));
      expect(linked).toHaveLength(4);

      const again = await fin.post(`${API}/finance/settlements/generate`).send({ brandId: brand.id });
      expect(again.body.created).toHaveLength(0);
      expect(again.body.skipped[0].reason).toBe('NO_UNSETTLED_ORDERS');

      const detail = await fin.get(`${API}/finance/settlements/${s.id}`);
      expect(detail.body.lines).toHaveLength(4);
      expect(detail.body.lines.reduce((sum: number, l: any) => sum + l.netCents, 0)).toBe(s.netPayableCents);
      expect(detail.body.lines.reduce((sum: number, l: any) => sum + l.feesCents, 0)).toBe(expected.fees);
    });

    it('enforces permissions and the state machine; paying posts the payout and clears the wallet', async () => {
      expect((await (await t.as('dispatcher')).post(`${API}/finance/settlements/generate`).send({})).status).toBe(403);
      expect((await (await t.as('ops')).post(`${API}/finance/settlements/${settlementId}/approve`)).status).toBe(403);
      const fin = await t.as('finance');
      const early = await fin.post(`${API}/finance/settlements/${settlementId}/pay`).send({ paymentReference: 'IP-1' });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('INVALID_STATE');
      expect((await fin.post(`${API}/finance/settlements/${settlementId}/approve`)).body.status).toBe('APPROVED');

      const events: SettlementPaidEvent[] = [];
      t.app.get(EventEmitter2).once(DomainEvents.SettlementPaid, (e: SettlementPaidEvent) => events.push(e));
      const paid = await fin.post(`${API}/finance/settlements/${settlementId}/pay`).send({ paymentReference: 'INSTAPAY-778' });
      expect(paid.status).toBe(200);
      expect(paid.body).toMatchObject({ status: 'PAID', method: 'INSTAPAY', paymentReference: 'INSTAPAY-778' });
      expect(await wallet(brand.id)).toBe(0);
      expect(events).toEqual([{ settlementId, brandId: brand.id, netPayableCents: paid.body.netPayableCents }]);
      expect((await fin.post(`${API}/finance/settlements/${settlementId}/cancel`).send({ reason: 'too late' })).body.code).toBe('INVALID_STATE');
      await assertBalanced(t);
    });

    it('exports the statement as CSV', async () => {
      const res = await (await t.as('finance')).get(`${API}/finance/settlements/${settlementId}/export.csv`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="SET-\d{6}_INV-/);
      expect(res.text).toContain('Net payable (EGP)');
      expect(res.text.trim().split('\r\n').length).toBe(15 + 4);
    });

    it('brand portal: scoped summary, settlements and statement; other brands get 404', async () => {
      const owner = await loginWith(t, brand.ownerPhone);
      const summary = await owner.get(`${API}/finance/brand/summary`);
      expect(summary.status).toBe(200);
      expect(summary.body).toMatchObject({ walletBalanceCents: 0, pendingCodCents: 0, settlementCycle: 'MONTHLY', nextSettlementDate: nextSettlementDay('MONTHLY', cairoToday()) });
      expect(summary.body.feesThisMonthCents).toBeGreaterThan(0);
      expect(summary.body.lastPaidSettlement.id).toBe(settlementId);
      const list = await owner.get(`${API}/finance/brand/settlements`);
      expect(list.body.data.map((s: any) => s.id)).toEqual([settlementId]);
      expect((await owner.get(`${API}/finance/brand/settlements/${settlementId}`)).body.lines).toHaveLength(4);
      const statement = await owner.get(`${API}/finance/brand/statement?pageSize=3`);
      expect(statement.status).toBe(200);
      expect(statement.body.closingBalanceCents).toBe(0);
      expect(statement.body.meta.total).toBeGreaterThanOrEqual(8);
      const page2 = await owner.get(`${API}/finance/brand/statement?pageSize=3&page=2`);
      const last1 = statement.body.data.at(-1);
      expect(page2.body.data[0].balanceCents).toBe(last1.balanceCents + page2.body.data[0].amountCents);
      const csv = await owner.get(`${API}/finance/brand/statement.csv`);
      expect(csv.headers['content-type']).toContain('text/csv');

      const nile = await t.as('brandNile');
      expect((await nile.get(`${API}/finance/brand/settlements/${settlementId}`)).status).toBe(404);
      expect((await nile.get(`${API}/finance/brand/settlements/${settlementId}/export.csv`)).status).toBe(404);
      expect((await nile.get(`${API}/finance/brand/settlements`)).body.data.some((s: any) => s.id === settlementId)).toBe(false);
      expect((await nile.get(`${API}/finance/brand/summary?brandId=${brand.id}`)).body.brand.code).toBe('NILE'); // brandId ignored for brand users
      expect((await nile.get(`${API}/finance/settlements`)).status).toBe(403);
      const fin = await t.as('finance');
      expect((await fin.get(`${API}/finance/brand/summary`)).body.code).toBe('BRAND_REQUIRED');
      expect((await fin.get(`${API}/finance/brand/summary?brandId=${brand.id}`)).body.brand.id).toBe(brand.id);
    });
  });

  it('cancel releases the orders so they can be settled again', async () => {
    const brand = await createBrand(t);
    const hero = await createHero(t);
    await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 20000 });
    const fin = await t.as('finance');
    const first = (await fin.post(`${API}/finance/settlements/generate`).send({ brandId: brand.id })).body.created[0];
    const cancelled = await fin.post(`${API}/finance/settlements/${first.id}/cancel`).send({ reason: 'Wrong period' });
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.lines).toHaveLength(0);
    const second = (await fin.post(`${API}/finance/settlements/generate`).send({ brandId: brand.id })).body.created[0];
    expect(second.netPayableCents).toBe(first.netPayableCents);
    expect(second.id).not.toBe(first.id);
  });

  it('respects periodEnd and the due-cycle job generates once per period', async () => {
    const brand = await createBrand(t, { cycle: 'DAILY' });
    const hero = await createHero(t);
    const yesterday = cairoDateTime(addDays(cairoToday(), -1), '12:00');
    await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 30000, deliveredAt: yesterday });
    await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 40000 });
    const service = t.app.get(SettlementsService);
    await service.runDue();
    await service.runDue();
    const rows = await t.db.select().from(settlements).where(eq(settlements.brandId, brand.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ordersCount: 1, codCollectedCents: 30000, status: 'DRAFT' });
    expect(rows[0].periodEnd.toISOString()).toBe(cairoDateTime(cairoToday(), '00:00').toISOString());
    const future = await (await t.as('finance')).post(`${API}/finance/settlements/generate`).send({ brandId: brand.id, periodEnd: new Date(Date.now() + 86_400_000).toISOString() });
    expect(future.body.code).toBe('PERIOD_IN_FUTURE');
  });

  describe('reports', () => {
    it('trial balance is balanced and the accounting equation holds', async () => {
      const res = await (await t.as('finance')).get(`${API}/finance/trial-balance`);
      expect(res.status).toBe(200);
      expect(res.body.balanced).toBe(true);
      expect(res.body.totalDebits).toBe(res.body.totalCredits);
      expect(res.body.equation.balanced).toBe(true);
      expect(res.body.accounts.every((a: any) => a.computedBalanceCents === a.balanceCents)).toBe(true);
      expect(res.body.accounts.some((a: any) => a.owner?.kind === 'brand')).toBe(true);
      expect((await (await t.as('dispatcher')).get(`${API}/finance/trial-balance`)).status).toBe(403);
    });

    it('P&L, cash position, daily summary and account statements', async () => {
      const fin = await t.as('finance');
      const pnl = await fin.get(`${API}/finance/pnl`);
      expect(pnl.status).toBe(200);
      expect(pnl.body.revenue.totalCents).toBeGreaterThan(0);
      expect(pnl.body.grossMarginCents).toBe(pnl.body.revenue.totalCents - pnl.body.expenses.heroPayCents);
      expect(pnl.body.volume.finalOrders).toBeGreaterThan(0);
      expect(pnl.body.unitEconomics.revenuePerOrderCents).toBe(Math.round(pnl.body.revenue.totalCents / pnl.body.volume.finalOrders));

      const pos = await fin.get(`${API}/finance/cash-position`);
      expect(pos.status).toBe(200);
      const tb = await t.app.get(LedgerService).trialBalance();
      const custody = tb.accounts.filter((a) => a.code.startsWith('1100:HERO:')).reduce((s, a) => s + a.balanceCents, 0);
      expect(pos.body.assets.heroCustodyCents).toBe(custody);
      expect(pos.body.liabilities.vatPayableCents).toBe(tb.accounts.find((a) => a.code === '2300')!.balanceCents);

      const daily = await fin.get(`${API}/finance/daily`);
      expect(daily.status).toBe(200);
      expect(daily.body.orders.delivered).toBeGreaterThan(0);
      expect(daily.body.ledgerByKind.COD_COLLECTED.amountCents).toBeGreaterThan(0);

      const st = await fin.get(`${API}/finance/accounts/2300/statement?pageSize=200`);
      expect(st.status).toBe(200);
      expect(st.body.data.at(-1).balanceCents).toBe(st.body.closingBalanceCents);
      expect((await fin.get(`${API}/finance/accounts/9999/statement`)).status).toBe(404);
      expect((await fin.get(`${API}/finance/pnl?from=2026-13-01`)).status).toBe(400);
    });
  });
});
