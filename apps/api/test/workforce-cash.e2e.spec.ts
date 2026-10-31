import { eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { XP_RULES } from '@goturtle/shared';
import { couriers, orders } from '../src/db/schema';
import { DomainEvents, type PickupCompletedEvent } from '../src/core/events';
import { HeroLedgerService } from '../src/modules/finance/hero-ledger.service';
import { GamificationService } from '../src/modules/gamification/gamification.service';
import { cairoDateTime, cairoToday } from '../src/db/helpers';
import { addDays } from '../src/modules/couriers/workforce.util';
import { createTestApp, type TestContext } from './helpers';
import { assertBalanced, createBrand, createHero, deliverOrder, emitStatus, eventually, failAttempt, loginWith, reloadHero, sleep } from './workforce-factories';

const API = '/api/v1';

describe('Workforce — cash custody & gamification (e2e)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  describe('handovers', () => {
    let hero: Awaited<ReturnType<typeof createHero>>;
    let brandId: string;
    const ids: string[] = [];
    let pendingId: string;

    beforeAll(async () => {
      hero = await createHero(t);
      brandId = (await createBrand(t)).id;
      const base = Date.now() - 5 * 3_600_000;
      for (const [i, cod] of [30000, 50000, 20000].entries()) {
        ids.push((await deliverOrder(t, { brandId, courierId: hero.id, codCents: cod, deliveredAt: new Date(base + i * 3_600_000) })).id);
      }
    });

    it('hero sees own wallet: custody, unhanded COD orders oldest first with age', async () => {
      const api = await loginWith(t, hero.phone);
      const w = await api.get(`${API}/hero/me/wallet`);
      expect(w.status).toBe(200);
      expect(w.body).toMatchObject({ cashOnHandCents: 100000, unhandedOrders: 3, unhandedCents: 100000, pendingDeclaredCents: 0 });
      expect(w.body.orders.map((o: any) => o.id)).toEqual(ids);
      expect(w.body.orders[0].ageHours).toBeGreaterThanOrEqual(4.9);
      // Another hero sees nothing of this.
      const other = await (await t.as('hero2')).get(`${API}/hero/me/wallet`);
      expect(other.body.orders.some((o: any) => ids.includes(o.id))).toBe(false);
      expect((await (await t.as('hero2')).get(`${API}/cash/custody`)).status).toBe(403);
    });

    it('declares within custody (minus pending declarations), requires a reference for transfers', async () => {
      const api = await loginWith(t, hero.phone);
      const d = await api.post(`${API}/hero/me/handovers`).send({ amountCents: 80000, method: 'CASH_AT_HUB' });
      expect(d.status).toBe(201);
      expect(d.body).toMatchObject({ status: 'PENDING', declaredCents: 80000 });
      expect(d.body.code).toMatch(/^HO-\d{6}$/);
      expect(d.body.hub.code).toBe('HUB-NSR');
      pendingId = d.body.id;
      const over = await api.post(`${API}/hero/me/handovers`).send({ amountCents: 30000, method: 'CASH_AT_HUB' });
      expect(over.status).toBe(422);
      expect(over.body.code).toBe('HANDOVER_EXCEEDS_CUSTODY');
      const noRef = await api.post(`${API}/hero/me/handovers`).send({ amountCents: 1000, method: 'INSTAPAY' });
      expect(noRef.body.code).toBe('REFERENCE_REQUIRED');
      const list = await api.get(`${API}/hero/me/handovers`);
      expect(list.body.data.map((h: any) => h.id)).toEqual([pendingId]);
      expect((await (await t.as('hero1')).get(`${API}/hero/me/handovers/${pendingId}`)).status).toBe(404);
    });

    it('confirm: custody decreases by received, variance recorded, oldest orders linked while they fit', async () => {
      const fin = await t.as('finance');
      const res = await fin.post(`${API}/cash/handovers/${pendingId}/confirm`).send({ receivedCents: 79500, notes: 'Counted twice' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CONFIRMED', receivedCents: 79500, varianceCents: -500 });
      expect(res.body.linkedOrders.map((o: any) => o.id)).toEqual([ids[0]]); // 300 fits, 500 does not fit in the remaining 495
      expect((await reloadHero(t, hero.id)).cashOnHandCents).toBe(20500);
      const again = await fin.post(`${API}/cash/handovers/${pendingId}/confirm`).send({ receivedCents: 1 });
      expect(again.body.code).toBe('INVALID_STATE');
      await assertBalanced(t);
    });

    it('cannot confirm more than custody; rejection keeps custody', async () => {
      const api = await loginWith(t, hero.phone);
      const d = await api.post(`${API}/hero/me/handovers`).send({ amountCents: 10000, method: 'VODAFONE_CASH', reference: 'VF-123' });
      const fin = await t.as('finance');
      const tooMuch = await fin.post(`${API}/cash/handovers/${d.body.id}/confirm`).send({ receivedCents: 999999 });
      expect(tooMuch.status).toBe(422);
      expect(tooMuch.body.code).toBe('HANDOVER_EXCEEDS_CUSTODY');
      const rej = await fin.post(`${API}/cash/handovers/${d.body.id}/reject`).send({ reason: 'Transfer not received' });
      expect(rej.body.status).toBe('REJECTED');
      expect((await reloadHero(t, hero.id)).cashOnHandCents).toBe(20500);
      expect((await (await t.as('dispatcher')).post(`${API}/cash/handovers/${d.body.id}/reject`).send({ reason: 'nope' })).status).toBe(403);
    });

    it('custody overview shows the outstanding shortage; converting it deducts pay and reduces custody', async () => {
      const fin = await t.as('finance');
      const overview = await fin.get(`${API}/cash/custody?q=${encodeURIComponent(hero.code)}`);
      const row = overview.body.data.find((r: any) => r.courierId === hero.id);
      expect(row).toMatchObject({ cashOnHandCents: 20500, outstandingShortageCents: 500, unhandedOrders: 2, unhandedCents: 70000, pendingHandovers: 0 });
      expect(row.oldestUnhandedHours).toBeGreaterThanOrEqual(3.9);
      const payableBefore = await t.app.get(HeroLedgerService).balance(hero.id);
      const s = await fin.post(`${API}/cash/shortages`).send({ courierId: hero.id, reason: 'Shortage on first handover' });
      expect(s.status).toBe(201);
      expect(s.body.adjustment).toMatchObject({ type: 'CASH_SHORTAGE', amountCents: 500, signedAmountCents: -500 });
      expect(s.body.outstandingShortageCents).toBe(0);
      expect((await reloadHero(t, hero.id)).cashOnHandCents).toBe(20000);
      expect(await t.app.get(HeroLedgerService).balance(hero.id)).toBe(payableBefore - 500);
      expect((await fin.post(`${API}/cash/shortages`).send({ courierId: hero.id, reason: 'again' })).body.code).toBe('NO_SHORTAGE');
      expect((await fin.post(`${API}/cash/shortages`).send({ courierId: hero.id, amountCents: 999999, reason: 'too much' })).body.code).toBe('HANDOVER_EXCEEDS_CUSTODY');
    });

    it('hub desk records cash directly; carried-over cash links the remaining orders; custody reaches zero', async () => {
      const hubOp = await t.as('hub');
      const res = await hubOp.post(`${API}/cash/handovers`).send({ courierId: hero.id, amountCents: 20000, method: 'CASH_AT_HUB' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'CONFIRMED', receivedCents: 20000, varianceCents: 0 });
      expect(res.body.linkedOrders.map((o: any) => o.id).sort()).toEqual([ids[1], ids[2]].sort());
      expect((await reloadHero(t, hero.id)).cashOnHandCents).toBe(0);
      const unlinked = await t.db.select({ id: orders.id }).from(orders).where(eq(orders.courierId, hero.id));
      const rows = await Promise.all(unlinked.map((o) => t.db.select({ h: orders.cashHandoverId }).from(orders).where(eq(orders.id, o.id))));
      expect(rows.every(([r]) => r.h)).toBe(true);
      const over = await hubOp.post(`${API}/cash/handovers`).send({ courierId: hero.id, amountCents: 1, method: 'CASH_AT_HUB' });
      expect(over.body.code).toBe('HANDOVER_EXCEEDS_CUSTODY');

      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
      const summary = await hubOp.get(`${API}/cash/hub-summary?date=${day}`);
      expect(summary.status).toBe(200);
      expect(summary.body.hubs.every((h: any) => h.code === 'HUB-NSR')).toBe(true); // hub operator sees own hub only
      expect(summary.body.byMethod.CASH_AT_HUB.receivedCents).toBeGreaterThanOrEqual(99500);
      const list = await (await t.as('finance')).get(`${API}/cash/handovers?courierId=${hero.id}&status=CONFIRMED`);
      expect(list.body.meta.total).toBe(2);
      expect(list.body.totals.receivedCents).toBe(99500);
      await assertBalanced(t);
    });
  });

  describe('XP', () => {
    it('awards delivery + on-time XP exactly once per delivered order, even when the event is replayed', async () => {
      const hero = await createHero(t);
      const brand = await createBrand(t);
      const before = (await reloadHero(t, hero.id)).xp;
      const order = await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 10000, promisedBy: new Date(Date.now() + 3_600_000) });
      emitStatus(t, order, 'DELIVERED');
      emitStatus(t, order, 'DELIVERED');
      const expected = before + XP_RULES.delivered + XP_RULES.deliveredOnTime;
      await eventually(async () => (await reloadHero(t, hero.id)).xp === expected);
      emitStatus(t, order, 'DELIVERED');
      await t.app.get(GamificationService).onOrderDelivered(order.id);
      await sleep(200);
      expect((await reloadHero(t, hero.id)).xp).toBe(expected);

      const late = await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 0, promisedBy: new Date(Date.now() - 3_600_000) });
      emitStatus(t, late, 'DELIVERED');
      await eventually(async () => (await reloadHero(t, hero.id)).xp === expected + XP_RULES.delivered);

      const failed = await failAttempt(t, { brandId: brand.id, courierId: hero.id, codCents: 5000 });
      emitStatus(t, failed, 'FAILED_ATTEMPT');
      emitStatus(t, failed, 'FAILED_ATTEMPT');
      await eventually(async () => (await reloadHero(t, hero.id)).xp === expected + XP_RULES.delivered + XP_RULES.failedAttempt);

      // Ignored: an event that does not match the facts (order is not delivered).
      emitStatus(t, failed, 'DELIVERED');
      t.app.get(EventEmitter2).emit(DomainEvents.PickupCompleted, { pickupId: 'missing', brandId: brand.id, courierId: hero.id, pickedCount: 3 } satisfies PickupCompletedEvent);
      await sleep(200);
      const xp = (await reloadHero(t, hero.id)).xp;
      expect(xp).toBe(expected + XP_RULES.delivered + XP_RULES.failedAttempt);

      const ach = await (await loginWith(t, hero.phone)).get(`${API}/hero/me/achievements`);
      expect(ach.status).toBe(200);
      expect(ach.body.xpBreakdown.delivered).toEqual({ count: 2, xp: 2 * XP_RULES.delivered + XP_RULES.deliveredOnTime });
      expect(ach.body.badges.find((b: any) => b.key === 'first_delivery').earned).toBe(true);
      expect(ach.body.badges.find((b: any) => b.key === 'century')).toMatchObject({ earned: false, current: 2, target: 100 });
      expect(ach.body.level.level).toBeGreaterThanOrEqual(1);
    });

    it('same-day cash handover bonus and the daily streak job are exactly-once', async () => {
      const hero = await createHero(t);
      const brand = await createBrand(t);
      await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 15000, deliveredAt: new Date(Date.now() - 60_000) });
      const start = (await reloadHero(t, hero.id)).xp;
      const res = await (await t.as('finance')).post(`${API}/cash/handovers`).send({ courierId: hero.id, amountCents: 15000, method: 'CASH_AT_HUB' });
      expect(res.body.linkedOrders).toHaveLength(1);
      await eventually(async () => (await reloadHero(t, hero.id)).xp === start + XP_RULES.cashHandoverSameDay);
      await t.app.get(GamificationService).onHandoverConfirmed(res.body.id);
      expect((await reloadHero(t, hero.id)).xp).toBe(start + XP_RULES.cashHandoverSameDay);

      // Streak: yesterday had a delivery and the hero was on a 3-day streak.
      await t.db.update(couriers).set({ streakDays: 3 }).where(eq(couriers.id, hero.id));
      const yesterdayNoon = cairoDateTime(addDays(cairoToday(), -1), '12:00');
      await deliverOrder(t, { brandId: brand.id, courierId: hero.id, codCents: 0, deliveredAt: yesterdayNoon });
      const g = t.app.get(GamificationService);
      await g.runStreaks();
      await g.runStreaks();
      const after = await reloadHero(t, hero.id);
      expect(after.streakDays).toBe(4);
      expect(after.xp).toBe(start + XP_RULES.cashHandoverSameDay + XP_RULES.dailyStreak);
    });
  });
});
