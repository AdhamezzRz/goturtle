import type { INestApplicationContext } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { ROLE_PERMISSIONS } from '@goturtle/shared';
import type { Db } from '../../client';
import {
  brands, cashHandovers, courierZones, couriers, deliveryAttempts, hubs, ledgerEntries, ledgerTransactions, orderEvents, orders, users, zones,
} from '../../schema';
import { DB } from '../../../core/database.module';
import type { ActorContext } from '../../../common/actor';
import type { Principal } from '../../../common/principal';

/** Deterministic pseudo-random numbers so every fresh demo looks the same. */
export function rng(seed: number) {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return {
    rand,
    pick: <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)],
    between: (min: number, max: number) => min + Math.floor(rand() * (max - min + 1)),
    chance: (p: number) => rand() < p,
  };
}

export const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
export const META = { ip: null, userAgent: 'demo-seed' };

type BrandRow = typeof brands.$inferSelect;
type UserRow = typeof users.$inferSelect;
type ZoneRow = typeof zones.$inferSelect;
export type CourierRow = typeof couriers.$inferSelect;

export interface DemoBrand {
  brand: BrandRow;
  owner: UserRow;
  actor: ActorContext;
  principal: Principal;
}

export interface IntakeCtx {
  app: INestApplicationContext;
  db: Db;
  staff: ActorContext;
  staffPrincipal: Principal;
  brands: Map<string, DemoBrand>; // by brand code
  zones: Map<string, ZoneRow>; // by zone code
  hubs: Map<string, typeof hubs.$inferSelect>; // by hub code
  /** Active heroes per zone id, without hero 01200000001 (today's demo runsheet must stay untouched). */
  heroesByZone: Map<string, CourierRow[]>;
  heroActor: (c: CourierRow) => ActorContext;
  now: Date;
}

const HERO_ONE = '+201200000001';

export async function loadContext(app: INestApplicationContext): Promise<IntakeCtx | null> {
  const db = app.get<Db>(DB);
  const staffUsers = [
    ...(await db.select().from(users).where(and(eq(users.role, 'OPS_MANAGER'), eq(users.status, 'ACTIVE'))).limit(1)),
    ...(await db.select().from(users).where(eq(users.role, 'SUPER_ADMIN')).limit(1)),
  ];
  const staffUser = staffUsers[0];
  if (!staffUser) return null;
  const brandRows = await db.select().from(brands).where(eq(brands.status, 'ACTIVE'));
  if (!brandRows.length) return null;
  const owners = await db.select().from(users).where(and(eq(users.role, 'BRAND_OWNER'), inArray(users.brandId, brandRows.map((b) => b.id))));
  const brandMap = new Map<string, DemoBrand>();
  for (const b of brandRows) {
    const owner = owners.find((o) => o.brandId === b.id);
    if (!owner) continue;
    brandMap.set(b.code, {
      brand: b,
      owner,
      actor: { actorType: 'BRAND', actorId: owner.id, name: owner.name, brandId: b.id },
      principal: { kind: 'user', userId: owner.id, name: owner.name, role: owner.role, actorType: 'BRAND', brandId: b.id, courierId: null, hubId: null, permissions: ROLE_PERMISSIONS[owner.role] },
    });
  }
  const zoneRows = await db.select().from(zones);
  const hubRows = await db.select().from(hubs);
  const heroRows = await db
    .select({ c: couriers, phone: users.phone, name: users.name, userStatus: users.status })
    .from(couriers)
    .innerJoin(users, eq(users.id, couriers.userId))
    .where(eq(couriers.status, 'ACTIVE'));
  const usable = heroRows.filter((h) => h.userStatus === 'ACTIVE' && h.phone !== HERO_ONE && !h.c.code.startsWith('PT-'));
  const coverage = await db.select().from(courierZones);
  const heroesByZone = new Map<string, CourierRow[]>();
  for (const cz of [...coverage].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))) {
    const h = usable.find((x) => x.c.id === cz.courierId);
    if (h) heroesByZone.set(cz.zoneId, [...(heroesByZone.get(cz.zoneId) ?? []), h.c]);
  }
  const names = new Map(heroRows.map((h) => [h.c.id, h.name]));
  return {
    app,
    db,
    staff: { actorType: 'STAFF', actorId: staffUser.id, name: staffUser.name },
    staffPrincipal: { kind: 'user', userId: staffUser.id, name: staffUser.name, role: staffUser.role, actorType: 'STAFF', brandId: null, courierId: null, hubId: null, permissions: ROLE_PERMISSIONS[staffUser.role] },
    brands: brandMap,
    zones: new Map(zoneRows.map((z) => [z.code, z])),
    hubs: new Map(hubRows.map((h) => [h.code, h])),
    heroesByZone,
    heroActor: (c) => ({ actorType: 'COURIER', actorId: c.userId, name: names.get(c.id) ?? c.code, courierId: c.id }),
    now: new Date(),
  };
}

/** Backdates an order's creation (row + CREATED event). */
export async function backdateCreation(db: Db, orderId: string, at: Date) {
  await db.update(orders).set({ createdAt: at }).where(eq(orders.id, orderId));
  await db.update(orderEvents).set({ createdAt: at }).where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.status, 'CREATED')));
}

/**
 * Moves what a service wrote "now" for one order (events, attempts, ledger
 * transactions) to the given moments: the i-th event since `since` gets
 * `times[i]` (the last time repeats), attempts and money the last one.
 */
export async function retimeOrder(db: Db, orderId: string, since: Date, times: Date[]) {
  if (!times.length) return;
  const events = await db
    .select({ id: orderEvents.id })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), gte(orderEvents.createdAt, since)))
    .orderBy(orderEvents.createdAt, orderEvents.id);
  for (const [i, e] of events.entries()) await db.update(orderEvents).set({ createdAt: times[Math.min(i, times.length - 1)] }).where(eq(orderEvents.id, e.id));
  const last = times[times.length - 1];
  await db.update(deliveryAttempts).set({ createdAt: last }).where(and(eq(deliveryAttempts.orderId, orderId), gte(deliveryAttempts.createdAt, since)));
  await db.update(ledgerTransactions).set({ createdAt: last }).where(and(eq(ledgerTransactions.orderId, orderId), gte(ledgerTransactions.createdAt, since)));
}

/** Ledger rows of finished orders move to when the money actually moved. */
export async function retimeLedgerForOrders(db: Db, orderIds: string[]) {
  for (let i = 0; i < orderIds.length; i += 500) {
    const ids = orderIds.slice(i, i + 500);
    await db.execute(sql`
      update ${ledgerTransactions} lt
      join ${orders} o on o.id = lt.orderId
      set lt.createdAt = coalesce(o.deliveredAt, o.returnedAt, o.cancelledAt, lt.createdAt)
      where lt.orderId in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
  }
}

export async function retimeHandover(db: Db, handoverId: string, at: Date) {
  await db.update(cashHandovers).set({ createdAt: at, confirmedAt: at }).where(eq(cashHandovers.id, handoverId));
  await db.update(ledgerTransactions).set({ createdAt: at }).where(eq(ledgerTransactions.reference, `handover:${handoverId}`));
}

/** Ledger entries carry their transaction's timestamp. */
export async function syncLedgerEntryTimes(db: Db) {
  await db.execute(sql`
    update ${ledgerEntries} le
    join ${ledgerTransactions} lt on lt.id = le.transactionId
    set le.createdAt = lt.createdAt
    where le.createdAt <> lt.createdAt`);
}

/** Customer-ish names and phones for demo orders. */
export const NAMES = ['منى عادل', 'كريم سامي', 'هبة محمود', 'Ahmed Tarek', 'Salma Hany', 'عمر خالد', 'نورا حسن', 'Youssef Ali', 'مريم إبراهيم', 'Mostafa Fathy', 'دينا كمال', 'Omar Nabil', 'ياسمين صالح', 'Hassan Gaber', 'فريدة منصور', 'Laila Ezzat'];
export const demoPhone = (r: ReturnType<typeof rng>) => `+20${r.pick(['10', '11', '12', '15'])}${String(r.between(0, 99_999_999)).padStart(8, '0')}`;
