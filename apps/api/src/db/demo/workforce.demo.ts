/* eslint-disable no-console */
import type { INestApplicationContext } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { ROLE_PERMISSIONS, type UserRole } from '@goturtle/shared';
import type { Db } from '../client';
import { brands, couriers, hubs, orders, shiftTemplates, shifts, users } from '../schema';
import { DB } from '../../core/database.module';
import { cairoToday } from '../helpers';
import type { Principal } from '../../common/principal';
import { ShiftsService } from '../../modules/shifts/shifts.service';
import { CourierLocationsService, type LocationPoint } from '../../modules/couriers/courier-locations.service';
import { CashService } from '../../modules/cash/cash.service';
import { AdjustmentsService } from '../../modules/finance/adjustments.service';
import { SettlementsService } from '../../modules/finance/settlements.service';
import { PayrollService } from '../../modules/finance/payroll.service';
import { addDays, weekStartOf } from '../../modules/couriers/workforce.util';

const META = { ip: '127.0.0.1', userAgent: 'workforce-demo' };
const MIN = 60_000;

/** Deterministic pseudo-random numbers so the demo looks the same on every machine. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function staffPrincipal(db: Db, phone: string, role: UserRole): Promise<Principal> {
  const [u] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (!u) throw new Error(`demo staff ${phone} missing — run the base seed first`);
  return { kind: 'user', userId: u.id, name: u.name, role, actorType: 'STAFF', brandId: null, courierId: null, hubId: u.hubId, permissions: ROLE_PERMISSIONS[role] };
}

/**
 * Demo data for the workforce modules (runs after the operations demo, works
 * without any orders). Idempotent: skipped when the demo shift templates exist.
 * Everything goes through the real services so the ledger stays consistent.
 */
export async function seedWorkforceDemo(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const shiftsService = app.get(ShiftsService);
  const locations = app.get(CourierLocationsService);
  const cash = app.get(CashService);
  const adjustments = app.get(AdjustmentsService);
  const settlementsService = app.get(SettlementsService);
  const payroll = app.get(PayrollService);

  const [nsr] = await db.select().from(hubs).where(eq(hubs.code, 'HUB-NSR')).limit(1);
  const [mad] = await db.select().from(hubs).where(eq(hubs.code, 'HUB-MAD')).limit(1);
  if (!nsr || !mad) {
    console.log('• workforce demo: base network missing — skipped');
    return;
  }
  const [existing] = await db.select({ id: shiftTemplates.id }).from(shiftTemplates).where(and(eq(shiftTemplates.name, 'Morning'), eq(shiftTemplates.hubId, nsr.id))).limit(1);
  if (existing) {
    console.log('• workforce demo already seeded — skipping');
    return;
  }

  const ops = await staffPrincipal(db, '+201000000001', 'OPS_MANAGER');
  const finance = await staffPrincipal(db, '+201000000004', 'FINANCE');
  const heroes = new Map((await db.select().from(couriers).where(sql`${couriers.code} like 'HR-%'`)).map((c) => [c.code, c]));
  const hero = (code: string) => heroes.get(code);
  const random = rng(20261030);
  const now = new Date();
  const today = cairoToday(now);

  // 1. Templates (Cairo wall clock, every day).
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  const templates: Record<string, string> = {};
  for (const [hub, label] of [[nsr, 'NSR'], [mad, 'MAD']] as const) {
    for (const [name, startTime, endTime] of [['Morning', '09:00', '17:00'], ['Evening', '15:00', '23:00']] as const) {
      const t = await shiftsService.createTemplate({ name, startTime, endTime, daysOfWeek: allDays, hubId: hub.id, requiredCouriers: 2, breakMinutes: 30 }, ops, META);
      templates[`${label}-${name}`] = t.id;
    }
  }

  // 2. Today's live shift for one SHIFT hero, then this week's bookings (overlaps are skipped).
  const weekFrom = weekStartOf(today);
  const weekTo = addDays(weekFrom, 6);
  const live = hero('HR-00003');
  let liveShiftId: string | null = null;
  if (live) {
    const s = await shiftsService.create({ courierId: live.id, hubId: nsr.id, startAt: new Date(now.getTime() - 2 * 60 * MIN).toISOString(), endAt: new Date(now.getTime() + 6 * 60 * MIN).toISOString(), breakMinutes: 30, notes: 'Demo live shift' }, ops, META);
    liveShiftId = s.id;
  }
  const bookings: Array<[string, string]> = [['HR-00003', 'NSR-Morning'], ['HR-00004', 'MAD-Morning'], ['HR-00008', 'MAD-Evening']];
  let booked = 0;
  for (const [code, template] of bookings) {
    const h = hero(code);
    if (!h) continue;
    const r = await shiftsService.generate({ templateId: templates[template], from: weekFrom, to: weekTo, courierIds: [h.id] }, ops, META);
    booked += r.created;
  }

  // 3. Attendance for past shifts (one no-show is left for the MISSED job), then the live clock-in.
  const past = await db
    .select()
    .from(shifts)
    .where(and(inArray(shifts.status, ['SCHEDULED', 'CONFIRMED']), sql`${shifts.endAt} < ${now}`, isNotNull(shifts.templateId)))
    .orderBy(asc(shifts.startAt));
  let completed = 0;
  let noShowLeft = false;
  for (const s of past) {
    if (!noShowLeft && s.courierId === hero('HR-00008')?.id) {
      noShowLeft = true;
      continue;
    }
    const lateBy = Math.round(random() * 20) - 5; // −5 … +15 minutes
    const outBy = Math.round(random() * 40) - 10;
    await shiftsService.clockIn(s.id, { at: new Date(s.startAt.getTime() + lateBy * MIN), lat: nsr.lat, lng: nsr.lng });
    await shiftsService.clockOut(s.id, { at: new Date(s.endAt.getTime() + outBy * MIN), lat: nsr.lat, lng: nsr.lng });
    completed++;
  }
  if (liveShiftId) await shiftsService.clockIn(liveShiftId, { at: new Date(now.getTime() - 2 * 60 * MIN + 7 * MIN), lat: nsr.lat + 0.001, lng: nsr.lng + 0.001 });
  await shiftsService.runAttendance(now);

  // 4. Today's breadcrumbs for heroes on the road (every 2 min over the last 2 hours).
  const roadCodes = ['HR-00001', 'HR-00002', 'HR-00003', 'HR-00005', 'HR-00007'];
  const hubById = new Map((await db.select().from(hubs)).map((h) => [h.id, h]));
  let points = 0;
  for (const code of roadCodes) {
    const h = hero(code);
    if (!h || h.status !== 'ACTIVE') continue;
    const home = (h.homeHubId && hubById.get(h.homeHubId)) || nsr;
    let lat = home.lat;
    let lng = home.lng;
    const batch: LocationPoint[] = [];
    for (let i = 60; i >= 0; i--) {
      lat += (random() - 0.5) * 0.004;
      lng += (random() - 0.5) * 0.004;
      batch.push({ lat, lng, accuracy: 5 + Math.round(random() * 25), speed: Math.round(random() * 12 * 10) / 10, heading: Math.round(random() * 359), battery: 90 - Math.round((60 - i) / 3), recordedAt: new Date(now.getTime() - i * 2 * MIN) });
    }
    for (let i = 0; i < batch.length; i += 20) points += (await locations.ingest(h.id, batch.slice(i, i + 20), now)).stored;
    if (code !== 'HR-00003') await db.update(couriers).set({ availability: code === 'HR-00007' ? 'ON_BREAK' : 'ONLINE' }).where(eq(couriers.id, h.id));
  }

  // 5. Cash handovers for heroes holding COD (from the operations demo): confirmed (one short) and one pending.
  const holders = await db.select().from(couriers).where(gt(couriers.cashOnHandCents, 0)).orderBy(desc(couriers.cashOnHandCents)).limit(4);
  let confirmed = 0;
  let pending = 0;
  for (const [i, h] of holders.entries()) {
    const amount = i === 3 ? Math.round(h.cashOnHandCents / 2) : h.cashOnHandCents;
    if (amount <= 0) continue;
    const method = i === 1 ? 'INSTAPAY' : 'CASH_AT_HUB';
    const declared = await cash.declare(h.id, { amountCents: amount, method, reference: method === 'INSTAPAY' ? `IPN${100200 + i}` : undefined, hubId: method === 'CASH_AT_HUB' ? h.homeHubId ?? nsr.id : undefined });
    if (i === 3) {
      pending++;
      continue;
    }
    const shortage = i === 2 ? Math.min(2000, amount - 1) : 0; // 20 EGP short on one handover
    await cash.confirm(declared.id, { receivedCents: amount - shortage, notes: shortage ? 'Counted at the desk — 20 EGP short' : undefined }, finance, META);
    confirmed++;
  }

  // 6. A bonus and a penalty.
  const star = hero('HR-00001');
  const late = hero('HR-00005');
  if (star) await adjustments.create({ courierId: star.id, type: 'BONUS', amountCents: 10000, reason: 'Top hero of the week — 100% success rate' }, finance, META);
  if (late) await adjustments.create({ courierId: late.id, type: 'PENALTY', amountCents: 2500, reason: 'Late return of undelivered parcels to the hub' }, finance, META);

  // 7. Brand settlements: one PAID (older half of a brand's orders) and DRAFTs for everything else.
  let paidSettlement: string | null = null;
  const [firstBrand] = await db
    .select({ brandId: orders.brandId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(orders)
    .innerJoin(brands, eq(brands.id, orders.brandId))
    .where(and(inArray(orders.status, ['DELIVERED', 'RETURNED']), isNull(orders.settlementId)))
    .groupBy(orders.brandId)
    .orderBy(desc(sql`count(*)`))
    .limit(1);
  if (firstBrand && firstBrand.n >= 2) {
    const finals = await db
      .select({ at: sql<Date>`coalesce(${orders.deliveredAt}, ${orders.returnedAt}, ${orders.updatedAt})`.mapWith((v) => new Date(v)) })
      .from(orders)
      .where(and(eq(orders.brandId, firstBrand.brandId), inArray(orders.status, ['DELIVERED', 'RETURNED']), isNull(orders.settlementId)))
      .orderBy(asc(sql`coalesce(${orders.deliveredAt}, ${orders.returnedAt}, ${orders.updatedAt})`));
    const cut = finals[Math.floor(finals.length / 2) - 1]?.at;
    if (cut) {
      const r = await settlementsService.generate({ brandId: firstBrand.brandId, periodEnd: new Date(cut.getTime() + 1) }, finance, META);
      const s = r.created[0];
      if (s) {
        await settlementsService.approve(s.id, finance, META);
        await settlementsService.pay(s.id, { paymentReference: `DEMO-${s.code}` }, finance, META);
        paidSettlement = s.code;
      }
    }
  }
  const drafts = await settlementsService.generate({}, finance, META);

  // 8. This week's DRAFT payroll (with the prorated salary of full-time heroes).
  const payrollFrom = addDays(today, -6);
  const payouts = await payroll.generate({ periodStart: payrollFrom, periodEnd: today, includeSalary: true }, finance, META);

  console.log(
    `✔ workforce demo: 4 shift templates, ${booked + (liveShiftId ? 1 : 0)} shifts (${completed} completed, 1 live), ${points} GPS points, ` +
      `${confirmed} confirmed + ${pending} pending handovers, 2 adjustments, ${drafts.created.length} draft settlements` +
      `${paidSettlement ? ` + ${paidSettlement} paid` : ''}, ${payouts.created.length} draft payouts`,
  );
}
