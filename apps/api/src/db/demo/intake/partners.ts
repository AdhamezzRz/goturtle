import { and, count, eq, gte, like } from 'drizzle-orm';
import type { FailureReason } from '@goturtle/shared';
import { carrierPartners, cities, governorates, orders, zones } from '../../schema';
import { cairoDateTime, cairoToday } from '../../helpers';
import { NetworkService } from '../../../modules/network/network.service';
import { OrdersService } from '../../../modules/orders/orders.service';
import { OrderWorkflowService } from '../../../modules/orders/order-workflow.service';
import { PartnersService } from '../../../modules/partners/partners.service';
import { CashService } from '../../../modules/cash/cash.service';
import { addHours, backdateCreation, demoPhone, META, NAMES, retimeHandover, retimeOrder, rng, type IntakeCtx } from './context';

/** Destinations outside the Greater Cairo fleet, reached through partners. */
const REGIONS = [
  {
    gov: { code: 'ALX', nameEn: 'Alexandria', nameAr: 'الإسكندرية' }, city: { code: 'ALX', nameEn: 'Alexandria', nameAr: 'الإسكندرية' },
    zone: { code: 'ALX-CENTRAL', nameEn: 'Alexandria (Smouha & Sidi Gaber)', nameAr: 'الإسكندرية (سموحة وسيدي جابر)', centerLat: 31.2156, centerLng: 29.9553, keywords: ['alexandria', 'alex', 'الإسكندرية', 'الاسكندرية', 'اسكندرية', 'smouha', 'سموحة', 'sidi gaber', 'سيدي جابر'] },
    streets: ['شارع فوزي معاذ، سموحة', 'طريق الحرية، سيدي جابر', 'شارع ٤٥، سموحة'],
  },
  {
    gov: { code: 'GHR', nameEn: 'Gharbia', nameAr: 'الغربية' }, city: { code: 'TANTA', nameEn: 'Tanta', nameAr: 'طنطا' },
    zone: { code: 'GHR-TANTA', nameEn: 'Tanta', nameAr: 'طنطا', centerLat: 30.7865, centerLng: 31.0004, keywords: ['tanta', 'طنطا', 'gharbia', 'الغربية'] },
    streets: ['شارع البحر، طنطا', 'شارع الجيش، طنطا', 'شارع سعيد، طنطا'],
  },
] as const;

type Step = { outcome: 'DELIVERED' | 'FAILED' | 'RETURNED'; reason?: FailureReason; ref?: string };
interface ShipmentPlan {
  region: 'ALX-CENTRAL' | 'GHR-TANTA' | 'SHB-KHEIMA';
  codEgp: number;
  daysAgo: number;
  /** Partner outcomes after the handoff (empty = still out with the partner; undefined = not handed over yet). */
  steps?: Step[];
}

const PARTNERS: Array<{ code: string; name: string; governorateCodes: string[]; feeCents: number; returnFeeCents: number; trackingUrlTemplate: string; waybill: string; shipments: ShipmentPlan[] }> = [
  {
    code: 'ALEXEX', name: 'Alex Express', governorateCodes: ['ALX', 'BHR', 'MTR'], feeCents: 4_500, returnFeeCents: 1_500,
    trackingUrlTemplate: 'https://track.alexexpress.example/shipments/{tn}', waybill: 'AX',
    shipments: [
      { region: 'ALX-CENTRAL', codEgp: 850, daysAgo: 6, steps: [{ outcome: 'DELIVERED', ref: 'POD-1182' }] },
      { region: 'ALX-CENTRAL', codEgp: 1_299, daysAgo: 5, steps: [{ outcome: 'DELIVERED', ref: 'POD-1190' }] },
      { region: 'ALX-CENTRAL', codEgp: 620, daysAgo: 4, steps: [{ outcome: 'FAILED', reason: 'CUSTOMER_UNREACHABLE' }] },
      { region: 'ALX-CENTRAL', codEgp: 0, daysAgo: 3, steps: [] },
      { region: 'ALX-CENTRAL', codEgp: 450, daysAgo: 1 },
    ],
  },
  {
    code: 'DELTA', name: 'Delta Link Couriers', governorateCodes: ['GHR', 'QAL', 'MNF', 'DK', 'SHR'], feeCents: 3_800, returnFeeCents: 1_000,
    trackingUrlTemplate: 'https://deltalink.example/track?awb={tn}', waybill: 'DL',
    shipments: [
      { region: 'GHR-TANTA', codEgp: 540, daysAgo: 7, steps: [{ outcome: 'DELIVERED', ref: 'DL-POD-77' }] },
      { region: 'SHB-KHEIMA', codEgp: 980, daysAgo: 6, steps: [{ outcome: 'FAILED', reason: 'CUSTOMER_REFUSED', ref: 'refused at door' }] },
      { region: 'GHR-TANTA', codEgp: 720, daysAgo: 5, steps: [{ outcome: 'FAILED', reason: 'CUSTOMER_NOT_PRESENT' }, { outcome: 'DELIVERED', ref: 'DL-POD-91' }] },
      { region: 'SHB-KHEIMA', codEgp: 390, daysAgo: 4, steps: [{ outcome: 'RETURNED', reason: 'WRONG_ADDRESS', ref: 'RTS-12' }] },
      { region: 'GHR-TANTA', codEgp: 660, daysAgo: 2, steps: [] },
      { region: 'SHB-KHEIMA', codEgp: 310, daysAgo: 1 },
    ],
  },
];

export interface PartnerDemoResult {
  partners: number;
  skipped: number;
}

/**
 * Two partner carriers (virtual heroes) with handed-off shipments in mixed
 * outcomes, partner custody and one remittance — all through PartnersService,
 * the workflow and CashService, then back-dated. Idempotent per partner code.
 */
export async function seedPartners(ctx: IntakeCtx): Promise<PartnerDemoResult> {
  const { db } = ctx;
  const res: PartnerDemoResult = { partners: 0, skipped: 0 };
  const network = ctx.app.get(NetworkService, { strict: false });
  const partners = ctx.app.get(PartnersService, { strict: false });
  const ordersSvc = ctx.app.get(OrdersService, { strict: false });
  const workflow = ctx.app.get(OrderWorkflowService, { strict: false });
  const cash = ctx.app.get(CashService, { strict: false });
  const hub = ctx.hubs.get('HUB-NSR') ?? [...ctx.hubs.values()][0];
  if (!hub) return res;
  const r = rng(20261103);

  // Destination network (no hero covers it — parcels consolidate at the Nasr City hub).
  for (const reg of REGIONS) {
    if (ctx.zones.has(reg.zone.code)) continue;
    let [gov] = await db.select().from(governorates).where(eq(governorates.code, reg.gov.code)).limit(1);
    if (!gov) gov = await network.createGovernorate({ ...reg.gov }, ctx.staffPrincipal, META);
    let [city] = await db.select().from(cities).where(eq(cities.code, reg.city.code)).limit(1);
    if (!city) city = await network.createCity({ governorateId: gov.id, ...reg.city }, ctx.staffPrincipal, META);
    await network.createZone({ ...reg.zone, keywords: [...reg.zone.keywords], cityId: city.id, hubId: hub.id, tier: 'D', slaHours: 72 }, ctx.staffPrincipal, META);
    const [z] = await db.select().from(zones).where(eq(zones.code, reg.zone.code)).limit(1);
    ctx.zones.set(z.code, z);
  }

  const brandList = [ctx.brands.get('CGAD'), ctx.brands.get('NILE'), ctx.brands.get('BLOOM')].filter((b): b is NonNullable<typeof b> => !!b);
  if (!brandList.length) return res;
  const dayStr = (ago: number) => cairoToday(new Date(ctx.now.getTime() - ago * 86_400_000));

  for (const p of PARTNERS) {
    let [partner] = await db.select().from(carrierPartners).where(eq(carrierPartners.code, p.code)).limit(1);
    if (!partner) {
      const created = await partners.create({ code: p.code, name: p.name, governorateCodes: p.governorateCodes, feeCents: p.feeCents, returnFeeCents: p.returnFeeCents, trackingUrlTemplate: p.trackingUrlTemplate }, ctx.staffPrincipal, META);
      [partner] = await db.select().from(carrierPartners).where(eq(carrierPartners.id, created.id)).limit(1);
    }
    res.partners++;
    const [{ n }] = await db.select({ n: count() }).from(orders).where(like(orders.brandReference, `PT-${p.code}-%`));
    if (Number(n) > 0) continue; // shipments already seeded

    for (const [i, plan] of p.shipments.entries()) {
      const zone = ctx.zones.get(plan.region);
      if (!zone) continue;
      const reg = REGIONS.find((x) => x.zone.code === plan.region);
      const brand = brandList[i % brandList.length];
      const created = cairoDateTime(dayStr(plan.daysAgo), `${String(r.between(10, 16)).padStart(2, '0')}:${String(r.between(0, 59)).padStart(2, '0')}`);
      try {
        const ref = await ordersSvc.create(
          {
            brandId: brand.brand.id, brandReference: `PT-${p.code}-${i + 1}`, source: 'PORTAL',
            recipient: { name: r.pick(NAMES), phone: demoPhone(r) },
            address: { line: `${r.between(3, 60)} ${reg ? r.pick(reg.streets) : `شارع أحمد عرابي، ${zone.nameAr}`}`, building: String(r.between(1, 30)), floor: String(r.between(1, 8)), zoneId: zone.id },
            package: { description: r.pick(['Smart watch', 'Linen set', 'Skincare set', 'Power bank', 'Perfume']), weightGrams: r.between(400, 2500) },
            paymentMethod: plan.codEgp > 0 ? 'COD' : 'PREPAID',
            codAmountCents: plan.codEgp * 100,
          },
          brand.actor,
        );
        await backdateCreation(db, ref.id, created);
        await workflow.transition(ref.id, 'RECEIVED_AT_HUB', ctx.staff, { hubId: hub.id, note: 'Consolidated for an out-of-network destination', at: addHours(created, 6) });
        if (!plan.steps) continue; // waits in the handoff queue
        // Handoff the next morning, then the partner's outcomes a day apart.
        const handedAt = cairoDateTime(dayStr(Math.max(plan.daysAgo - 1, 0)), '09:30');
        const since = new Date();
        await partners.handoff(partner.id, { orderIds: [ref.id], partnerTrackingNumbers: [`${p.waybill}${String(r.between(100_000, 999_999))}`] }, ctx.staffPrincipal, META);
        const times: Date[] = [handedAt];
        let last: Step['outcome'] | null = null;
        for (const [k, step] of plan.steps.entries()) {
          const out = await partners.updateStatuses(partner.id, { updates: [{ orderId: ref.id, outcome: step.outcome, reason: step.reason, partnerReference: step.ref }] }, ctx.staffPrincipal, META);
          if (!out.results[0]?.ok) throw new Error(out.results[0]?.message ?? 'partner update failed');
          const at = addHours(handedAt, 6 + k * 24);
          // A re-attempt writes its OUT_FOR_DELIVERY first; returns write two events (hub, return pending).
          if (k > 0) times.push(addHours(at, -4));
          times.push(at);
          if (step.outcome === 'RETURNED') times.push(addHours(at, 0.1));
          last = step.outcome;
        }
        const final = times[times.length - 1] < ctx.now ? times : times.map((t) => (t > ctx.now ? addHours(ctx.now, -1) : t));
        await retimeOrder(db, ref.id, since, final);
        const outcomeAt = final[final.length - 1];
        await db.update(orders).set({
          handedToPartnerAt: handedAt, outForDeliveryAt: final[plan.steps.length > 1 ? final.length - 2 : 0],
          ...(last === 'DELIVERED' ? { deliveredAt: outcomeAt } : {}),
        }).where(eq(orders.id, ref.id));
      } catch (err) {
        res.skipped++;
        console.warn(`  partner shipment ${p.code}-${i + 1} skipped:`, (err as Error).message);
      }
    }

    // The partner wired part of the COD it holds.
    if (p.code === 'ALEXEX') {
      const [first] = await db
        .select({ collected: orders.collectedCents, courierId: orders.courierId, deliveredAt: orders.deliveredAt })
        .from(orders)
        .where(and(eq(orders.partnerCarrierId, partner.id), eq(orders.status, 'DELIVERED'), gte(orders.collectedCents, 1)))
        .orderBy(orders.deliveredAt)
        .limit(1);
      if (first?.courierId) {
        try {
          const h = (await cash.record({ courierId: first.courierId, amountCents: first.collected, method: 'BANK_TRANSFER', reference: 'ALEXEX-REMIT-0412', notes: 'Weekly COD remittance from Alex Express' }, ctx.staffPrincipal, META)) as { id: string };
          const at = addHours(first.deliveredAt ?? ctx.now, 20);
          await retimeHandover(db, h.id, at < ctx.now ? at : addHours(ctx.now, -1));
        } catch (err) {
          console.warn('  partner remittance skipped:', (err as Error).message);
        }
      }
    }
  }
  return res;
}
