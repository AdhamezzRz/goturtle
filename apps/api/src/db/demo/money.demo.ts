/* eslint-disable no-console */
import type { INestApplicationContext } from '@nestjs/common';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { ROLE_PERMISSIONS, type CollectionMethod, type UserRole } from '@goturtle/shared';
import type { Db } from '../client';
import { brandAdvances, brands, courierZones, couriers, customers, ledgerEntries, ledgerTransactions, orderEvents, orders, users, zones } from '../schema';
import { DB } from '../../core/database.module';
import { cairoDateTime } from '../helpers';
import type { ActorContext } from '../../common/actor';
import type { Principal } from '../../common/principal';
import { LedgerService } from '../../core/ledger/ledger.service';
import { StorageService } from '../../core/storage.service';
import { OrdersService } from '../../modules/orders/orders.service';
import { OrderWorkflowService } from '../../modules/orders/order-workflow.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { SettlementsService } from '../../modules/finance/settlements.service';
import { CollectionsService } from '../../modules/money-programs/collections.service';
import { AdvancesService } from '../../modules/money-programs/advances.service';
import { WeightService } from '../../modules/money-programs/weight.service';
import { ClaimsService } from '../../modules/claims/claims.service';
import { parcelPhoto } from './money/evidence-png';

const META = { ip: '127.0.0.1', userAgent: 'money-demo' };
const HOUR = 3_600_000;
/** Marker on every demo order's brand reference: "<BRAND>-MNY-<n>" (idempotency key). */
const REF = 'MNY';

type Brand = typeof brands.$inferSelect;
type Hero = typeof couriers.$inferSelect & { name: string };

const egp = (n: number) => Math.round(n * 100);
const floorEgp = (cents: number) => Math.floor(cents / 100) * 100;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

/** A Cairo wall-clock time `days` days ago (never later than `maxAgoHours` before now). */
function cairoAt(days: number, hhmm: string, maxAgoHours = 1): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ago(days * 24));
  const at = cairoDateTime(day, hhmm);
  const limit = ago(maxAgoHours);
  return at > limit ? limit : at;
}

function principal(u: typeof users.$inferSelect, actorType: 'STAFF' | 'BRAND'): Principal {
  return {
    kind: 'user', userId: u.id, name: u.name, role: u.role, actorType, brandId: u.brandId ?? null, courierId: null, hubId: null,
    permissions: ROLE_PERMISSIONS[u.role as UserRole],
  };
}

/**
 * v1.1 money-programs demo: digital payments at the door (pending / confirmed /
 * rejected), brand early payouts & COD advances (one recovered at settlement),
 * claims in every state, and hub weighing with re-pricing and disputes.
 * Everything goes through the real services so the ledger, timelines, audit
 * and notifications are consistent. Idempotent: skipped once the demo orders
 * (brand reference "<BRAND>-MNY-…") exist.
 */
export async function seedMoneyDemo(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const ledger = app.get(LedgerService);

  const [done] = await db.select({ id: orders.id }).from(orders).where(like(orders.brandReference, `%-${REF}-%`)).limit(1);
  if (done) {
    console.log('• money demo already seeded — skipping');
    await assertBalanced(ledger);
    return;
  }

  const userByPhone = async (phone: string) => (await db.select().from(users).where(eq(users.phone, phone)).limit(1))[0];
  const [opsUser, financeUser, adminUser] = [await userByPhone('+201000000001'), await userByPhone('+201000000004'), await userByPhone('+201000000000')];
  const brandRows = await db.select().from(brands).where(inArray(brands.code, ['CGAD', 'NILE']));
  const cgad = brandRows.find((b) => b.code === 'CGAD');
  const nile = brandRows.find((b) => b.code === 'NILE');
  const heroRows = await db
    .select({ hero: couriers, name: users.name })
    .from(couriers)
    .innerJoin(users, eq(users.id, couriers.userId))
    .where(and(inArray(couriers.code, ['HR-00001', 'HR-00002', 'HR-00003', 'HR-00004', 'HR-00005']), eq(couriers.status, 'ACTIVE')));
  const heroes = new Map<string, Hero>(heroRows.map((r) => [r.hero.code, { ...r.hero, name: r.name }]));
  const reliable = await db
    .select()
    .from(customers)
    .where(and(sql`${customers.deliveredOrders} >= 1`, eq(customers.refusedOrders, 0), eq(customers.isBlocked, false), eq(customers.requirePrepayment, false)))
    .limit(40);
  if (!opsUser || !financeUser || !cgad || !nile || heroes.size < 5 || reliable.length < 10) {
    console.log('• money demo: base demo data missing (staff, CGAD/NILE brands, heroes HR-00001…5 or customers) — skipped');
    return;
  }
  const owners = await db.select().from(users).where(and(eq(users.role, 'BRAND_OWNER'), inArray(users.brandId, [cgad.id, nile.id])));
  const ownerOf = (b: Brand) => owners.find((u) => u.brandId === b.id)!;
  if (owners.length < 2) {
    console.log('• money demo: brand owners missing — skipped');
    return;
  }

  const ordersSvc = app.get(OrdersService, { strict: false });
  const workflow = app.get(OrderWorkflowService, { strict: false });
  const settings = app.get(SettingsService, { strict: false });
  const settlements = app.get(SettlementsService, { strict: false });
  const collections = app.get(CollectionsService, { strict: false });
  const advances = app.get(AdvancesService, { strict: false });
  const weight = app.get(WeightService, { strict: false });
  const claims = app.get(ClaimsService, { strict: false });
  const storage = app.get(StorageService, { strict: false });

  const ops = principal(opsUser, 'STAFF');
  const finance = principal(financeUser, 'STAFF');
  const admin = adminUser ? principal(adminUser, 'STAFF') : ops;
  const staff: ActorContext = { actorType: 'STAFF', actorId: opsUser.id, name: opsUser.name };
  const brandPrincipal = (b: Brand) => principal(ownerOf(b), 'BRAND');
  const brandActor = (b: Brand): ActorContext => ({ actorType: 'BRAND', actorId: ownerOf(b).id, name: ownerOf(b).name, brandId: b.id });
  const heroActor = (h: Hero): ActorContext => ({ actorType: 'COURIER', actorId: h.userId, name: h.name, courierId: h.id });
  const hero = (code: string) => heroes.get(code)!;
  const stats = { orders: 0, skipped: 0 };
  const warn = (what: string, err: unknown) => {
    stats.skipped++;
    console.warn(`  money demo: ${what} skipped — ${(err as Error).message}`);
  };

  // 0. Company accounts shown to heroes at the door.
  await settings.set('finance', { instapayAddress: 'goturtle@instapay', walletNumber: '01012345678' }, admin, META);

  // Zones each hero covers (primary first) so parcels look like real routes.
  const coverage = await db.select({ courierId: courierZones.courierId, zoneId: courierZones.zoneId, isPrimary: courierZones.isPrimary }).from(courierZones);
  const zoneRows = await db.select().from(zones).where(eq(zones.isActive, true));
  const zoneFor = (h: Hero) => {
    const z = coverage.filter((c) => c.courierId === h.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0];
    return zoneRows.find((x) => x.id === z?.zoneId) ?? zoneRows[0];
  };

  let refN = 0;
  let custN = 0;
  /** A new order through the real intake, back-dated to `createdAt`. */
  async function create(b: Brand, h: Hero, o: { codEgp: number; created: Date; product: string; weightGrams?: number; declaredEgp?: number }) {
    const zone = zoneFor(h);
    const c = reliable[custN++ % reliable.length];
    const ref = await ordersSvc.create(
      {
        brandId: b.id,
        brandReference: `${b.code}-${REF}-${String(++refN).padStart(3, '0')}`,
        source: 'PORTAL',
        type: 'DELIVERY',
        serviceLevel: 'STANDARD',
        recipient: { name: c.name, phone: c.phone },
        address: { line: `${12 + refN} ${zone.nameEn} main street`, building: String(3 + (refN % 40)), floor: String(refN % 9), apartment: String(1 + (refN % 20)), zoneId: zone.id, lat: zone.centerLat + ((refN % 7) - 3) * 0.002, lng: zone.centerLng + ((refN % 5) - 2) * 0.002 },
        package: { description: o.product, itemsCount: 1 + (refN % 2), weightGrams: o.weightGrams ?? 1000, declaredValueCents: o.declaredEgp ? egp(o.declaredEgp) : 0 },
        paymentMethod: 'COD',
        codAmountCents: egp(o.codEgp),
        feesPaidBy: 'BRAND',
        pickupLocationId: null,
        deliveryOtpRequired: false,
      },
      brandActor(b),
    );
    stats.orders++;
    await db.update(orders).set({ createdAt: o.created }).where(eq(orders.id, ref.id));
    await db.update(orderEvents).set({ createdAt: o.created }).where(and(eq(orderEvents.orderId, ref.id), eq(orderEvents.status, 'CREATED')));
    return { id: ref.id, zone };
  }

  /** Picked up by the hero and scanned into the zone's hub. */
  async function toHub(id: string, h: Hero, zone: typeof zoneRows[number], picked: Date, received: Date) {
    await workflow.transition(id, 'PICKED_UP', heroActor(h), { courierId: h.id, at: picked });
    await workflow.transition(id, 'RECEIVED_AT_HUB', staff, { hubId: zone.hubId, at: received });
  }

  /** Full back-dated delivery; non-cash methods go through the door-payment guard (custody untouched). */
  async function deliver(b: Brand, h: Hero, o: { codEgp: number; daysAgo: number; product: string; method: CollectionMethod; reference?: string }) {
    const created = cairoAt(o.daysAgo + 1, '15:10', 30);
    const { id, zone } = await create(b, h, { codEgp: o.codEgp, created, product: o.product });
    await toHub(id, h, zone, new Date(created.getTime() + 2 * HOUR), new Date(created.getTime() + 4 * HOUR));
    const out = cairoAt(o.daysAgo, '10:20', 4);
    await workflow.transition(id, 'ASSIGNED', staff, { courierId: h.id, at: new Date(out.getTime() - 30 * 60_000) });
    await workflow.transition(id, 'OUT_FOR_DELIVERY', heroActor(h), { at: out });
    const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    const deliveredAt = new Date(out.getTime() + (1.5 + (refN % 3)) * HOUR);
    await workflow.transition(id, 'DELIVERED', heroActor(h), {
      at: deliveredAt,
      lat: row.lat, lng: row.lng,
      delivery: { collectedCents: row.collectCents, receivedBy: row.recipientName },
      extensions: { collection: { method: o.method, reference: o.reference ?? null } },
    });
    return { id, deliveredAt, trackingNumber: row.trackingNumber, hero: h };
  }

  // ------------------------------------------------------------------ 1. digital payments at the door
  type Delivered = Awaited<ReturnType<typeof deliver>>;
  const plan: Array<{ key: string; brand: Brand; hero: string; codEgp: number; daysAgo: number; product: string; method: CollectionMethod; reference?: string }> = [
    { key: 'h1-instapay', brand: cgad, hero: 'HR-00001', codEgp: 1250, daysAgo: 2, product: 'Wireless earbuds', method: 'INSTAPAY', reference: 'IPN-48213907' },
    { key: 'h1-wallet', brand: cgad, hero: 'HR-00001', codEgp: 899, daysAgo: 1, product: 'Phone case + charger', method: 'WALLET', reference: 'VF-7731204' },
    { key: 'card-pending', brand: cgad, hero: 'HR-00002', codEgp: 1899, daysAgo: 1, product: 'Smart watch', method: 'CARD', reference: 'POS-552190' },
    { key: 'instapay-pending', brand: cgad, hero: 'HR-00003', codEgp: 650, daysAgo: 1, product: 'Gaming mouse', method: 'INSTAPAY', reference: 'IPN-48260115' },
    { key: 'wallet-confirmed', brand: cgad, hero: 'HR-00004', codEgp: 1450, daysAgo: 2, product: 'Power bank 20,000mAh', method: 'WALLET', reference: 'VF-7729981' },
    { key: 'card-rejected', brand: cgad, hero: 'HR-00005', codEgp: 780, daysAgo: 2, product: 'Bluetooth speaker', method: 'CARD', reference: 'POS-551873' },
    { key: 'nile-confirmed', brand: nile, hero: 'HR-00002', codEgp: 499, daysAgo: 2, product: 'Linen shirt', method: 'INSTAPAY', reference: 'IPN-48199342' },
    { key: 'nile-pending', brand: nile, hero: 'HR-00003', codEgp: 1200, daysAgo: 1, product: 'Abaya', method: 'WALLET', reference: 'VF-7734410' },
  ];
  const d = new Map<string, Delivered>();
  for (const p of plan) {
    try {
      d.set(p.key, await deliver(p.brand, hero(p.hero), p));
    } catch (err) {
      warn(`delivery ${p.key}`, err);
    }
  }
  const digitalIds = [...d.values()].map((x) => x.id);
  const decided: Array<{ id: string; at: Date }> = [];
  for (const [key, bankRef] of [['h1-instapay', 'CIB-STMT-0412'], ['wallet-confirmed', 'VF-SETTLE-1029'], ['nile-confirmed', 'CIB-STMT-0412']] as const) {
    const x = d.get(key);
    if (!x) continue;
    try {
      await collections.confirm(x.id, bankRef, finance, META);
      decided.push({ id: x.id, at: new Date(x.deliveredAt.getTime() + 18 * HOUR) });
    } catch (err) {
      warn(`confirm ${key}`, err);
    }
  }
  const rejected = d.get('card-rejected');
  if (rejected) {
    try {
      await collections.reject(rejected.id, 'No POS settlement for slip POS-551873 on the bank statement', finance, META);
      decided.push({ id: rejected.id, at: new Date(rejected.deliveredAt.getTime() + 20 * HOUR) });
    } catch (err) {
      warn('reject collection', err);
    }
  }

  // Money moved when the parcels were delivered / confirmed: align the ledger and the timeline.
  if (digitalIds.length) {
    await db.execute(sql`
      update ${ledgerTransactions} lt join ${orders} o on o.id = lt.orderId
      set lt.createdAt = o.deliveredAt
      where lt.orderId in (${sql.join(digitalIds.map((x) => sql`${x}`), sql`, `)}) and lt.reference not like '%:collection:%'`);
  }
  for (const x of decided) {
    const at = x.at > ago(0.5) ? ago(0.5) : x.at;
    await db.update(ledgerTransactions).set({ createdAt: at }).where(and(eq(ledgerTransactions.orderId, x.id), like(ledgerTransactions.reference, '%:collection:%')));
    await db.update(orderEvents).set({ createdAt: at }).where(and(eq(orderEvents.orderId, x.id), inArray(orderEvents.reason, ['COLLECTION_CONFIRMED', 'COLLECTION_REJECTED'])));
  }

  // ------------------------------------------------------------------ 2. hub weighing & disputes (CGAD parcels at the hub)
  const weighPlan = [
    { key: 'adjusted', product: 'Bluetooth speaker', codEgp: 1800, declared: 1000, actual: 4600 },
    { key: 'disputed', product: 'Gaming keyboard', codEgp: 2600, declared: 800, actual: 950, dims: { l: 50, w: 40, h: 30 } },
    { key: 'reversed', product: 'Smart watch', codEgp: 1350, declared: 1200, actual: 5200 },
    { key: 'accepted', product: 'Power bank 20,000mAh', codEgp: 3200, declared: 1500, actual: 4300 },
    { key: 'ok', product: 'Phone case + charger', codEgp: 950, declared: 900, actual: 1050 },
  ];
  const weighed = new Map<string, string>();
  const weighHeroes = ['HR-00002', 'HR-00004', 'HR-00005', 'HR-00002', 'HR-00004'];
  for (const [i, w] of weighPlan.entries()) {
    try {
      const h = hero(weighHeroes[i]);
      const created = cairoAt(1, '16:30', 6);
      const { id, zone } = await create(cgad, h, { codEgp: w.codEgp, created, product: w.product, weightGrams: w.declared });
      await toHub(id, h, zone, new Date(created.getTime() + 2 * HOUR), ago(3 - i * 0.2));
      const [o] = await db.select({ tn: orders.trackingNumber }).from(orders).where(eq(orders.id, id)).limit(1);
      await weight.weigh({ trackingNumber: o.tn, weightGrams: w.actual, ...(w.dims ? { dimensionsCm: w.dims } : {}) }, ops, META);
      weighed.set(w.key, id);
    } catch (err) {
      warn(`weighing ${w.key}`, err);
    }
  }
  const cgadOwner = brandPrincipal(cgad);
  const disputes: Array<[string, string, 'ACCEPTED' | 'REVERSED' | null, string]> = [
    ['disputed', 'Our warehouse scale shows 0.95 kg and the box is 30×20×15 cm — the size looks wrong, please re-measure.', null, ''],
    ['reversed', 'The watch box weighs 1.2 kg on our scale; 5.2 kg must be another parcel.', 'REVERSED', 'Re-weighed at the hub: 1.18 kg — the scale reading belonged to the next parcel. Fee refunded.'],
    ['accepted', 'We declared 1.5 kg as usual for power banks.', 'ACCEPTED', 'Scale photo confirms 4.3 kg (box contains 3 power banks). Adjustment kept.'],
  ];
  for (const [key, note, decision, decisionNote] of disputes) {
    const id = weighed.get(key);
    if (!id) continue;
    try {
      await weight.dispute({ orderId: id, note }, cgadOwner, META);
      if (decision) await weight.resolve(id, { decision, note: decisionNote }, ops, META);
    } catch (err) {
      warn(`weight dispute ${key}`, err);
    }
  }

  // ------------------------------------------------------------------ 3. advances (Cairo Gadgets) and a settlement that recovers part of the COD advance
  const adv = { rejected: '', early: '', cod: '', requested: '', settlement: '', recoveredCents: 0 };
  try {
    const e1 = await advances.eligibility(cgad.id);
    const min = e1.minAmountCents;
    const asked = floorEgp(e1.earlyPayout.maxAmountCents * 0.3);
    if (asked >= min) {
      const a = await advances.request(cgadOwner, { type: 'EARLY_PAYOUT', amountCents: asked, notes: 'Supplier payment due tomorrow' }, META);
      await advances.reject(a.id, 'Payout account changed yesterday — we need the new IBAN verified first.', finance, META);
      adv.rejected = a.code;
    }
    const early = floorEgp(e1.earlyPayout.maxAmountCents * 0.35);
    if (early >= min) {
      const a = await advances.request(cgadOwner, { type: 'EARLY_PAYOUT', amountCents: early, notes: 'Restocking for the weekend sale' }, META);
      await advances.approve(a.id, finance, META);
      await advances.pay(a.id, { method: 'INSTAPAY', reference: 'IP-ADV-20418' }, finance, META);
      adv.early = a.code;
    }
    const e2 = await advances.eligibility(cgad.id);
    const cod = floorEgp(e2.codAdvance.maxAmountCents);
    if (cod >= min) {
      const a = await advances.request(cgadOwner, { type: 'COD_ADVANCE', amountCents: cod, notes: 'Cash for the new phone accessories stock' }, META);
      await advances.approve(a.id, finance, META);
      await advances.pay(a.id, { method: 'BANK_TRANSFER', reference: 'CIB-TRF-883102' }, finance, META);
      adv.cod = a.code;
    }
    // Settlement for the newly delivered parcels: nets the early payout and recovers what it can of the COD advance.
    const gen = await settlements.generate({ brandId: cgad.id }, finance, META);
    const s = gen.created[0];
    if (s) {
      adv.settlement = s.code;
      await settlements.approve(s.id, finance, META);
      if (s.netPayableCents > 0) await settlements.pay(s.id, { paymentReference: `DEMO-${s.code}` }, finance, META);
    }
    if (adv.cod) {
      const [row] = await db.select().from(brandAdvances).where(eq(brandAdvances.code, adv.cod)).limit(1);
      adv.recoveredCents = row?.recoveredCents ?? 0;
    }
  } catch (err) {
    warn('advances', err);
  }

  // Two more paid-by-transfer deliveries after the settlement fund a request still waiting for approval.
  for (const p of [
    { key: 'after-1', brand: cgad, hero: 'HR-00004', codEgp: 1650, daysAgo: 1, product: 'Wireless earbuds', method: 'INSTAPAY' as const, reference: 'IPN-48277203' },
    { key: 'after-2', brand: cgad, hero: 'HR-00002', codEgp: 2200, daysAgo: 1, product: 'Smart watch', method: 'INSTAPAY' as const, reference: 'IPN-48277961' },
  ]) {
    try {
      const x = await deliver(p.brand, hero(p.hero), p);
      d.set(p.key, x);
      await collections.confirm(x.id, 'CIB-STMT-0413', finance, META);
      await db.update(ledgerTransactions).set({ createdAt: x.deliveredAt }).where(and(eq(ledgerTransactions.orderId, x.id), sql`${ledgerTransactions.reference} not like '%:collection:%'`));
    } catch (err) {
      warn(`delivery ${p.key}`, err);
    }
  }
  try {
    const e3 = await advances.eligibility(cgad.id);
    const early = floorEgp(e3.earlyPayout.maxAmountCents * 0.5);
    const cod = floorEgp(e3.codAdvance.maxAmountCents * 0.5);
    if (early >= e3.minAmountCents) adv.requested = (await advances.request(cgadOwner, { type: 'EARLY_PAYOUT', amountCents: early, notes: 'Ramadan campaign stock' }, META)).code;
    else if (cod >= e3.minAmountCents) adv.requested = (await advances.request(cgadOwner, { type: 'COD_ADVANCE', amountCents: cod }, META)).code;
  } catch (err) {
    warn('pending advance request', err);
  }

  // ------------------------------------------------------------------ 4. claims
  const evidence = async (variants: Array<'crushed' | 'open' | 'label'>, uploader: string) => {
    const urls: string[] = [];
    for (const v of variants) urls.push((await storage.put(parcelPhoto(v), 'image/png', 'ticket_attachment', uploader)).url);
    return urls;
  };
  const claimCodes: Record<string, string> = {};
  // LOST: a parcel that vanished from the hub audit → approved at the declared value and paid.
  try {
    const h = hero('HR-00003');
    const created = cairoAt(9, '12:00');
    const { id, zone } = await create(cgad, h, { codEgp: 2400, created, product: 'Smart watch', declaredEgp: 2400 });
    await toHub(id, h, zone, new Date(created.getTime() + 2 * HOUR), new Date(created.getTime() + 5 * HOUR));
    await workflow.transition(id, 'LOST', staff, { at: cairoAt(2, '17:00'), reason: 'HUB_AUDIT', note: 'Not found in the weekly hub audit — searched sorting area and returns cage' });
    const c = await claims.create(cgadOwner, { orderId: id, type: 'LOST', claimedCents: egp(2400), description: 'The parcel was marked lost by GoTurtle after 8 days at the hub. Claiming the declared value of the watch.' }, META);
    await claims.review(ops, c.id, META);
    await claims.approve(finance, c.id, { approvedCents: egp(2400), decisionNote: 'Confirmed lost in the hub audit — full declared value.' }, META);
    await claims.pay(finance, c.id, META);
    claimCodes.lost = c.code;
  } catch (err) {
    warn('LOST claim', err);
  }
  const claimOn = async (key: string, b: Brand, body: { type: 'DAMAGED' | 'MISSING_ITEMS' | 'WRONG_ITEM'; claimedCents: number; description: string; photos: Array<'crushed' | 'open' | 'label'> }) => {
    const x = d.get(key);
    if (!x) return null;
    const owner = brandPrincipal(b);
    const urls = body.photos.length ? await evidence(body.photos, owner.kind === 'user' ? owner.userId : '') : [];
    return claims.create(owner, { orderId: x.id, type: body.type, claimedCents: body.claimedCents, description: body.description, evidence: urls }, META);
  };
  try {
    const c = await claimOn('card-pending', cgad, { type: 'DAMAGED', claimedCents: egp(650), description: 'The smart watch box arrived crushed and the screen is cracked. Customer sent the photos below.', photos: ['crushed', 'label'] });
    if (c) {
      await claims.review(ops, c.id, META);
      claimCodes.damaged = c.code;
    }
  } catch (err) {
    warn('DAMAGED claim', err);
  }
  try {
    const c = await claimOn('wallet-confirmed', cgad, { type: 'MISSING_ITEMS', claimedCents: egp(450), description: 'The power bank box was opened and the USB-C cable and adapter were missing.', photos: ['open'] });
    if (c) {
      await claims.approve(finance, c.id, { approvedCents: egp(300), decisionNote: 'Seal broken on the hub photo — cable and adapter reimbursed at cost.', chargeHeroCents: egp(150), courierId: d.get('wallet-confirmed')!.hero.id }, META);
      claimCodes.missing = c.code;
    }
  } catch (err) {
    warn('MISSING_ITEMS claim', err);
  }
  try {
    const c = await claimOn('nile-pending', nile, { type: 'DAMAGED', claimedCents: egp(400), description: 'The abaya arrived with a torn sleeve — the bag was wet and ripped.', photos: ['open'] });
    if (c) claimCodes.nileOpen = c.code;
  } catch (err) {
    warn('NILE DAMAGED claim', err);
  }
  try {
    const c = await claimOn('nile-confirmed', nile, { type: 'WRONG_ITEM', claimedCents: egp(499), description: 'Customer says she received a blue linen shirt instead of the white one.', photos: [] });
    if (c) {
      await claims.reject(ops, c.id, 'The parcel was sealed by Nile Threads and delivered unopened — the wrong colour was packed at the warehouse.', META);
      claimCodes.nileRejected = c.code;
    }
  } catch (err) {
    warn('WRONG_ITEM claim', err);
  }

  // Ledger entries follow their transactions' dates.
  await db.execute(sql`update ${ledgerEntries} le join ${ledgerTransactions} lt on lt.id = le.transactionId set le.createdAt = lt.createdAt where le.createdAt <> lt.createdAt`);
  await assertBalanced(ledger);

  const coll = await db
    .select({ s: orders.collectionStatus, n: sql<number>`count(*)`.mapWith(Number) })
    .from(orders)
    .where(and(like(orders.brandReference, `%-${REF}-%`), sql`${orders.collectionMethod} <> 'CASH'`))
    .groupBy(orders.collectionStatus);
  const n = (s: string) => coll.find((c) => c.s === s)?.n ?? 0;
  console.log(
    `✔ money demo: ${stats.orders} orders · digital collections ${n('PENDING_CONFIRMATION')} pending / ${n('CONFIRMED')} confirmed / ${n('REJECTED')} rejected · ` +
      `advances ${[adv.early && `${adv.early} early paid`, adv.cod && `${adv.cod} COD paid (${(adv.recoveredCents / 100).toFixed(2)} EGP recovered${adv.settlement ? ` by ${adv.settlement}` : ''})`, adv.requested && `${adv.requested} requested`, adv.rejected && `${adv.rejected} rejected`].filter(Boolean).join(', ')} · ` +
      `${Object.keys(claimCodes).length} claims · ${weighed.size} parcels weighed (${[...weighed.keys()].join(', ')})` +
      (stats.skipped ? ` · ${stats.skipped} steps skipped` : ''),
  );
}

async function assertBalanced(ledger: LedgerService) {
  const tb = await ledger.trialBalance();
  if (!tb.balanced) throw new Error(`money demo: ledger NOT balanced (debits ${tb.totalDebits} ≠ credits ${tb.totalCredits})`);
}
