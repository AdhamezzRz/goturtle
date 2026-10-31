/* eslint-disable no-console */
import 'dotenv/config';
import { count, eq } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { runMigrations } from './migrate';
import * as s from './schema';
import { CITIES, DEFAULT_RATES, GOVERNORATES, HUBS, ZONES } from './cairo';
import { hashPassword } from '../modules/auth/auth.service';
import { assertValidConfig, config } from '../config';

/**
 * Seeds the Greater Cairo network, rate cards, staff, demo brands and heroes.
 * Idempotent: does nothing if zones already exist.
 *
 *   npm run db:seed            → base data + demo activity
 *   npm run db:seed -- --base  → base data only (production first run)
 *
 * All demo accounts use the password DEMO_PASSWORD below.
 */
export const DEMO_PASSWORD = 'Turtle@2026';

/** Base seed = Greater Cairo network + demo accounts. */
export async function seedBase(db: Db) {
  const created = await seedNetwork(db);
  if (!created) {
    console.log('• network already seeded — skipping base seed');
    return false;
  }
  await seedDemoAccounts(db);
  return true;
}

/**
 * Production-safe: governorates, cities, hubs, the 25 Greater Cairo zones and the
 * default rate cards. Idempotent (does nothing when zones exist). Returns true when created.
 */
export async function seedNetwork(db: Db): Promise<boolean> {
  const [{ n }] = await db.select({ n: count() }).from(s.zones);
  if (Number(n) > 0) return false;

  // Geography
  const govIds = new Map<string, string>();
  for (const g of GOVERNORATES) {
    const [r] = await db.insert(s.governorates).values(g).$returningId();
    govIds.set(g.code, r.id);
  }
  const cityIds = new Map<string, string>();
  for (const c of CITIES) {
    const [r] = await db.insert(s.cities).values({ code: c.code, nameEn: c.nameEn, nameAr: c.nameAr, governorateId: govIds.get(c.gov)! }).$returningId();
    cityIds.set(c.code, r.id);
  }
  const hubIds = new Map<string, string>();
  for (const h of HUBS) {
    const [r] = await db.insert(s.hubs).values(h).$returningId();
    hubIds.set(h.code, r.id);
  }
  const zoneIds = new Map<string, string>();
  for (const z of ZONES) {
    const [r] = await db
      .insert(s.zones)
      .values({
        code: z.code, nameEn: z.nameEn, nameAr: z.nameAr, cityId: cityIds.get(z.city)!, hubId: hubIds.get(z.hub)!,
        tier: z.tier, keywords: z.keywords, centerLat: z.lat, centerLng: z.lng, slaHours: z.slaHours ?? (z.tier === 'A' ? 24 : 36),
      })
      .$returningId();
    zoneIds.set(z.code, r.id);
  }
  console.log(`✔ ${GOVERNORATES.length} governorates, ${CITIES.length} cities, ${HUBS.length} hubs, ${ZONES.length} zones`);

  // Pricing
  const [standard] = await db
    .insert(s.pricingPlans)
    .values({ name: 'Standard', description: 'Default rate card for new brands', isDefault: true, codFeeBp: 100, codFeeMinCents: 500 })
    .$returningId();
  const [growth] = await db
    .insert(s.pricingPlans)
    .values({ name: 'Growth (500+ orders/month)', description: 'Volume discount', codFeeBp: 75, codFeeMinCents: 300, returnFeeBp: 4000 })
    .$returningId();
  for (const r of DEFAULT_RATES) {
    for (const level of ['STANDARD', 'SAME_DAY', 'EXPRESS', 'SCHEDULED'] as const) {
      await db.insert(s.pricingRules).values({ planId: standard.id, tier: r.tier, serviceLevel: level, baseFeeCents: r[level] });
      await db.insert(s.pricingRules).values({ planId: growth.id, tier: r.tier, serviceLevel: level, baseFeeCents: Math.round((r[level] * 0.85) / 50) * 50 });
    }
  }
  console.log('✔ pricing plans: Standard, Growth');
  return true;
}

/**
 * Demo staff, brands (with owners & pickup locations) and heroes, all with
 * DEMO_PASSWORD. Requires the network. Skips accounts whose phone already exists.
 */
export async function seedDemoAccounts(db: Db): Promise<void> {
  const zoneIds = new Map((await db.select({ id: s.zones.id, code: s.zones.code }).from(s.zones)).map((z) => [z.code, z.id]));
  const hubIds = new Map((await db.select({ id: s.hubs.id, code: s.hubs.code }).from(s.hubs)).map((h) => [h.code, h.id]));
  const plans = await db.select().from(s.pricingPlans);
  const standard = plans.find((p) => p.isDefault) ?? plans[0];
  const growth = plans.find((p) => !p.isDefault) ?? standard;

  // Staff
  const pw = await hashPassword(DEMO_PASSWORD);
  const staff = [
    { name: 'Mona Fathy', phone: '+201000000001', email: 'ops@goturtle.eg', role: 'OPS_MANAGER' as const },
    { name: 'Karim Adel', phone: '+201000000002', email: 'dispatch@goturtle.eg', role: 'DISPATCHER' as const },
    { name: 'Hany Saeed', phone: '+201000000003', email: 'hub@goturtle.eg', role: 'HUB_OPERATOR' as const, hub: 'HUB-NSR' },
    { name: 'Nour Hassan', phone: '+201000000004', email: 'finance@goturtle.eg', role: 'FINANCE' as const },
    { name: 'Salma Tarek', phone: '+201000000005', email: 'support@goturtle.eg', role: 'SUPPORT' as const },
  ];
  const staffIds = new Map<string, string>();
  for (const u of staff) {
    const [existing] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.phone, u.phone)).limit(1);
    if (existing) {
      staffIds.set(u.role, existing.id);
      continue;
    }
    const [r] = await db
      .insert(s.users)
      .values({ name: u.name, phone: u.phone, email: u.email, role: u.role, passwordHash: pw, locale: 'en', hubId: 'hub' in u ? hubIds.get(u.hub!) : null })
      .$returningId();
    staffIds.set(u.role, r.id);
  }
  console.log(`✔ ${staff.length} staff users`);

  // Brands
  const brands = [
    { code: 'NILE', name: 'Nile Threads', industry: 'Fashion', phone: '+201110000001', email: 'hello@nilethreads.eg', plan: growth.id, owner: { name: 'Yasmin Nabil', phone: '+201110000011' }, location: { name: 'Zamalek studio', address: '12 Brazil St, Zamalek', zone: 'CAI-ZAMALEK', lat: 30.0626, lng: 31.2197 }, cycle: 'WEEKLY' as const, allowOpen: true },
    { code: 'CGAD', name: 'Cairo Gadgets', industry: 'Electronics', phone: '+201110000002', email: 'orders@cairogadgets.eg', plan: standard.id, owner: { name: 'Omar Khaled', phone: '+201110000012' }, location: { name: 'Nasr City warehouse', address: '45 Makram Ebeid, Nasr City', zone: 'CAI-NASR', lat: 30.0583, lng: 31.3446 }, cycle: 'DAILY' as const, allowOpen: false },
    { code: 'BLOOM', name: 'Bloom Beauty', industry: 'Cosmetics', phone: '+201110000003', email: 'care@bloombeauty.eg', plan: standard.id, owner: { name: 'Laila Mostafa', phone: '+201110000013' }, location: { name: 'Maadi store', address: 'Road 9, Maadi', zone: 'CAI-MAADI', lat: 29.9602, lng: 31.2569 }, cycle: 'BIWEEKLY' as const, allowOpen: true },
  ];
  for (const b of brands) {
    const [exists] = await db.select({ id: s.brands.id }).from(s.brands).where(eq(s.brands.code, b.code)).limit(1);
    if (exists) continue;
    const [brand] = await db
      .insert(s.brands)
      .values({
        code: b.code, name: b.name, legalName: `${b.name} LLC`, industry: b.industry, phone: b.phone, email: b.email,
        status: 'ACTIVE', pricingPlanId: b.plan, settlementCycle: b.cycle, payoutMethod: 'INSTAPAY',
        payoutDetails: { instapayAddress: `${b.code.toLowerCase()}@instapay` }, allowOpenPackage: b.allowOpen,
        accountManagerId: staffIds.get('OPS_MANAGER') ?? null,
      })
      .$returningId();
    await db.insert(s.users).values({ name: b.owner.name, phone: b.owner.phone, email: `owner@${b.code.toLowerCase()}.eg`, role: 'BRAND_OWNER', brandId: brand.id, passwordHash: pw, locale: 'ar' });
    await db.insert(s.brandLocations).values({
      brandId: brand.id, name: b.location.name, contactName: b.owner.name, phone: b.owner.phone, addressLine: b.location.address,
      zoneId: zoneIds.get(b.location.zone)!, lat: b.location.lat, lng: b.location.lng, isDefault: true,
    });
  }
  console.log(`✔ ${brands.length} brands with owners and pickup locations`);

  // Heroes
  const heroes = [
    { name: 'Ahmed Samir', type: 'FREELANCE', vehicle: 'MOTORCYCLE', hub: 'HUB-NSR', zones: ['CAI-NASR', 'CAI-HELIO', 'CAI-SHERATON'] },
    { name: 'Mahmoud Ali', type: 'FREELANCE', vehicle: 'MOTORCYCLE', hub: 'HUB-NSR', zones: ['NCAI-TAGAMOA', 'NCAI-FIRST', 'NCAI-REHAB'] },
    { name: 'Youssef Ibrahim', type: 'SHIFT', vehicle: 'SCOOTER', hub: 'HUB-NSR', zones: ['CAI-NASR', 'CAI-ABBAS', 'CAI-SHUBRA'] },
    { name: 'Mostafa Gamal', type: 'SHIFT', vehicle: 'MOTORCYCLE', hub: 'HUB-MAD', zones: ['CAI-MAADI', 'CAI-MOKATTAM', 'CAI-OLDCAIRO'] },
    { name: 'Islam Reda', type: 'FREELANCE', vehicle: 'MOTORCYCLE', hub: 'HUB-MAD', zones: ['CAI-MAADI', 'CAI-HELWAN'] },
    { name: 'Hassan Fouad', type: 'FULL_TIME', vehicle: 'CAR', hub: 'HUB-GIZ', zones: ['GIZ-MOHANDESSIN', 'GIZ-DOKKI', 'CAI-ZAMALEK'] },
    { name: 'Amr Nasser', type: 'FREELANCE', vehicle: 'MOTORCYCLE', hub: 'HUB-GIZ', zones: ['CAI-DOWNTOWN', 'CAI-ZAMALEK', 'GIZ-DOKKI'] },
    { name: 'Tamer Hosny', type: 'SHIFT', vehicle: 'BICYCLE', hub: 'HUB-GIZ', zones: ['GIZ-GIZA', 'GIZ-IMBABA'] },
    { name: 'Sherif Magdy', type: 'FREELANCE', vehicle: 'MOTORCYCLE', hub: 'HUB-OCT', zones: ['OCT-OCTOBER', 'OCT-ZAYED', 'GIZ-HADAYEK'] },
    { name: 'Bassem Wael', type: 'FREELANCE', vehicle: 'VAN', hub: 'HUB-NSR', zones: ['NCAI-SHOROUK', 'NCAI-CAPITAL', 'CAI-SALAM'] },
  ] as const;
  let i = 0;
  for (const h of heroes) {
    i++;
    const phone = `+2012000000${String(i).padStart(2, '0')}`;
    const [taken] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.phone, phone)).limit(1);
    if (taken) continue;
    const [user] = await db.insert(s.users).values({ name: h.name, phone, role: 'COURIER', passwordHash: pw, locale: 'ar' }).$returningId();
    const hub = HUBS.find((x) => x.code === h.hub)!;
    const isShift = h.type === 'SHIFT';
    const [courier] = await db
      .insert(s.couriers)
      .values({
        userId: user.id, code: `HR-${String(i).padStart(5, '0')}`, employmentType: h.type, status: 'ACTIVE', availability: 'OFFLINE',
        nationalId: `2${String(90010100000 + i * 7919).padStart(13, '0')}`.slice(0, 14), vehicleType: h.vehicle,
        vehiclePlate: h.vehicle === 'BICYCLE' ? null : `ق ص ${100 + i}`, homeHubId: hubIds.get(h.hub)!,
        perDeliveryRateCents: isShift ? 500 : h.type === 'FULL_TIME' ? 300 : 2200,
        perPickupRateCents: isShift ? 0 : 500, failedAttemptRateCents: isShift ? 0 : 700,
        hourlyRateCents: isShift ? 4500 : 0, monthlySalaryCents: h.type === 'FULL_TIME' ? 900000 : 0,
        cashLimitCents: h.type === 'FULL_TIME' ? 1500000 : 600000,
        lastLat: hub.lat + (Math.random() - 0.5) * 0.02, lastLng: hub.lng + (Math.random() - 0.5) * 0.02,
        walletPhone: phone, xp: 150 * i, rating: 4.4 + (i % 6) / 10, ratingCount: 20 + i * 3,
      })
      .$returningId();
    let primary = true;
    for (const z of h.zones) {
      await db.insert(s.courierZones).values({ courierId: courier.id, zoneId: zoneIds.get(z)!, isPrimary: primary });
      primary = false;
    }
  }
  console.log(`✔ ${heroes.length} delivery heroes (freelance, shift and full-time)`);
}

async function main() {
  assertValidConfig();
  const baseOnly = process.argv.includes('--base');
  await runMigrations(config.databaseUrl);
  const { db, pool } = createDb(config.databaseUrl, { connectionLimit: 2 });
  try {
    await seedBase(db);
  } finally {
    await pool.end();
  }
  if (!baseOnly) {
    const { runDemo } = await import('./demo/run-demo');
    await runDemo();
  }
  console.log(`\n🐢 Seed complete. Demo password for every seeded account: ${DEMO_PASSWORD}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
