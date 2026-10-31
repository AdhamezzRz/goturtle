import { eq } from 'drizzle-orm';
import { courierAdjustments, shifts } from '../src/db/schema';
import { cairoToday } from '../src/db/helpers';
import { HeroLedgerService } from '../src/modules/finance/hero-ledger.service';
import { salaryForPeriod } from '../src/modules/finance/payroll.service';
import { ShiftsService } from '../src/modules/shifts/shifts.service';
import { addDays, monthStartOf } from '../src/modules/couriers/workforce.util';
import { createTestApp, type TestContext } from './helpers';
import { assertBalanced, createBrand, createHero, deliverOrder, failAttempt, loginWith, reloadHero } from './workforce-factories';

const API = '/api/v1';

describe('Finance — hero payroll & adjustments (e2e)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const payable = (id: string) => t.app.get(HeroLedgerService).balance(id);
  const today = () => cairoToday();

  it('prorates monthly salaries by calendar days', () => {
    expect(salaryForPeriod(900000, '2026-10-01', '2026-10-31')).toBe(900000);
    expect(salaryForPeriod(900000, '2026-02-01', '2026-02-28')).toBe(900000);
    expect(salaryForPeriod(900000, '2026-09-01', '2026-09-15')).toBe(450000);
    expect(salaryForPeriod(900000, '2026-10-01', '2026-11-30')).toBe(1800000);
    expect(salaryForPeriod(0, '2026-10-01', '2026-10-31')).toBe(0);
  });

  describe('freelance payroll', () => {
    let hero: Awaited<ReturnType<typeof createHero>>;
    let payoutId: string;
    let bonusId: string;

    beforeAll(async () => {
      hero = await createHero(t);
      const brand = await createBrand(t);
      await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 10000 });
      await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 20000 });
      await failAttempt(t, { brandId: brand.id, courierId: hero.id, codCents: 5000 });
    });

    it('adjustments post immediately and validate their direction', async () => {
      const fin = await t.as('finance');
      const bonus = await fin.post(`${API}/finance/adjustments`).send({ courierId: hero.id, type: 'BONUS', amountCents: 5000, reason: 'Top hero of the week' });
      expect(bonus.status).toBe(201);
      expect(bonus.body).toMatchObject({ type: 'BONUS', signedAmountCents: 5000, isReversal: false, payoutId: null });
      bonusId = bonus.body.id;
      const penalty = await fin.post(`${API}/finance/adjustments`).send({ courierId: hero.id, type: 'PENALTY', amountCents: 1000, reason: 'Late to hub' });
      expect(penalty.body.signedAmountCents).toBe(-1000);
      const shortage = await fin.post(`${API}/finance/adjustments`).send({ courierId: hero.id, type: 'CASH_SHORTAGE', amountCents: 999999, reason: 'Too much' });
      expect(shortage.body.code).toBe('SHORTAGE_EXCEEDS_CUSTODY');
      expect((await fin.post(`${API}/finance/adjustments`).send({ courierId: hero.id, type: 'BONUS', amountCents: -5, reason: 'neg' })).status).toBe(400);
      expect((await (await t.as('dispatcher')).post(`${API}/finance/adjustments`).send({ courierId: hero.id, type: 'BONUS', amountCents: 5, reason: 'nope' })).status).toBe(403);
      expect((await fin.delete(`${API}/finance/adjustments/${bonusId}`)).status).toBe(404); // no deletion route
      expect(await payable(hero.id)).toBe(2 * 2200 + 700 + 5000 - 1000);
      const list = await fin.get(`${API}/finance/adjustments?courierId=${hero.id}`);
      expect(list.body.meta.total).toBe(2);
    });

    it('generation snapshots the payable balance with a ledger breakdown and links adjustments', async () => {
      const fin = await t.as('finance');
      const res = await fin.post(`${API}/finance/payouts/generate`).send({ courierIds: [hero.id], periodStart: addDays(today(), -6), periodEnd: today() });
      expect(res.status).toBe(201);
      expect(res.body.created).toHaveLength(1);
      const p = res.body.created[0];
      payoutId = p.id;
      expect(p.code).toMatch(/^PAY-\d{6}$/);
      expect(p).toMatchObject({
        status: 'DRAFT', netCents: await payable(hero.id), deliveriesCount: 2, failedAttemptsCount: 1, pickupsCount: 0,
        deliveryEarningsCents: 2 * 2200 + 700, hourlyEarningsCents: 0, salaryCents: 0, bonusesCents: 5000, deductionsCents: 1000, carryOverCents: 0,
      });
      const linked = await t.db.select().from(courierAdjustments).where(eq(courierAdjustments.payoutId, p.id));
      expect(linked).toHaveLength(2);
      const again = await fin.post(`${API}/finance/payouts/generate`).send({ courierIds: [hero.id], periodStart: addDays(today(), -6), periodEnd: today() });
      expect(again.body.skipped).toEqual([{ courierId: hero.id, reason: 'PAYOUT_PENDING' }]);
      const future = await fin.post(`${API}/finance/payouts/generate`).send({ periodStart: today(), periodEnd: addDays(today(), 3) });
      expect(future.body.code).toBe('PERIOD_IN_FUTURE');
    });

    it('only payouts.manage can approve/pay; paying zeroes the payable', async () => {
      for (const who of ['dispatcher', 'ops'] as const) {
        const api = await t.as(who);
        expect((await api.post(`${API}/finance/payouts/${payoutId}/approve`)).status).toBe(403);
        expect((await api.post(`${API}/finance/payouts/${payoutId}/pay`).send({ method: 'VODAFONE_CASH' })).status).toBe(403);
      }
      const fin = await t.as('finance');
      expect((await fin.post(`${API}/finance/payouts/${payoutId}/pay`).send({ method: 'VODAFONE_CASH' })).body.code).toBe('INVALID_STATE');
      expect((await fin.post(`${API}/finance/payouts/${payoutId}/approve`)).body.status).toBe('APPROVED');
      const paid = await fin.post(`${API}/finance/payouts/${payoutId}/pay`).send({ method: 'VODAFONE_CASH', paymentReference: 'VF-9981' });
      expect(paid.status).toBe(200);
      expect(paid.body).toMatchObject({ status: 'PAID', method: 'VODAFONE_CASH', payableNowCents: 0 });
      expect(await payable(hero.id)).toBe(0);
      const none = await fin.post(`${API}/finance/payouts/generate`).send({ courierIds: [hero.id], periodStart: today(), periodEnd: today() });
      expect(none.body.skipped[0]).toMatchObject({ reason: 'NOTHING_PAYABLE', payableCents: 0 });
      await assertBalanced(t);
    });

    it('hero sees own payouts and earnings statement; never another hero’s', async () => {
      const api = await loginWith(t, hero.phone);
      const list = await api.get(`${API}/hero/me/payouts`);
      expect(list.body.data.map((p: any) => p.id)).toEqual([payoutId]);
      expect((await api.get(`${API}/hero/me/payouts/${payoutId}`)).body.adjustments).toHaveLength(2);
      expect((await (await t.as('hero1')).get(`${API}/hero/me/payouts/${payoutId}`)).status).toBe(404);
      const earnings = await api.get(`${API}/hero/me/earnings`);
      expect(earnings.status).toBe(200);
      expect(earnings.body.totals.byCategory.delivery).toMatchObject({ count: 2, netCents: 4400 });
      expect(earnings.body.totals.byCategory.attempt.netCents).toBe(700);
      expect(earnings.body.totals.byCategory.bonus.netCents).toBe(5000);
      expect(earnings.body.totals.byCategory.penalty.netCents).toBe(-1000);
      expect(earnings.body.totals.paidOutCents).toBe(9100);
      expect(earnings.body.payableCents).toBe(0);
      expect(earnings.body.data.length).toBe(6);
      const dash = await api.get(`${API}/hero/me/dashboard`);
      expect(dash.status).toBe(200);
      expect(dash.body.today).toMatchObject({ deliveries: 2, failedAttempts: 1, codCollectedCents: 30000 });
      expect(dash.body.cash).toMatchObject({ onHandCents: 30000, warning: 'OK' });
      expect(dash.body.gamification.level.level).toBe(1);
    });

    it('reverses an adjustment exactly once with mirror postings', async () => {
      const fin = await t.as('finance');
      const rev = await fin.post(`${API}/finance/adjustments/${bonusId}/reverse`).send({ reason: 'Granted by mistake' });
      expect(rev.status).toBe(200);
      expect(rev.body).toMatchObject({ isReversal: true, reversesId: bonusId, type: 'BONUS', signedAmountCents: -5000 });
      expect(await payable(hero.id)).toBe(-5000);
      expect((await fin.post(`${API}/finance/adjustments/${bonusId}/reverse`).send({ reason: 'again' })).body.code).toBe('ALREADY_REVERSED');
      expect((await fin.post(`${API}/finance/adjustments/${rev.body.id}/reverse`).send({ reason: 'again' })).body.code).toBe('CANNOT_REVERSE_REVERSAL');
      const earnings = await (await loginWith(t, hero.phone)).get(`${API}/hero/me/earnings`);
      expect(earnings.body.totals.byCategory.bonus.netCents).toBe(0);
      await assertBalanced(t);
    });
  });

  it('refuses to pay when the payable dropped after generation (PAYABLE_CHANGED); cancel unlinks', async () => {
    const hero = await createHero(t);
    const brand = await createBrand(t);
    await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 0 });
    const fin = await t.as('finance');
    const p = (await fin.post(`${API}/finance/payouts/generate`).send({ courierIds: [hero.id], periodStart: today(), periodEnd: today() })).body.created[0];
    expect(p.netCents).toBe(2200);
    await fin.post(`${API}/finance/payouts/${p.id}/approve`);
    await fin.post(`${API}/finance/adjustments`).send({ courierId: hero.id, type: 'PENALTY', amountCents: 500, reason: 'Damaged parcel' });
    const res = await fin.post(`${API}/finance/payouts/${p.id}/pay`).send({ method: 'CASH' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYABLE_CHANGED');
    expect((await fin.post(`${API}/finance/payouts/${p.id}/cancel`).send({ reason: 'Regenerate' })).body.status).toBe('CANCELLED');
    const regen = (await fin.post(`${API}/finance/payouts/generate`).send({ courierIds: [hero.id], periodStart: today(), periodEnd: today() })).body.created[0];
    expect(regen).toMatchObject({ netCents: 1700, deductionsCents: 500 });
  });

  it('adds the salary of FULL_TIME heroes once per period and links completed shifts', async () => {
    const salaried = await createHero(t, { employmentType: 'FULL_TIME', monthlySalaryCents: 900000 });
    const lastMonthEnd = addDays(monthStartOf(today()), -1);
    const lastMonthStart = monthStartOf(lastMonthEnd);
    const fin = await t.as('finance');
    const res = await fin.post(`${API}/finance/payouts/generate`).send({ courierIds: [salaried.id], periodStart: lastMonthStart, periodEnd: lastMonthEnd, includeSalary: true });
    expect(res.body.created[0]).toMatchObject({ salaryCents: 900000, netCents: 900000, carryOverCents: 0 }); // posted now, attributed to the period
    await fin.post(`${API}/finance/payouts/${res.body.created[0].id}/cancel`).send({ reason: 'redo' });
    const redo = await fin.post(`${API}/finance/payouts/generate`).send({ courierIds: [salaried.id], periodStart: lastMonthStart, periodEnd: lastMonthEnd, includeSalary: true });
    expect(redo.body.created[0].netCents).toBe(900000); // salary reference is idempotent

    const shiftHero = await createHero(t, { employmentType: 'SHIFT', hourlyRateCents: 6000 });
    const svc = t.app.get(ShiftsService);
    const ops = await t.as('ops');
    const start = new Date(Date.now() - 6 * 3_600_000);
    const s = await ops.post(`${API}/shifts`).send({ courierId: shiftHero.id, startAt: start.toISOString(), endAt: new Date(start.getTime() + 4 * 3_600_000).toISOString(), breakMinutes: 0 });
    await svc.clockIn(s.body.id, { at: start });
    await svc.clockOut(s.body.id, { at: new Date(start.getTime() + 4 * 3_600_000) });
    const p = (await fin.post(`${API}/finance/payouts/generate`).send({ courierIds: [shiftHero.id], periodStart: today(), periodEnd: today() })).body.created[0];
    expect(p).toMatchObject({ workedMinutes: 240, hourlyEarningsCents: 24000, netCents: 24000 });
    const [row] = await t.db.select().from(shifts).where(eq(shifts.id, s.body.id));
    expect(row.payoutId).toBe(p.id);
    const detail = await fin.get(`${API}/finance/payouts/${p.id}`);
    expect(detail.body.shifts).toHaveLength(1);
    expect(detail.body.categories.shift.netCents).toBe(24000);
    expect((await reloadHero(t, shiftHero.id)).id).toBe(shiftHero.id);
    await assertBalanced(t);
  });
});
