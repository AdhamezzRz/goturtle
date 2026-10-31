import { eq } from 'drizzle-orm';
import { shifts } from '../src/db/schema';
import { computeAttendance, lateMinutes, scheduledMinutes, shiftBounds } from '../src/modules/shifts/attendance';
import { ShiftsService } from '../src/modules/shifts/shifts.service';
import { HeroLedgerService } from '../src/modules/finance/hero-ledger.service';
import { createTestApp, type TestContext } from './helpers';
import { assertBalanced, createHero, heroByCode, hubByCode, loginWith, reloadHero } from './workforce-factories';

const API = '/api/v1';
const MIN = 60_000;

describe('Workforce — shifts & attendance (e2e)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  describe('attendance math', () => {
    const start = new Date('2026-11-01T07:00:00Z');
    const end = new Date('2026-11-01T15:00:00Z');
    const s = { startAt: start, endAt: end, breakMinutes: 30, hourlyRateCents: 4500 };

    it('late minutes respect the 5-minute grace', () => {
      expect(lateMinutes(start, new Date(start.getTime() + 5 * MIN))).toBe(0);
      expect(lateMinutes(start, new Date(start.getTime() + 6 * MIN))).toBe(6);
      expect(lateMinutes(start, new Date(start.getTime() - 10 * MIN))).toBe(0);
    });

    it('worked = out − in − break (never negative), overtime beyond schedule, pay = rate × worked / 60', () => {
      expect(scheduledMinutes(start, end, 30)).toBe(450);
      const a = computeAttendance(s, new Date(start.getTime() + 12 * MIN), new Date(end.getTime() + 40 * MIN));
      expect(a).toEqual({ workedMinutes: 478, overtimeMinutes: 28, scheduledMinutes: 450, earningsCents: Math.round((4500 * 478) / 60) });
      expect(computeAttendance(s, start, new Date(start.getTime() + 10 * MIN)).workedMinutes).toBe(0);
      const capped = computeAttendance(s, new Date(start.getTime() - 20 * MIN), end, { capAtScheduled: true });
      expect(capped.workedMinutes).toBe(450);
      expect(capped.overtimeMinutes).toBe(0);
    });

    it('converts Cairo wall-clock to UTC across both DST switches and handles overnight shifts', () => {
      // Egypt summer time ended on Thursday 2026-10-29 at 24:00 (UTC+3 → UTC+2).
      expect(shiftBounds('2026-10-29', '09:00', '17:00').startAt.toISOString()).toBe('2026-10-29T06:00:00.000Z');
      expect(shiftBounds('2026-10-30', '09:00', '17:00').startAt.toISOString()).toBe('2026-10-30T07:00:00.000Z');
      const overnight = shiftBounds('2026-10-29', '22:00', '06:00');
      expect(overnight.startAt.toISOString()).toBe('2026-10-29T19:00:00.000Z');
      expect(overnight.endAt.toISOString()).toBe('2026-10-30T04:00:00.000Z');
      expect((overnight.endAt.getTime() - overnight.startAt.getTime()) / MIN).toBe(9 * 60); // the night is one hour longer
      // Summer time started on Friday 2026-04-24 (UTC+2 → UTC+3).
      expect(shiftBounds('2026-04-23', '09:00', '17:00').startAt.toISOString()).toBe('2026-04-23T07:00:00.000Z');
      expect(shiftBounds('2026-04-24', '09:00', '17:00').startAt.toISOString()).toBe('2026-04-24T06:00:00.000Z');
    });
  });

  describe('templates & generation', () => {
    let templateId: string;
    let overnightId: string;

    it('CRUD templates with validation (shifts.manage)', async () => {
      const ops = await t.as('ops');
      const hub = await hubByCode(t, 'HUB-NSR');
      const created = await ops.post(`${API}/shifts/templates`).send({ name: 'Test Morning', startTime: '09:00', endTime: '17:00', daysOfWeek: [4, 5, 6], hubId: hub.id, requiredCouriers: 2, breakMinutes: 30 });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ overnight: false, lengthMinutes: 480, paidMinutes: 450 });
      templateId = created.body.id;
      const night = await ops.post(`${API}/shifts/templates`).send({ name: 'Test Night', startTime: '22:00', endTime: '06:00', daysOfWeek: [4], hourlyRateCents: 6000, breakMinutes: 0 });
      expect(night.body.overnight).toBe(true);
      overnightId = night.body.id;
      expect((await ops.post(`${API}/shifts/templates`).send({ name: 'Bad', startTime: '09:00', endTime: '09:00', daysOfWeek: [1] })).body.code).toBe('INVALID_SHIFT_TIMES');
      expect((await ops.post(`${API}/shifts/templates`).send({ name: 'Bad', startTime: '9am', endTime: '17:00', daysOfWeek: [1] })).status).toBe(400);
      expect((await ops.post(`${API}/shifts/templates`).send({ name: 'Bad', startTime: '09:00', endTime: '17:00', daysOfWeek: [7] })).status).toBe(400);
      const upd = await ops.patch(`${API}/shifts/templates/${templateId}`).send({ requiredCouriers: 3 });
      expect(upd.body.requiredCouriers).toBe(3);
      expect((await (await t.as('dispatcher')).post(`${API}/shifts/templates`).send({ name: 'X', startTime: '09:00', endTime: '17:00', daysOfWeek: [1] })).status).toBe(403);
      expect((await (await t.as('dispatcher')).get(`${API}/shifts/templates`)).status).toBe(200);
    });

    it('generates DST-correct shifts, freezes the rate and skips duplicates/overlaps', async () => {
      const ops = await t.as('ops');
      const a = await createHero(t, { employmentType: 'SHIFT', hourlyRateCents: 4500 });
      const b = await createHero(t, { employmentType: 'FULL_TIME' });
      // 2026-10-29 Thu, 30 Fri, 31 Sat
      const res = await ops.post(`${API}/shifts/generate`).send({ templateId, from: '2026-10-28', to: '2026-10-31', courierIds: [a.id, b.id] });
      expect(res.status).toBe(201);
      expect(res.body.created).toBe(6);
      const mine = res.body.shifts.filter((s: any) => s.courierId === a.id);
      expect(mine.map((s: any) => s.startAt)).toEqual(['2026-10-29T06:00:00.000Z', '2026-10-30T07:00:00.000Z', '2026-10-31T07:00:00.000Z']);
      expect(mine.map((s: any) => s.day)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
      expect(mine[0]).toMatchObject({ hourlyRateCents: 4500, breakMinutes: 30, status: 'SCHEDULED', scheduledMinutes: 450 });
      expect(res.body.shifts.find((s: any) => s.courierId === b.id).hourlyRateCents).toBe(0); // salaried

      const again = await ops.post(`${API}/shifts/generate`).send({ templateId, from: '2026-10-29', to: '2026-10-29', courierIds: [a.id] });
      expect(again.body.created).toBe(0);
      expect(again.body.skipped).toEqual([{ courierId: a.id, date: '2026-10-29', reason: 'DUPLICATE' }]);
      const night = await ops.post(`${API}/shifts/generate`).send({ templateId: overnightId, from: '2026-10-29', to: '2026-10-29', courierIds: [a.id] });
      expect(night.body.created).toBe(1);
      expect(night.body.shifts[0]).toMatchObject({ startAt: '2026-10-29T19:00:00.000Z', endAt: '2026-10-30T04:00:00.000Z', hourlyRateCents: 6000 });

      const manual = await ops.post(`${API}/shifts`).send({ courierId: a.id, startAt: '2026-10-30T10:00:00.000Z', endAt: '2026-10-30T12:00:00.000Z' });
      expect(manual.status).toBe(409);
      expect(manual.body.code).toBe('SHIFT_OVERLAP');
      const tooLong = await ops.get(`${API}/shifts/coverage?from=2026-01-01&to=2026-12-31`);
      expect(tooLong.body.code).toBe('RANGE_TOO_LARGE');

      const cov = await ops.get(`${API}/shifts/coverage?from=2026-10-29&to=2026-10-31`);
      expect(cov.status).toBe(200);
      const lines = cov.body.lines.filter((l: any) => l.templateId === templateId);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatchObject({ date: '2026-10-29', required: 3, scheduled: 2, gap: 1 });

      const cal = await ops.get(`${API}/shifts?from=2026-10-29&to=2026-10-31&courierId=${a.id}`);
      expect(cal.body.total).toBe(4);
      expect(cal.body.data[0].courier.code).toBe(a.code);

      const cancel = await ops.post(`${API}/shifts/${mine[2].id}/cancel`).send({ reason: 'Hero on leave' });
      expect(cancel.body.status).toBe('CANCELLED');
      expect((await ops.post(`${API}/shifts/${mine[2].id}/cancel`).send({ reason: 'again' })).body.code).toBe('INVALID_STATE');
    });
  });

  describe('availability rule for SHIFT heroes', () => {
    it('allows ONLINE only during a shift (or 15 min before), freelancers any time', async () => {
      const shiftHero = await heroByCode(t, 'HR-00003');
      const hero3 = await t.as('hero3');
      const refused = await hero3.patch(`${API}/hero/me/availability`).send({ availability: 'ONLINE' });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('NO_ACTIVE_SHIFT');
      expect((await hero3.patch(`${API}/hero/me/availability`).send({ availability: 'BUSY' })).status).toBe(400);

      const ops = await t.as('ops');
      const later = await ops.post(`${API}/shifts`).send({ courierId: shiftHero.id, startAt: new Date(Date.now() + 40 * MIN).toISOString(), endAt: new Date(Date.now() + 5 * 60 * MIN).toISOString() });
      expect(later.status).toBe(201);
      expect((await hero3.patch(`${API}/hero/me/availability`).send({ availability: 'ONLINE' })).body.code).toBe('NO_ACTIVE_SHIFT');
      await ops.patch(`${API}/shifts/${later.body.id}`).send({ startAt: new Date(Date.now() + 10 * MIN).toISOString() });
      const ok = await hero3.patch(`${API}/hero/me/availability`).send({ availability: 'ONLINE' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ availability: 'ONLINE', shiftId: later.body.id });
      expect((await hero3.patch(`${API}/hero/me/availability`).send({ availability: 'ON_BREAK' })).body.availability).toBe('ON_BREAK');
      expect((await hero3.patch(`${API}/hero/me/availability`).send({ availability: 'OFFLINE' })).body.availability).toBe('OFFLINE');
      await ops.post(`${API}/shifts/${later.body.id}/cancel`).send({ reason: 'test cleanup' });

      const freelancer = await t.as('hero1');
      expect((await freelancer.patch(`${API}/hero/me/availability`).send({ availability: 'ONLINE' })).body.availability).toBe('ONLINE');
      await freelancer.patch(`${API}/hero/me/availability`).send({ availability: 'OFFLINE' });
    });
  });

  describe('clock-in / clock-out', () => {
    it('hero clocks in late with a geofence warning, goes ONLINE, clocks out and is paid from the ledger', async () => {
      const hero = await createHero(t, { employmentType: 'SHIFT', hourlyRateCents: 4800 });
      const hub = await hubByCode(t, 'HUB-NSR');
      const ops = await t.as('ops');
      const shift = await ops.post(`${API}/shifts`).send({ courierId: hero.id, hubId: hub.id, startAt: new Date(Date.now() - 20 * MIN).toISOString(), endAt: new Date(Date.now() + 4 * 60 * MIN).toISOString(), breakMinutes: 0 });
      expect(shift.status).toBe(201);
      const api = await loginWith(t, hero.phone);
      const confirm = await api.post(`${API}/hero/me/shifts/${shift.body.id}/confirm`);
      expect(confirm.body.status).toBe('CONFIRMED');
      const inRes = await api.post(`${API}/hero/me/shifts/${shift.body.id}/clock-in`).send({ lat: 30.07, lng: 31.36 }); // ~2.6 km from the hub
      expect(inRes.status).toBe(200);
      expect(inRes.body.status).toBe('IN_PROGRESS');
      expect(inRes.body.lateMinutes).toBeGreaterThanOrEqual(19);
      expect(inRes.body.geofenceWarning).toBe(true);
      expect(inRes.body.warnings).toEqual(['GEOFENCE_WARNING']);
      expect((await reloadHero(t, hero.id)).availability).toBe('ONLINE');
      expect((await api.post(`${API}/hero/me/shifts/${shift.body.id}/clock-in`).send({ lat: 30.0566, lng: 31.3372 })).body.code).toBe('ALREADY_CLOCKED_IN');

      // Someone else cannot touch it.
      expect((await (await t.as('hero1')).post(`${API}/hero/me/shifts/${shift.body.id}/clock-out`).send({ lat: 30, lng: 31 })).status).toBe(404);

      const out = await api.post(`${API}/hero/me/shifts/${shift.body.id}/clock-out`).send({ lat: 30.0566, lng: 31.3372 });
      expect(out.status).toBe(200);
      expect(out.body.status).toBe('COMPLETED');
      expect(out.body.workedMinutes).toBeGreaterThanOrEqual(0);
      expect((await reloadHero(t, hero.id)).availability).toBe('OFFLINE');
    });

    it('staff-recorded attendance computes late / worked / overtime and posts round(rate × worked / 60) once', async () => {
      const hero = await createHero(t, { employmentType: 'SHIFT', hourlyRateCents: 4500 });
      const ops = await t.as('ops');
      const start = new Date(Date.now() - 10 * 60 * MIN);
      const end = new Date(start.getTime() + 8 * 60 * MIN);
      const s = await ops.post(`${API}/shifts`).send({ courierId: hero.id, startAt: start.toISOString(), endAt: end.toISOString(), breakMinutes: 30 });
      const early = await ops.post(`${API}/shifts/${s.body.id}/clock-in`).send({ at: new Date(start.getTime() - 45 * MIN).toISOString() });
      expect(early.body.code).toBe('TOO_EARLY');
      await ops.post(`${API}/shifts/${s.body.id}/clock-in`).send({ at: new Date(start.getTime() + 12 * MIN).toISOString() });
      const out = await ops.post(`${API}/shifts/${s.body.id}/clock-out`).send({ at: new Date(end.getTime() + 40 * MIN).toISOString() });
      expect(out.body).toMatchObject({ status: 'COMPLETED', lateMinutes: 12, workedMinutes: 478, overtimeMinutes: 28, earnedCents: 35850, earningsCents: 35850 });
      expect(await t.app.get(HeroLedgerService).balance(hero.id)).toBe(35850);
      expect((await ops.post(`${API}/shifts/${s.body.id}/clock-out`).send({})).body.code).toBe('NOT_CLOCKED_IN');
      expect((await ops.patch(`${API}/shifts/${s.body.id}`).send({ breakMinutes: 0 })).body.code).toBe('INVALID_STATE');
      await assertBalanced(t);
    });

    it('attendance job marks no-shows MISSED and auto clocks out forgotten shifts (capped, AUTO_CLOCK_OUT)', async () => {
      const service = t.app.get(ShiftsService);
      const hero = await createHero(t, { employmentType: 'SHIFT', hourlyRateCents: 6000 });
      const ops = await t.as('ops');
      const noShow = await ops.post(`${API}/shifts`).send({ courierId: hero.id, startAt: new Date(Date.now() - 45 * MIN).toISOString(), endAt: new Date(Date.now() + 3 * 60 * MIN).toISOString() });
      const fresh = await ops.post(`${API}/shifts`).send({ courierId: hero.id, startAt: new Date(Date.now() + 4 * 60 * MIN).toISOString(), endAt: new Date(Date.now() + 6 * 60 * MIN).toISOString() });
      const forgotStart = new Date(Date.now() - 14 * 60 * MIN);
      const forgot = await ops.post(`${API}/shifts`).send({ courierId: hero.id, startAt: forgotStart.toISOString(), endAt: new Date(forgotStart.getTime() + 8 * 60 * MIN).toISOString(), breakMinutes: 60 });
      await service.clockIn(forgot.body.id, { at: new Date(forgotStart.getTime() - 20 * MIN) });

      const result = await service.runAttendance();
      expect(result).toMatch(/missed \d+, auto clock-out \d+/);
      const [a] = await t.db.select().from(shifts).where(eq(shifts.id, noShow.body.id));
      const [b] = await t.db.select().from(shifts).where(eq(shifts.id, fresh.body.id));
      const [c] = await t.db.select().from(shifts).where(eq(shifts.id, forgot.body.id));
      expect(a.status).toBe('MISSED');
      expect(b.status).toBe('SCHEDULED');
      expect(c.status).toBe('COMPLETED');
      expect(c.notes).toContain('AUTO_CLOCK_OUT');
      expect(c.workedMinutes).toBe(7 * 60); // 8 h − 1 h break, capped although clocked in 20 min early
      expect(c.overtimeMinutes).toBe(0);
      expect(await t.app.get(HeroLedgerService).balance(hero.id)).toBe(6000 * 7);

      const heroApi = await loginWith(t, hero.phone);
      const list = await heroApi.get(`${API}/hero/me/shifts?from=${new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(Date.now() - 86_400_000))}`);
      expect(list.status).toBe(200);
      expect(list.body.data.every((s: any) => s.courierId === hero.id)).toBe(true);
      await assertBalanced(t);
    });
  });
});
