/* eslint-disable no-console */
import type { INestApplicationContext } from '@nestjs/common';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { ROLE_PERMISSIONS, type FailureReason, type ServiceLevel } from '@goturtle/shared';
import type { Db } from '../client';
import { brandLocations, brands, callLogs, courierZones, couriers, ledgerEntries, ledgerTransactions, orderEvents, orders, users, zones } from '../schema';
import { DB } from '../../core/database.module';
import { cairoDateTime, cairoToday } from '../helpers';
import type { ActorContext } from '../../common/actor';
import type { Principal } from '../../common/principal';
import { OrdersService } from '../../modules/orders/orders.service';
import { OrderWorkflowService } from '../../modules/orders/order-workflow.service';
import { RunsheetsService } from '../../modules/dispatch/runsheets.service';
import { PickupsService } from '../../modules/pickups/pickups.service';

/**
 * ~3 weeks of realistic Cairo activity, created THROUGH the real services
 * (OrdersService + OrderWorkflowService + runsheets + pickups) so the ledger,
 * timelines, customer stats and hero earnings are all consistent. Timestamps
 * are back-filled with the workflow's `at` option, then ledger rows are moved
 * to the moment the money actually moved. Idempotent: skips if orders exist.
 */

// Deterministic pseudo-random generator so every fresh demo looks the same.
let seed = 20261031;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;

const FIRST = ['Ahmed', 'Mohamed', 'Mahmoud', 'Omar', 'Youssef', 'Karim', 'Mostafa', 'Hassan', 'Ali', 'Amr', 'Tarek', 'Khaled', 'Nour', 'Mariam', 'Salma', 'Yasmin', 'Farida', 'Hana', 'Laila', 'Aya', 'Dina', 'Rana', 'Habiba', 'Nada', 'Mona', 'Sara', 'Malak', 'Jana'];
const FIRST_AR = ['أحمد', 'محمد', 'محمود', 'عمر', 'يوسف', 'كريم', 'مصطفى', 'حسن', 'علي', 'عمرو', 'طارق', 'خالد', 'نور', 'مريم', 'سلمى', 'ياسمين', 'فريدة', 'هنا', 'ليلى', 'آية', 'دينا', 'رنا', 'حبيبة', 'ندى', 'منى', 'سارة', 'ملك', 'جنى'];
const LAST = ['Hassan', 'Ibrahim', 'Mahmoud', 'El Sayed', 'Abdelrahman', 'Fathy', 'Nabil', 'Saleh', 'Gaber', 'Shaker', 'Mansour', 'Ezzat', 'Fouad', 'Hamdy', 'Kamal', 'Samir'];
const LAST_AR = ['حسن', 'إبراهيم', 'محمود', 'السيد', 'عبد الرحمن', 'فتحي', 'نبيل', 'صالح', 'جابر', 'شاكر', 'منصور', 'عزت', 'فؤاد', 'حمدي', 'كمال', 'سمير'];
const STREETS_AR = ['شارع التسعين', 'شارع النصر', 'شارع الثورة', 'شارع جامعة الدول العربية', 'شارع مصطفى النحاس', 'شارع عباس العقاد', 'شارع الهرم', 'شارع فيصل', 'شارع ٩', 'شارع الميرغني', 'شارع البطل أحمد عبد العزيز', 'شارع شهاب'];
const STREETS_EN = ['Street 90', 'El Nasr Rd', 'El Thawra St', 'Gameat El Dowal St', 'Mostafa El Nahas St', 'Abbas El Akkad St', 'Haram St', 'Faisal St', 'Road 9', 'El Merghany St', 'Batal Ahmed Abdelaziz St', 'Shehab St'];
const LANDMARKS = ['بجوار مسجد', 'أمام صيدلية', 'خلف المول', 'بجوار البنك الأهلي', 'Near Carrefour', 'Opposite the school', 'Next to Vodafone store', null, null];
const PRODUCTS: Record<string, string[]> = {
  NILE: ['Linen shirt', 'Cotton dress', 'Denim jacket', 'Abaya', 'Kids t-shirts ×3', 'Summer set'],
  CGAD: ['Wireless earbuds', 'Phone case + charger', 'Smart watch', 'Power bank 20,000mAh', 'Gaming mouse', 'Bluetooth speaker'],
  BLOOM: ['Skincare set', 'Perfume 100ml', 'Hair care bundle', 'Makeup kit', 'Sunscreen ×2', 'Lipstick collection'],
};
const FAILURES: FailureReason[] = ['CUSTOMER_UNREACHABLE', 'CUSTOMER_UNREACHABLE', 'CUSTOMER_RESCHEDULED', 'CUSTOMER_NOT_PRESENT', 'NO_CASH', 'WRONG_ADDRESS', 'INCOMPLETE_ADDRESS'];

const phone = () => `+20${pick(['10', '11', '12', '15'])}${String(between(0, 99_999_999)).padStart(8, '0')}`;
const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
const minDate = (a: Date, b: Date) => (a < b ? a : b);
const dayOffset = (offset: number) => cairoToday(new Date(Date.now() - offset * 86_400_000));

interface DemoCustomer {
  name: string;
  phone: string;
  refuser: boolean;
}

export async function seedOperationsDemo(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const [{ n }] = await db.select({ n: count() }).from(orders);
  if (Number(n) > 0) {
    console.log('• orders already exist — skipping operations demo');
    return;
  }

  const ordersSvc = app.get(OrdersService, { strict: false });
  const workflow = app.get(OrderWorkflowService, { strict: false });
  const runsheets = app.get(RunsheetsService, { strict: false });
  const pickups = app.get(PickupsService, { strict: false });

  const brandRows = await db.select().from(brands).where(eq(brands.status, 'ACTIVE'));
  if (!brandRows.length) return;
  const owners = await db.select().from(users).where(and(eq(users.role, 'BRAND_OWNER'), inArray(users.brandId, brandRows.map((b) => b.id))));
  const locations = await db.select().from(brandLocations).where(eq(brandLocations.isDefault, true));
  const zoneRows = await db.select().from(zones).where(eq(zones.isActive, true));
  const heroRows = await db.select().from(couriers).where(eq(couriers.status, 'ACTIVE'));
  const coverage = await db.select().from(courierZones);
  const [opsUser] = await db.select().from(users).where(eq(users.role, 'OPS_MANAGER')).limit(1);
  const [superUser] = await db.select().from(users).where(eq(users.role, 'SUPER_ADMIN')).limit(1);
  const staffUser = opsUser ?? superUser;
  if (!staffUser || !heroRows.length || !zoneRows.length) return;

  const staff: ActorContext = { actorType: 'STAFF', actorId: staffUser.id, name: staffUser.name };
  const staffPrincipal: Principal = {
    kind: 'user', userId: staffUser.id, name: staffUser.name, role: staffUser.role, actorType: 'STAFF',
    brandId: null, courierId: null, hubId: null, permissions: ROLE_PERMISSIONS[staffUser.role],
  };
  const meta = { ip: null, userAgent: 'demo-seed' };
  const heroUsers = new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, heroRows.map((h) => h.userId)))).map((u) => [u.id, u.name]));
  const heroActor = (courierId: string): ActorContext => {
    const h = heroRows.find((x) => x.id === courierId)!;
    return { actorType: 'COURIER', actorId: h.userId, name: heroUsers.get(h.userId) ?? h.code, courierId };
  };
  const brandActor = (brandId: string): ActorContext => {
    const o = owners.find((u) => u.brandId === brandId);
    return { actorType: 'BRAND', actorId: o?.id ?? null, name: o?.name ?? 'Brand', brandId };
  };

  // Zones a hero covers → the heroes for each zone (primary heroes first).
  const heroesByZone = new Map<string, string[]>();
  for (const c of [...coverage].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))) {
    if (!heroRows.some((h) => h.id === c.courierId)) continue;
    heroesByZone.set(c.zoneId, [...(heroesByZone.get(c.zoneId) ?? []), c.courierId]);
  }
  const servedZones = zoneRows.filter((z) => heroesByZone.has(z.id));
  // Core Cairo gets more volume than the outskirts.
  const weightedZones = servedZones.flatMap((z) => Array(z.tier === 'A' ? 4 : z.tier === 'B' ? 2 : 1).fill(z) as typeof servedZones);

  const customers: DemoCustomer[] = Array.from({ length: 140 }, (_, i) => {
    const ar = chance(0.55);
    const fi = between(0, FIRST.length - 1);
    const li = between(0, LAST.length - 1);
    return { name: ar ? `${FIRST_AR[fi]} ${LAST_AR[li]}` : `${FIRST[fi]} ${LAST[li]}`, phone: phone(), refuser: i % 23 === 0 };
  });

  const stats = { created: 0, delivered: 0, returned: 0, cancelled: 0, failed: 0, open: 0, outForDelivery: 0, errors: 0 };
  const todayStr = cairoToday();
  const now = new Date();

  async function createOrder(dayAgo: number, createdAt: Date) {
    const brand = pick(brandRows);
    const loc = locations.find((l) => l.brandId === brand.id);
    const zone = pick(weightedZones);
    const customer = pick(customers);
    const isCod = chance(0.86);
    const codEgp = pick([150, 220, 299, 350, 420, 499, 650, 780, 899, 1200, 1450, 1899, 2400, 3200, 4500]);
    const ar = /[؀-ۿ]/.test(customer.name);
    const street = between(0, STREETS_AR.length - 1);
    const service: ServiceLevel = chance(0.12) ? 'SAME_DAY' : chance(0.05) ? 'EXPRESS' : 'STANDARD';
    const ref = await ordersSvc.create(
      {
        brandId: brand.id,
        brandReference: `${brand.code}-${String(10000 + stats.created).slice(1)}`,
        source: chance(0.25) ? 'API' : chance(0.15) ? 'BULK_UPLOAD' : 'PORTAL',
        type: chance(0.04) ? 'EXCHANGE' : 'DELIVERY',
        serviceLevel: service,
        recipient: { name: customer.name, phone: customer.phone },
        address: {
          line: ar ? `${between(1, 180)} ${STREETS_AR[street]}، ${zone.nameAr}` : `${between(1, 180)} ${STREETS_EN[street]}, ${zone.nameEn}`,
          building: String(between(1, 60)),
          floor: String(between(0, 12)),
          apartment: String(between(1, 30)),
          landmark: pick(LANDMARKS),
          zoneId: zone.id,
          lat: zone.centerLat + (rand() - 0.5) * 0.03,
          lng: zone.centerLng + (rand() - 0.5) * 0.03,
        },
        package: {
          description: pick(PRODUCTS[brand.code] ?? ['Parcel']),
          itemsCount: between(1, 3),
          weightGrams: between(300, 4500),
          allowOpening: brand.allowOpenPackage,
          isFragile: brand.code === 'BLOOM' && chance(0.4),
        },
        paymentMethod: isCod ? 'COD' : 'PREPAID',
        codAmountCents: isCod ? codEgp * 100 : 0,
        feesPaidBy: chance(0.15) ? 'RECIPIENT' : 'BRAND',
        pickupLocationId: loc?.id ?? null,
        deliveryOtpRequired: isCod && codEgp >= 3000,
        notes: chance(0.2) ? pick(['اتصل قبل الوصول بنص ساعة', 'Call before arriving', 'Leave with the doorman', 'لا يوجد أسانسير']) : null,
      },
      brandActor(brand.id),
    );
    stats.created++;
    await db.update(orders).set({ createdAt }).where(eq(orders.id, ref.id));
    await db.update(orderEvents).set({ createdAt }).where(and(eq(orderEvents.orderId, ref.id), eq(orderEvents.status, 'CREATED')));
    void dayAgo;
    return { ref, brand, zone, customer, heroId: pick(heroesByZone.get(zone.id)!) };
  }

  /** Pickup → hub → out for delivery (and optionally the outcome). */
  async function firstMile(id: string, heroId: string, hubId: string | null, created: Date) {
    const pickedAt = addHours(created, between(1, 4));
    await workflow.transition(id, 'PICKED_UP', heroActor(heroId), { courierId: heroId, at: pickedAt });
    await workflow.transition(id, 'RECEIVED_AT_HUB', staff, { hubId, at: addHours(pickedAt, between(1, 3)) });
    return pickedAt;
  }

  // ------------------------------------------------------------------ history
  for (let dayAgo = 20; dayAgo >= 1; dayAgo--) {
    const day = dayOffset(dayAgo);
    const perDay = between(9, 17) + (dayAgo % 7 === 4 ? -5 : 0); // Fridays are quieter
    for (let i = 0; i < perDay; i++) {
      const created = cairoDateTime(day, `${String(between(8, 21)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}`);
      try {
        const o = await createOrder(dayAgo, created);
        const roll = rand();
        if (roll < 0.04) {
          await workflow.transition(o.ref.id, 'CANCELLED', brandActor(o.brand.id), { reason: 'BRAND_REQUEST', note: 'Customer cancelled before pickup', at: addHours(created, 1) });
          stats.cancelled++;
          continue;
        }
        const hubId = o.zone.hubId;
        const pickedAt = await firstMile(o.ref.id, o.heroId, hubId, created);
        const hero = heroActor(o.heroId);
        let outAt = minDate(cairoDateTime(dayOffset(Math.max(dayAgo - 1, 0)), `${String(between(9, 12)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}`), addHours(now, -2));
        if (outAt < pickedAt) outAt = addHours(pickedAt, 3);
        await workflow.transition(o.ref.id, 'ASSIGNED', staff, { courierId: o.heroId, at: addHours(outAt, -0.5) });
        await workflow.transition(o.ref.id, 'OUT_FOR_DELIVERY', hero, { at: outAt });

        const refused = o.customer.refuser || roll > 0.93;
        const failFirst = !refused && roll > 0.82;
        if (refused) {
          await workflow.transition(o.ref.id, 'FAILED_ATTEMPT', hero, { at: addHours(outAt, 2), note: 'رفض الاستلام', failure: { reason: 'CUSTOMER_REFUSED' } });
          // The workflow auto-moves refused parcels to RETURN_PENDING; take it back to the brand.
          const after = addHours(outAt, 26);
          if (after < now) {
            await workflow.transition(o.ref.id, 'RETURN_OUT', hero, { courierId: o.heroId, at: after });
            await workflow.transition(o.ref.id, 'RETURNED', hero, { at: addHours(after, 3), note: 'Returned to the brand', delivery: { receivedBy: 'Store manager' } });
            stats.returned++;
          } else stats.open++;
          continue;
        }
        let deliverAt = addHours(outAt, rand() * 5 + 0.5);
        if (failFirst) {
          await workflow.transition(o.ref.id, 'FAILED_ATTEMPT', hero, { at: addHours(outAt, 1.5), failure: { reason: pick(FAILURES) } });
          stats.failed++;
          const retry = addHours(outAt, 24);
          if (retry > now) {
            stats.open++;
            continue;
          }
          await workflow.transition(o.ref.id, 'OUT_FOR_DELIVERY', hero, { at: retry });
          deliverAt = addHours(retry, rand() * 4 + 0.5);
        }
        if (deliverAt > now) deliverAt = addHours(now, -0.25);
        const row = (await db.select({ collectCents: orders.collectCents }).from(orders).where(eq(orders.id, o.ref.id)))[0];
        await workflow.transition(o.ref.id, 'DELIVERED', hero, {
          at: deliverAt,
          delivery: { collectedCents: row.collectCents, receivedBy: o.customer.name },
          lat: o.zone.centerLat, lng: o.zone.centerLng,
        });
        if (chance(0.55)) {
          await db.update(orders).set({ rating: pick([5, 5, 5, 5, 4, 4, 3]), ratingComment: pick([null, 'Very polite hero', 'سريع جداً', 'On time 👌', null]) }).where(eq(orders.id, o.ref.id));
        }
        stats.delivered++;
      } catch (err) {
        stats.errors++;
        if (stats.errors <= 3) console.warn('  demo order skipped:', (err as Error).message);
      }
    }
  }

  // -------------------------------------------------------------------- today
  const todayRunsheetOrders = new Map<string, string[]>();
  for (let i = 0; i < 46; i++) {
    const created = minDate(cairoDateTime(todayStr, `${String(between(7, 13)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}`), addHours(now, -0.5));
    try {
      const o = await createOrder(0, created);
      const bucket = i % 5;
      if (bucket === 0) {
        stats.open++; // stays CREATED → attached to today's pickup request below
        continue;
      }
      await firstMile(o.ref.id, o.heroId, o.zone.hubId, addHours(created, -0.5));
      if (bucket === 1) {
        stats.open++; // waiting at the hub for dispatch
        continue;
      }
      todayRunsheetOrders.set(o.heroId, [...(todayRunsheetOrders.get(o.heroId) ?? []), o.ref.id]);
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 3) console.warn('  demo order skipped:', (err as Error).message);
    }
  }

  // Today's runsheets: optimise, dispatch, and let heroes finish part of the route.
  for (const [heroId, ids] of todayRunsheetOrders) {
    try {
      const rs = await runsheets.create({ courierId: heroId, date: todayStr, orderIds: ids }, staff, meta);
      const runsheetId = (rs as { id: string }).id;
      await runsheets.optimize(runsheetId, staff);
      await runsheets.dispatch(runsheetId, { override: true, canOverride: true }, staff, meta);
      const ordered = await db.select({ id: orders.id, collectCents: orders.collectCents, seq: orders.routeSequence, lat: orders.lat, lng: orders.lng }).from(orders).where(eq(orders.runsheetId, runsheetId));
      ordered.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      const doneCount = Math.floor(ordered.length * 0.5);
      for (const [idx, o] of ordered.entries()) {
        if (idx >= doneCount) {
          stats.outForDelivery++;
          continue;
        }
        if (idx === 1 && chance(0.5)) {
          // Delivery integrity: "unreachable" needs logged calls (spaced a few minutes apart) before it is accepted.
          await db.insert(callLogs).values([12, 6].map((m) => ({ orderId: o.id, courierId: heroId, provider: 'direct', status: 'NO_ANSWER' as const, startedAt: addHours(now, -m / 60), endedAt: addHours(now, -m / 60) })));
          await workflow.transition(o.id, 'FAILED_ATTEMPT', heroActor(heroId), { failure: { reason: 'CUSTOMER_UNREACHABLE' }, lat: o.lat, lng: o.lng });
          stats.failed++;
          continue;
        }
        await workflow.transition(o.id, 'DELIVERED', heroActor(heroId), { delivery: { collectedCents: o.collectCents }, lat: o.lat, lng: o.lng });
        stats.delivered++;
      }
      await runsheets.heroStart(runsheetId, heroActor(heroId)).catch(() => undefined);
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 3) console.warn('  demo runsheet skipped:', (err as Error).message);
    }
  }

  // Today's pickup requests for the brands' new orders.
  for (const brand of brandRows) {
    const owner = owners.find((u) => u.brandId === brand.id);
    if (!owner) continue;
    const brandPrincipal: Principal = {
      kind: 'user', userId: owner.id, name: owner.name, role: owner.role, actorType: 'BRAND', brandId: brand.id,
      courierId: null, hubId: null, permissions: ROLE_PERMISSIONS[owner.role],
    };
    try {
      const p = (await pickups.request({ scheduledDate: todayStr, timeWindow: '14:00-18:00', expectedCount: between(5, 15), notes: 'Ask for the warehouse supervisor' }, brandPrincipal, meta)) as { id: string };
      const loc = locations.find((l) => l.brandId === brand.id);
      const zoneHeroes = loc ? heroesByZone.get(loc.zoneId) : undefined;
      if (zoneHeroes?.length && chance(0.7)) await pickups.assign(p.id, zoneHeroes[0], staffPrincipal, meta);
    } catch (err) {
      if (stats.errors++ <= 3) console.warn('  demo pickup skipped:', (err as Error).message);
    }
  }

  // Move ledger rows to the moment money actually moved (delivery / return time).
  await db.execute(sql`
    update ${ledgerTransactions} lt
    join ${orders} o on o.id = lt.orderId
    set lt.createdAt = coalesce(o.deliveredAt, o.returnedAt, o.cancelledAt, lt.createdAt)
    where lt.orderId is not null`);
  await db.execute(sql`
    update ${ledgerEntries} le
    join ${ledgerTransactions} lt on lt.id = le.transactionId
    set le.createdAt = lt.createdAt`);

  // Heroes online near their zones for the control tower.
  for (const h of heroRows) {
    const zoneId = coverage.find((c) => c.courierId === h.id && c.isPrimary)?.zoneId;
    const z = zoneRows.find((x) => x.id === zoneId);
    if (!z) continue;
    await db.update(couriers).set({
      availability: todayRunsheetOrders.has(h.id) ? 'BUSY' : chance(0.6) ? 'ONLINE' : 'OFFLINE',
      lastLat: z.centerLat + (rand() - 0.5) * 0.02,
      lastLng: z.centerLng + (rand() - 0.5) * 0.02,
      lastSeenAt: addHours(now, -rand() * 0.2),
    }).where(eq(couriers.id, h.id));
  }

  console.log(
    `✔ operations demo: ${stats.created} orders (${stats.delivered} delivered, ${stats.returned} returned, ${stats.cancelled} cancelled, ` +
      `${stats.failed} failed attempts, ${stats.outForDelivery} out for delivery now, ${stats.open} open), ${todayRunsheetOrders.size} runsheets today` +
      (stats.errors ? `, ${stats.errors} skipped` : ''),
  );
}
