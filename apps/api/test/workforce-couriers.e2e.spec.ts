import { and, eq } from 'drizzle-orm';
import { courierLocations, couriers } from '../src/db/schema';
import { parseEgyptNationalId } from '../src/modules/couriers/national-id';
import { createTestApp, type TestContext } from './helpers';
import { assertBalanced, brandByCode, createHero, deliverOrder, loginWith, reloadHero, zoneByCode } from './workforce-factories';

const API = '/api/v1';

describe('Workforce — heroes (e2e)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  describe('national ID', () => {
    it('parses date of birth, governorate and gender', () => {
      expect(parseEgyptNationalId('29501010112355')).toEqual({ dateOfBirth: '1995-01-01', governorate: 'Cairo', gender: 'MALE' });
      expect(parseEgyptNationalId('29501010112345')?.gender).toBe('FEMALE');
      expect(parseEgyptNationalId('30002292100022')?.dateOfBirth).toBe('2000-02-29');
      expect(parseEgyptNationalId('29513010112345')).toBeNull(); // month 13
      expect(parseEgyptNationalId('29501019912345')).toBeNull(); // governorate 99
      expect(parseEgyptNationalId('19501010112345')).toBeNull(); // century 1
    });
  });

  describe('onboarding', () => {
    let created: any;
    const phone = '01091234567';

    it('creates the user + hero with a sequence code and a one-time temporary password that works', async () => {
      const ops = await t.as('ops');
      const nasr = await zoneByCode(t, 'CAI-NASR');
      const helio = await zoneByCode(t, 'CAI-HELIO');
      const res = await ops.post(`${API}/couriers`).send({
        name: 'Omar Hamdy', phone, employmentType: 'SHIFT', vehicleType: 'SCOOTER', nationalId: '29501010112345',
        zones: [{ zoneId: nasr.id }, { zoneId: helio.id, isPrimary: true }], emergencyContact: { name: 'Hamdy', phone: '01012345678', relation: 'Father' },
      });
      expect(res.status).toBe(201);
      created = res.body;
      expect(created.code).toMatch(/^HR-\d{5}$/);
      expect(Number(created.code.slice(3))).toBeGreaterThanOrEqual(11);
      expect(created.temporaryPassword).toMatch(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/);
      expect(created.status).toBe('PENDING_ONBOARDING');
      expect(created.dateOfBirth).toBe('1995-01-01');
      expect(created.rates.hourlyRateCents).toBe(4500);
      expect(created.zones.find((z: any) => z.isPrimary).zoneId).toBe(helio.id);
      expect(created.emergencyContact.phone).toBe('+201012345678');
      expect(created).not.toHaveProperty('passwordHash');

      const hero = await loginWith(t, phone, created.temporaryPassword);
      expect(hero.user.portal).toBe('hero');
      expect(hero.user.courier.code).toBe(created.code);
      const me = await hero.get(`${API}/hero/me`);
      expect(me.status).toBe(200);
      expect(me.body.level.level).toBe(1);
    });

    it('hands out increasing codes and rejects duplicates and invalid input', async () => {
      const ops = await t.as('ops');
      const second = await ops.post(`${API}/couriers`).send({ name: 'Karim Said', phone: '01191234567', employmentType: 'FREELANCE' });
      expect(second.status).toBe(201);
      expect(Number(second.body.code.slice(3))).toBe(Number(created.code.slice(3)) + 1);
      expect(second.body.rates.perDeliveryRateCents).toBe(2200);

      const dup = await ops.post(`${API}/couriers`).send({ name: 'Copy', phone, employmentType: 'FREELANCE' });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('PHONE_TAKEN');
      const dupId = await ops.post(`${API}/couriers`).send({ name: 'Copy', phone: '01291234567', employmentType: 'FREELANCE', nationalId: '29501010112345' });
      expect(dupId.body.code).toBe('NATIONAL_ID_TAKEN');
      const badId = await ops.post(`${API}/couriers`).send({ name: 'Bad', phone: '01291234568', employmentType: 'FREELANCE', nationalId: '29513010112345' });
      expect(badId.status).toBe(400);
      expect(badId.body.code).toBe('INVALID_NATIONAL_ID');
      const shortId = await ops.post(`${API}/couriers`).send({ name: 'Bad', phone: '01291234568', employmentType: 'FREELANCE', nationalId: '123' });
      expect(shortId.status).toBe(400);
      const minor = await ops.post(`${API}/couriers`).send({ name: 'Kid', phone: '01291234569', employmentType: 'FREELANCE', nationalId: '31501010112345' });
      expect(minor.body.code).toBe('HERO_UNDERAGE');
      const badPhone = await ops.post(`${API}/couriers`).send({ name: 'Bad', phone: '0123', employmentType: 'FREELANCE' });
      expect(badPhone.body.code).toBe('INVALID_PHONE');
      const noRate = await ops.post(`${API}/couriers`).send({ name: 'Shift', phone: '01291234560', employmentType: 'SHIFT', hourlyRateCents: 0 });
      expect(noRate.body.code).toBe('HOURLY_RATE_REQUIRED');
    });

    it('requires couriers.manage (dispatcher and finance cannot onboard)', async () => {
      for (const who of ['dispatcher', 'finance'] as const) {
        const r = await (await t.as(who)).post(`${API}/couriers`).send({ name: 'X Y', phone: '01591234567', employmentType: 'FREELANCE' });
        expect(r.status).toBe(403);
      }
      expect((await (await t.as('hero1')).get(`${API}/couriers`)).status).toBe(403);
      expect((await (await t.as('brandNile')).get(`${API}/couriers`)).status).toBe(403);
    });

    it('updates profile, rates and zones with audit', async () => {
      const ops = await t.as('ops');
      const zone = await zoneByCode(t, 'CAI-MAADI');
      const res = await ops.patch(`${API}/couriers/${created.id}`).send({ hourlyRateCents: 5000, cashLimitCents: 300000, zones: [{ zoneId: zone.id }], name: 'Omar H.' });
      expect(res.status).toBe(200);
      expect(res.body.rates.hourlyRateCents).toBe(5000);
      expect(res.body.cash.limitCents).toBe(300000);
      expect(res.body.zones).toHaveLength(1);
      expect(res.body.zones[0]).toMatchObject({ zoneId: zone.id, isPrimary: true });
      expect(res.body.name).toBe('Omar H.');
    });

    it('activates (with missing-document warnings), suspends (login blocked) and re-activates', async () => {
      const ops = await t.as('ops');
      const act = await ops.post(`${API}/couriers/${created.id}/activate`).send({});
      expect(act.status).toBe(200);
      expect(act.body.status).toBe('ACTIVE');
      expect(act.body.warnings).toEqual(expect.arrayContaining(['MISSING_DOCUMENT:NATIONAL_ID_FRONT', 'MISSING_DOCUMENT:DRIVING_LICENSE']));
      const again = await ops.post(`${API}/couriers/${created.id}/activate`).send({});
      expect(again.body.code).toBe('INVALID_TRANSITION');

      const sus = await ops.post(`${API}/couriers/${created.id}/suspend`).send({ reason: 'Uniform policy' });
      expect(sus.body.status).toBe('SUSPENDED');
      const blocked = await t.http().post(`${API}/auth/login`).send({ identifier: phone, password: created.temporaryPassword });
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('ACCOUNT_DISABLED');
      expect((await ops.post(`${API}/couriers/${created.id}/activate`).send({ reason: 'ok' })).body.status).toBe('ACTIVE');
    });

    it('refuses to offboard a hero holding cash (CASH_OUTSTANDING) and offboards once custody is zero', async () => {
      const ops = await t.as('ops');
      const hero = await createHero(t);
      const brand = await brandByCode(t, 'NILE');
      await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 25000 });
      const refused = await ops.post(`${API}/couriers/${hero.id}/offboard`).send({ reason: 'Leaving' });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('CASH_OUTSTANDING');
      const fin = await t.as('finance');
      expect((await fin.post(`${API}/cash/handovers`).send({ courierId: hero.id, amountCents: 25000, method: 'CASH_AT_HUB' })).status).toBe(201);
      const off = await ops.post(`${API}/couriers/${hero.id}/offboard`).send({ reason: 'Leaving' });
      expect(off.status).toBe(200);
      expect(off.body.status).toBe('OFFBOARDED');
      expect((await ops.post(`${API}/couriers/${hero.id}/activate`).send({})).body.code).toBe('INVALID_TRANSITION');
      expect((await ops.patch(`${API}/couriers/${hero.id}`).send({ name: 'Xavier' })).body.code).toBe('COURIER_OFFBOARDED');
      await assertBalanced(t);
    });
  });

  describe('list & detail', () => {
    it('filters, searches and sorts', async () => {
      const ops = await t.as('ops');
      const shift = await ops.get(`${API}/couriers?employmentType=SHIFT&pageSize=100`);
      expect(shift.status).toBe(200);
      expect(shift.body.data.length).toBeGreaterThanOrEqual(3);
      expect(shift.body.data.every((c: any) => c.employmentType === 'SHIFT')).toBe(true);
      const byCode = await ops.get(`${API}/couriers?q=HR-00001`);
      expect(byCode.body.data[0].code).toBe('HR-00001');
      const byPhone = await ops.get(`${API}/couriers?q=01200000002`);
      expect(byPhone.body.data.map((c: any) => c.code)).toContain('HR-00002');
      const maadi = await zoneByCode(t, 'CAI-MAADI');
      const inZone = await ops.get(`${API}/couriers?zoneId=${maadi.id}&pageSize=100`);
      expect(inZone.body.data.map((c: any) => c.code)).toEqual(expect.arrayContaining(['HR-00004', 'HR-00005']));
      expect(inZone.body.data.every((c: any) => c.zones.some((z: any) => z.zoneId === maadi.id))).toBe(true);
      const sorted = await ops.get(`${API}/couriers?sort=xp&order=desc&pageSize=5`);
      const xp = sorted.body.data.map((c: any) => c.xp);
      expect([...xp].sort((a, b) => b - a)).toEqual(xp);
      expect(sorted.body.meta.pageSize).toBe(5);
    });

    it('shows KPIs for today / 7d / 30d from delivered orders, failed attempts and the ledger', async () => {
      const hero = await createHero(t);
      const brand = await brandByCode(t, 'CGAD');
      const now = new Date();
      await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 40000, deliveredAt: now, outForDeliveryAt: new Date(now.getTime() - 30 * 60_000) });
      await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 0, deliveredAt: new Date(now.getTime() - 3 * 86_400_000), outForDeliveryAt: new Date(now.getTime() - 3 * 86_400_000 - 60 * 60_000) });
      const res = await (await t.as('dispatcher')).get(`${API}/couriers/${hero.id}`);
      expect(res.status).toBe(200);
      expect(res.body.kpis.today).toMatchObject({ deliveries: 1, failedAttempts: 0, successRate: 100, codCollectedCents: 40000, avgDeliveryMinutes: 30 });
      expect(res.body.kpis.last7d).toMatchObject({ deliveries: 2, codCollectedCents: 40000, avgDeliveryMinutes: 45 });
      expect(res.body.kpis.last30d.earningsCents).toBe(2 * 2200);
      expect(res.body.cash).toMatchObject({ onHandCents: 40000, limitCents: 600000, warning: 'OK' });
      expect(res.body.payableCents).toBe(4400);
      expect((await (await t.as('ops')).get(`${API}/couriers/nope`)).status).toBe(404);
    });
  });

  describe('documents', () => {
    it('creates, reviews (note required to reject) and lists expiring documents', async () => {
      const hero = await createHero(t);
      const heroApi = await loginWith(t, hero.phone);
      const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
      const up = await heroApi.post(`${API}/hero/me/documents`).send({ type: 'DRIVING_LICENSE', url: '/api/v1/files/courier_document/2026-10/abc123def.jpg', expiresAt: soon });
      expect(up.status).toBe(201);
      expect(up.body.status).toBe('PENDING');
      const bad = await heroApi.post(`${API}/hero/me/documents`).send({ type: 'DRIVING_LICENSE', url: 'javascript:alert(1)' });
      expect(bad.status).toBe(400);

      const ops = await t.as('ops');
      const reject = await ops.post(`${API}/couriers/${hero.id}/documents/${up.body.id}/review`).send({ status: 'REJECTED' });
      expect(reject.body.code).toBe('NOTE_REQUIRED');
      const ok = await ops.post(`${API}/couriers/${hero.id}/documents/${up.body.id}/review`).send({ status: 'APPROVED', note: 'Clear photo' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('APPROVED');
      const expiring = await ops.get(`${API}/couriers/documents/expiring?days=30`);
      const mine = expiring.body.documents.find((d: any) => d.id === up.body.id);
      expect(mine).toBeDefined();
      expect(mine.daysLeft).toBeGreaterThanOrEqual(9);
      expect((await heroApi.get(`${API}/hero/me/documents`)).body).toHaveLength(1);
    });
  });

  describe('location pings', () => {
    it('throttles history (≥30 s or ≥50 m), ignores inaccurate and stale points, always refreshes the last position', async () => {
      const hero = await createHero(t);
      const api = await loginWith(t, hero.phone);
      const base = Date.now() - 10 * 60_000;
      const at = (s: number) => new Date(base + s * 1000).toISOString();
      const lat = 30.0566;
      const lng = 31.3372;
      const res = await api.post(`${API}/hero/me/location`).send({
        points: [
          { lat, lng, accuracy: 10, recordedAt: at(0), battery: 80 },
          { lat: lat + 0.0001, lng, accuracy: 10, recordedAt: at(10) }, // 11 m, 10 s → skipped
          { lat: lat + 0.001, lng, accuracy: 15, recordedAt: at(20) }, // ~110 m → stored
          { lat: lat + 0.001, lng, accuracy: 15, recordedAt: at(25) }, // same place, 5 s → skipped
          { lat: lat + 0.001, lng, accuracy: 20, recordedAt: at(60) }, // 40 s → stored
          { lat: 30.5, lng: 31.5, accuracy: 500, recordedAt: at(70) }, // inaccurate → ignored
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ received: 6, stored: 3, ignoredInaccurate: 1, ignoredStale: 0 });
      const stored = await t.db.select().from(courierLocations).where(eq(courierLocations.courierId, hero.id));
      expect(stored).toHaveLength(3);
      const c = await reloadHero(t, hero.id);
      expect(c.lastLat).toBeCloseTo(lat + 0.001, 6);
      expect(c.lastSeenAt!.toISOString()).toBe(at(60));

      const replay = await api.post(`${API}/hero/me/location`).send({ points: [{ lat, lng, recordedAt: at(30) }] });
      expect(replay.body).toMatchObject({ stored: 0, ignoredStale: 1 });
      const tooMany = await api.post(`${API}/hero/me/location`).send({ points: Array.from({ length: 21 }, () => ({ lat, lng })) });
      expect(tooMany.status).toBe(400);
      const badLat = await api.post(`${API}/hero/me/location`).send({ points: [{ lat: 123, lng }] });
      expect(badLat.status).toBe(400);

      // Staff views: live map and breadcrumbs.
      const dispatcher = await t.as('dispatcher');
      await t.db.update(couriers).set({ lastSeenAt: new Date() }).where(eq(couriers.id, hero.id));
      const live = await dispatcher.get(`${API}/couriers/live?since=${new Date(Date.now() - 60_000).toISOString()}`);
      expect(live.status).toBe(200);
      const me = live.body.data.find((r: any) => r.id === hero.id);
      expect(me).toMatchObject({ code: hero.code, availability: 'OFFLINE', activeOrders: 0, stale: false });
      expect(live.body.serverTime).toBeDefined();
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(base + 60_000));
      const track = await dispatcher.get(`${API}/couriers/${hero.id}/track?date=${day}`);
      expect(track.status).toBe(200);
      expect(track.body.points.length).toBe(3);
      expect(track.body.summary.distanceKm).toBeGreaterThan(0.1);
      expect((await (await t.as('finance')).get(`${API}/couriers/live`)).status).toBe(403);
      const rows = await t.db.select().from(courierLocations).where(and(eq(courierLocations.courierId, hero.id)));
      expect(rows.length).toBe(3);
    });
  });

  describe('leaderboard', () => {
    it('ranks heroes by period XP with deliveries and success rate', async () => {
      const hero = await createHero(t);
      const brand = await brandByCode(t, 'BLOOM');
      for (let i = 0; i < 3; i++) await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 10000, promisedBy: new Date(Date.now() + 3_600_000) });
      const res = await (await t.as('ops')).get(`${API}/couriers/leaderboard?period=day&limit=100`);
      expect(res.status).toBe(200);
      const row = res.body.data.find((r: any) => r.courierId === hero.id);
      expect(row).toMatchObject({ deliveries: 3, onTime: 3, successRate: 100, periodXp: 45 });
      const ranks = res.body.data.map((r: any) => r.periodXp);
      expect([...ranks].sort((a: number, b: number) => b - a)).toEqual(ranks);
      const heroView = await (await loginWith(t, hero.phone)).get(`${API}/hero/me/leaderboard?period=day`);
      expect(heroView.body.me.courierId).toBe(hero.id);
    });
  });
});
