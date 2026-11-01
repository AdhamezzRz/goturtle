import { generateTrackingNumber } from '@goturtle/shared';
import * as s from '../src/db/schema';
import { newId } from '../src/db/columns';
import { cairoDateTime, cairoToday } from '../src/db/helpers';
import { addDays, weekdayOf } from '../src/modules/couriers/workforce.util';
import { eventMultiplier, fitDemandModel, forecastErrors } from '../src/modules/forecasting/demand-model';
import type { TestContext } from './helpers';
import { bootTestApp, createTestBrand, type Agent } from './ops-factories';
import { staffAgent } from './intake-factories';

const API = '/api/v1';
const FRIDAY = 5;

/** Synthetic counts: `count(day)` orders on each of the `days` days before `end` (inclusive). */
function synthetic(end: string, days: number, count: (day: string, weekIndex: number) => number) {
  const m = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = addDays(end, -i);
    m.set(d, count(d, 8 - Math.floor(i / 7)));
  }
  return m;
}

describe('Demand model (pure)', () => {
  const end = '2026-10-31';

  it('reproduces a stable weekday pattern exactly, with a zero-width interval', () => {
    const counts = synthetic(end, 56, (d) => (weekdayOf(d) === FRIDAY ? 4 : 10));
    const m = fitDemandModel({ counts, end });
    expect(m.weeksUsed).toBe(8);
    expect(m.slopePerWeek).toBe(0);
    expect(m.sigma).toBe(0);
    expect(m.weeklyLevel).toBe(64);
    for (let i = 1; i <= 14; i++) {
      const d = addDays(end, i);
      const f = m.forecast(d);
      const want = weekdayOf(d) === FRIDAY ? 4 : 10;
      expect(f).toMatchObject({ value: want, lower: want, upper: want, multiplier: 1, events: [] });
    }
  });

  it('extrapolates a linear trend', () => {
    // Every day of week k (1 = oldest … 8 = last week) has 10 + k orders → next week 19/day, the one after 20/day.
    const counts = synthetic(end, 56, (_d, k) => 10 + k);
    const m = fitDemandModel({ counts, end });
    expect(m.slopePerWeek).toBe(7);
    expect(m.forecast(addDays(end, 1)).value).toBe(19);
    expect(m.forecast(addDays(end, 7)).value).toBe(19);
    expect(m.forecast(addDays(end, 8)).value).toBe(20);
    expect(m.sigma).toBe(0);
  });

  it('applies event multipliers and de-seasonalises events in the history', () => {
    const events = [
      { name: 'White Friday', from: '2026-11-06', to: '2026-11-07', multiplier: 2.5 },
      { name: 'Past promo', from: '2026-10-20', to: '2026-10-20', multiplier: 3 },
    ];
    const counts = synthetic(end, 56, (d) => (d === '2026-10-20' ? 30 : 10));
    const m = fitDemandModel({ counts, end, events });
    expect(m.sigma).toBe(0); // the promo spike is explained by its multiplier
    expect(m.forecast('2026-11-05').value).toBe(10);
    expect(m.forecast('2026-11-06')).toMatchObject({ value: 25, multiplier: 2.5, events: ['White Friday'] });
    expect(eventMultiplier(events, '2026-11-07').names).toEqual(['White Friday']);
  });

  it('builds an 80% interval from noisy history that widens with the horizon', () => {
    const counts = synthetic(end, 56, (d) => 20 + (Number(d.slice(-2)) % 2 ? 4 : -4));
    const m = fitDemandModel({ counts, end });
    expect(m.sigma).toBeGreaterThan(3);
    const near = m.forecast(addDays(end, 1));
    const far = m.forecast(addDays(end, 28));
    expect(near.lower).toBeLessThan(near.value);
    expect(near.upper).toBeGreaterThan(near.value);
    expect(far.upper - far.lower).toBeGreaterThan(near.upper - near.lower);
  });

  it('copes with a brand-new network (less than a week of data)', () => {
    const counts = new Map([[end, 6], [addDays(end, -1), 8]]);
    const m = fitDemandModel({ counts, end, firstDay: addDays(end, -1) });
    expect(m.weeksUsed).toBe(0);
    expect(m.forecast(addDays(end, 7)).value).toBe(6); // same weekday as `end`
    expect(m.forecast(addDays(end, 3)).value).toBe(7); // unseen weekday → overall mean
  });

  it('MAPE / WAPE', () => {
    expect(forecastErrors([{ actual: 10, forecast: 8 }, { actual: 20, forecast: 25 }, { actual: 0, forecast: 3 }])).toEqual({ mape: 22.5, wape: 33.3, days: 3 });
    expect(forecastErrors([])).toEqual({ mape: null, wape: null, days: 0 });
  });
});

describe('Forecast & staffing API (e2e)', () => {
  let t: TestContext;
  let ops: Agent;
  let hubId: string;
  let templateId: string;
  const today = cairoToday();

  beforeAll(async () => {
    t = await bootTestApp();
    ops = await staffAgent(t, 'ops');
    const brand = await createTestBrand(t);
    // An isolated hub and zone so other suites' orders never reach this series.
    hubId = newId();
    const [city] = await t.db.select({ id: s.cities.id }).from(s.cities).limit(1);
    await t.db.insert(s.hubs).values({ id: hubId, code: `FC-${hubId.slice(-6).toUpperCase()}`, name: 'Forecast Hub', address: 'Test', lat: 30, lng: 31 });
    const zoneId = newId();
    await t.db.insert(s.zones).values({ id: zoneId, code: `FCZ-${zoneId.slice(-6).toUpperCase()}`, nameEn: 'Forecast Zone', nameAr: 'منطقة', cityId: city.id, hubId, keywords: [], centerLat: 30, centerLng: 31 });
    const customerId = newId();
    await t.db.insert(s.customers).values({ id: customerId, phone: `+2010${Date.now().toString().slice(-8)}`, name: 'Forecast Customer' });
    // 12 weeks of history: 10 orders a day, 4 on Fridays.
    const rows: Array<typeof s.orders.$inferInsert> = [];
    for (let i = 1; i <= 84; i++) {
      const day = addDays(today, -i);
      const n = weekdayOf(day) === FRIDAY ? 4 : 10;
      for (let k = 0; k < n; k++) {
        rows.push({
          trackingNumber: generateTrackingNumber(), brandId: brand.brandId, customerId, recipientName: 'Forecast Customer', recipientPhone: '+201000000999',
          addressLine: 'Forecast street', zoneId, hubId, createdAt: cairoDateTime(day, `${String(9 + (k % 12)).padStart(2, '0')}:15`),
        });
      }
    }
    // A cancelled order never counts as demand.
    rows.push({ trackingNumber: generateTrackingNumber(), brandId: brand.brandId, customerId, recipientName: 'X', recipientPhone: '+201000000999', addressLine: 'x', zoneId, hubId, status: 'CANCELLED', createdAt: cairoDateTime(addDays(today, -3), '12:00') });
    for (let i = 0; i < rows.length; i += 200) await t.db.insert(s.orders).values(rows.slice(i, i + 200));
    templateId = newId();
    await t.db.insert(s.shiftTemplates).values({ id: templateId, name: 'Forecast day shift', startTime: '09:00', endTime: '17:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], hubId, requiredCouriers: 1 });
  });
  afterAll(async () => {
    const admin = await staffAgent(t, 'admin');
    await admin.put(`${API}/settings/platform`).send({ value: { forecastEvents: [] } });
    await t.close();
  });

  it('forecasts the weekday pattern per day and per hub, with actuals and staffing gaps', async () => {
    const from = addDays(today, -7);
    const to = addDays(today, 7);
    const started = Date.now();
    const res = await ops.get(`${API}/forecast/demand?hubId=${hubId}&from=${from}&to=${to}`);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from, to, asOf: today, by: 'hub', history: { weeks: 8, weeksUsed: 8 }, model: { slopePerWeek: 0, sigma: 0, weeklyLevel: 64 } });
    expect(res.body.days).toHaveLength(15);
    for (const d of res.body.days) {
      const want = weekdayOf(d.date) === FRIDAY ? 4 : 10;
      expect(d).toMatchObject({ forecast: want, lower: want, upper: want });
      if (d.date < today) expect(d.actual).toBe(want);
      if (d.date > today) expect(d.actual).toBeNull();
    }
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0]).toMatchObject({ id: hubId, name: 'Forecast Hub' });

    const staffing = res.body.staffing;
    expect(staffing.ordersPerHeroPerShift).toBe(25);
    const rows = staffing.rows.filter((r: { templateId: string }) => r.templateId === templateId);
    expect(rows).toHaveLength(8); // today … today+7
    expect(rows[0]).toMatchObject({ hubId, templateName: 'Forecast day shift', recommended: 1, scheduled: 0, gap: -1 });
    expect(staffing.summary.understaffedDays).toBe(8);
  });

  it('counts scheduled shifts against the recommendation', async () => {
    const [hero] = await t.db.select({ id: s.couriers.id }).from(s.couriers).limit(1);
    const day = addDays(today, 2);
    await t.db.insert(s.shifts).values({ courierId: hero.id, templateId, hubId, startAt: cairoDateTime(day, '09:00'), endAt: cairoDateTime(day, '17:00'), status: 'SCHEDULED' });
    const admin = await staffAgent(t, 'admin');
    expect((await admin.put(`${API}/settings/platform`).send({ value: { ordersPerHeroPerShift: 4 } })).status).toBe(200);
    const res = await ops.get(`${API}/forecast/demand?hubId=${hubId}&from=${day}&to=${day}`);
    const row = res.body.staffing.rows.find((r: { templateId: string }) => r.templateId === templateId);
    const want = weekdayOf(day) === FRIDAY ? 1 : 3; // ceil(4/4) or ceil(10/4)
    expect(row).toMatchObject({ date: day, recommended: want, scheduled: 1, gap: 1 - want });
    await admin.put(`${API}/settings/platform`).send({ value: { ordersPerHeroPerShift: 25 } });
  });

  it('applies event multipliers from settings', async () => {
    const admin = await staffAgent(t, 'admin');
    const day = addDays(today, 3);
    const bad = await admin.put(`${API}/settings/platform`).send({ value: { forecastEvents: [{ name: 'Oops', from: day, to: addDays(day, -1), multiplier: 2 }] } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_SETTING');
    expect((await admin.put(`${API}/settings/platform`).send({ value: { forecastEvents: [{ name: 'White Friday', from: day, to: day, multiplier: 2 }] } })).status).toBe(200);
    const res = await ops.get(`${API}/forecast/demand?hubId=${hubId}&from=${day}&to=${addDays(day, 1)}`);
    const base = weekdayOf(day) === FRIDAY ? 4 : 10;
    expect(res.body.days[0]).toMatchObject({ forecast: base * 2, multiplier: 2, events: ['White Friday'] });
    expect(res.body.days[1].multiplier).toBe(1);
    expect(res.body.events).toHaveLength(1);
    await admin.put(`${API}/settings/platform`).send({ value: { forecastEvents: [] } });
  });

  it('backtests the last 4 weeks (MAPE 0 on a perfectly regular history)', async () => {
    const res = await ops.get(`${API}/forecast/accuracy?hubId=${hubId}&weeks=4`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ weeks: 4, mape: 0, wape: 0, accuracy: 100, intervalCoverage: 100 });
    expect(res.body.days).toHaveLength(28);
    expect(res.body.perWeek).toHaveLength(4);
  });

  it('validates ranges and permissions', async () => {
    expect((await ops.get(`${API}/forecast/demand?from=${today}&to=${addDays(today, -1)}`)).status).toBe(400);
    expect((await ops.get(`${API}/forecast/demand?from=${today}&to=${addDays(today, 120)}`)).status).toBe(400);
    expect((await ops.get(`${API}/forecast/demand?from=2026-13-01`)).status).toBe(400);
    const zones = await ops.get(`${API}/forecast/demand?by=zone&hubId=${hubId}`);
    expect(zones.body.staffing).toBeNull();
    expect(zones.body.groups[0].name).toBe('Forecast Zone');
    const brand = await (await createTestBrand(t)).login();
    expect((await brand.get(`${API}/forecast/demand`)).status).toBe(403);
  });
});
