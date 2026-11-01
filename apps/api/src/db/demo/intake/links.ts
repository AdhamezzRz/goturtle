import { and, asc, eq } from 'drizzle-orm';
import { orderLinks, orders } from '../../schema';
import { cairoDateTime, cairoToday } from '../../helpers';
import { OrderLinksService } from '../../../modules/order-links/order-links.service';
import { OrderWorkflowService } from '../../../modules/orders/order-workflow.service';
import type { CreateOrderLinkDto } from '../../../modules/order-links/order-links.dto';
import { addHours, backdateCreation, demoPhone, META, NAMES, retimeLedgerForOrders, rng, type DemoBrand, type IntakeCtx } from './context';

type Outcome = 'delivered' | 'returned' | 'hub' | 'open';

interface LinkSpec {
  brand: string;
  link: CreateOrderLinkDto;
  orders: Array<{ daysAgo: number; outcome: Outcome }>;
  /** Expire the link this many days ago once its orders are in. */
  expiredDaysAgo?: number;
}

const SPECS: LinkSpec[] = [
  {
    brand: 'CGAD',
    link: {
      title: 'Wireless earbuds Pro — early White Friday price', description: 'Active noise cancelling, 30 h battery, 1-year warranty.\nسماعات لاسلكية بعزل ضوضاء وضمان سنة.',
      items: [{ name: 'Earbuds Pro (black)', quantity: 1, priceCents: 129_900 }], weightGrams: 400, allowOpening: true, maxUses: 300, notes: 'Fragile — keep the box upright',
    },
    orders: [
      { daysAgo: 9, outcome: 'delivered' }, { daysAgo: 7, outcome: 'delivered' }, { daysAgo: 6, outcome: 'returned' }, { daysAgo: 5, outcome: 'delivered' },
      { daysAgo: 3, outcome: 'delivered' }, { daysAgo: 1, outcome: 'hub' }, { daysAgo: 0, outcome: 'open' }, { daysAgo: 0, outcome: 'open' },
    ],
  },
  {
    brand: 'CGAD',
    link: { title: 'Power bank 20,000 mAh — flash sale (3 pieces)', items: [{ name: 'Power bank 20,000 mAh', quantity: 1, priceCents: 74_900 }], weightGrams: 600, maxUses: 3 },
    orders: [{ daysAgo: 8, outcome: 'delivered' }, { daysAgo: 8, outcome: 'delivered' }, { daysAgo: 2, outcome: 'hub' }],
  },
  {
    brand: 'CGAD',
    link: {
      title: 'Smart watch bundle — Ramadan offer', items: [{ name: 'Smart watch S8', quantity: 1, priceCents: 189_900 }, { name: 'Silicone strap', quantity: 2, priceCents: 15_000 }],
      weightGrams: 500, allowOpening: true,
    },
    orders: [{ daysAgo: 12, outcome: 'delivered' }, { daysAgo: 11, outcome: 'delivered' }],
    expiredDaysAgo: 4,
  },
  {
    brand: 'CGAD',
    link: { title: 'Phone case + screen protector (paid by InstaPay)', paymentMethod: 'PREPAID', items: [{ name: 'Phone case', quantity: 1, priceCents: 25_000 }, { name: 'Glass screen protector', quantity: 1, priceCents: 12_000 }], weightGrams: 300 },
    orders: [{ daysAgo: 4, outcome: 'delivered' }, { daysAgo: 0, outcome: 'open' }],
  },
  {
    brand: 'NILE',
    link: {
      title: 'طقم كتان صيفي', description: 'قميص + بنطلون كتان مصري ١٠٠٪ — كل المقاسات.\nالاستبدال خلال ١٤ يوم.',
      items: [{ name: 'قميص كتان', quantity: 1, priceCents: 65_000 }, { name: 'بنطلون كتان', quantity: 1, priceCents: 55_000 }], weightGrams: 900, allowOpening: true, maxUses: 200,
    },
    orders: [{ daysAgo: 10, outcome: 'delivered' }, { daysAgo: 6, outcome: 'delivered' }, { daysAgo: 0, outcome: 'open' }],
  },
];

const ZONES = ['CAI-NASR', 'CAI-MAADI', 'GIZ-DOKKI', 'CAI-ZAMALEK', 'GIZ-MOHANDESSIN', 'NCAI-TAGAMOA'];

/**
 * Order links for social sellers with orders placed through the public form
 * (OrderLinksService.submit — the real buyer path), then carried through the
 * real workflow back-dated. Returns the public code of the main open link.
 * Idempotent: skipped once the main demo brand has links.
 */
export async function seedOrderLinks(ctx: IntakeCtx): Promise<{ code: string | null; links: number; orders: number }> {
  const { db } = ctx;
  const main = ctx.brands.get('CGAD') ?? [...ctx.brands.values()][0];
  if (!main) return { code: null, links: 0, orders: 0 };
  const existing = await db.select().from(orderLinks).where(eq(orderLinks.brandId, main.brand.id)).orderBy(asc(orderLinks.createdAt));
  if (existing.length) {
    const open = existing.find((l) => l.title === SPECS[0].link.title) ?? existing[0];
    return { code: open.code, links: (await db.select({ id: orderLinks.id }).from(orderLinks)).length, orders: (await db.select({ id: orders.id }).from(orders).where(eq(orders.source, 'ORDER_LINK'))).length };
  }
  const links = ctx.app.get(OrderLinksService, { strict: false });
  const workflow = ctx.app.get(OrderWorkflowService, { strict: false });
  const r = rng(20261102);
  const zones = ZONES.map((c) => ctx.zones.get(c)).filter((z): z is NonNullable<typeof z> => !!z && ctx.heroesByZone.has(z.id));
  if (!zones.length) return { code: null, links: 0, orders: 0 };
  const today = cairoToday(ctx.now);
  const dayStr = (ago: number) => cairoToday(new Date(ctx.now.getTime() - ago * 86_400_000));
  let mainCode: string | null = null;
  let linkCount = 0;
  const placedIds: string[] = [];

  for (const spec of SPECS) {
    const brand: DemoBrand | undefined = ctx.brands.get(spec.brand);
    if (!brand) continue;
    try {
      const expires = spec.expiredDaysAgo !== undefined ? new Date(ctx.now.getTime() + 30 * 86_400_000).toISOString() : undefined;
      const link = await links.create(brand.principal, brand.brand.id, { ...spec.link, ...(expires ? { expiresAt: expires } : {}) }, META);
      linkCount++;
      if (!mainCode && brand === main) mainCode = link.code;
      await db.update(orderLinks).set({ createdAt: cairoDateTime(dayStr(14), '11:30') }).where(eq(orderLinks.id, link.id));
      for (const o of spec.orders) {
        const zone = r.pick(zones);
        const name = r.pick(NAMES);
        const created = o.daysAgo === 0
          ? addHours(ctx.now, -(1 + r.rand() * 3))
          : cairoDateTime(dayStr(o.daysAgo), `${String(r.between(10, 22)).padStart(2, '0')}:${String(r.between(0, 59)).padStart(2, '0')}`);
        try {
          const placed = await links.submit(link.code, {
            name, phone: demoPhone(r), addressLine: `${r.between(2, 90)} شارع ${r.pick(['التسعين', 'النصر', 'مصطفى النحاس', 'عباس العقاد', 'شهاب', 'الثورة'])}، ${zone.nameAr}`,
            building: String(r.between(1, 40)), floor: String(r.between(1, 9)), apartment: String(r.between(1, 20)), zoneId: zone.id,
            notes: r.chance(0.4) ? r.pick(['اتصل قبل ما توصل', 'Call before arriving', 'الدور الأخير مفيش أسانسير']) : undefined,
          }, META);
          const [row] = await db.select({ id: orders.id, collect: orders.collectCents }).from(orders).where(eq(orders.trackingNumber, placed.trackingNumber));
          placedIds.push(row.id);
          await backdateCreation(db, row.id, created);
          await carry(ctx, workflow, row.id, row.collect, zone, created, o.outcome, today, r);
        } catch (err) {
          console.warn('  link order skipped:', (err as Error).message);
        }
      }
      if (spec.expiredDaysAgo !== undefined) {
        await links.update(brand.principal, link.id, { expiresAt: cairoDateTime(dayStr(spec.expiredDaysAgo), '23:59').toISOString() }, META);
      }
    } catch (err) {
      console.warn('  order link skipped:', (err as Error).message);
    }
  }
  await retimeLedgerForOrders(db, placedIds);
  return { code: mainCode, links: linkCount, orders: placedIds.length };
}

async function carry(
  ctx: IntakeCtx, workflow: OrderWorkflowService, id: string, collect: number, zone: { id: string; hubId: string | null; centerLat: number; centerLng: number }, created: Date,
  outcome: Outcome, today: string, r: ReturnType<typeof rng>,
) {
  if (outcome === 'open') return;
  await workflow.transition(id, 'RECEIVED_AT_HUB', ctx.staff, { hubId: zone.hubId, note: 'Picked up from the brand and sorted', at: addHours(created, 5) });
  if (outcome === 'hub') return;
  const hero = r.pick(ctx.heroesByZone.get(zone.id)!);
  const heroActor = ctx.heroActor(hero);
  let out = addHours(created, 18);
  if (cairoToday(out) >= today) out = addHours(ctx.now, -6);
  await workflow.transition(id, 'OUT_FOR_DELIVERY', ctx.staff, { courierId: hero.id, at: out });
  if (outcome === 'returned') {
    await workflow.transition(id, 'FAILED_ATTEMPT', heroActor, { failure: { reason: 'CUSTOMER_REFUSED' }, note: 'العميل غير رأيه', lat: zone.centerLat, lng: zone.centerLng, at: addHours(out, 2) });
    await workflow.transition(id, 'RETURN_OUT', heroActor, { courierId: hero.id, at: addHours(out, 24) });
    await workflow.transition(id, 'RETURNED', heroActor, { note: 'Returned to the brand', at: addHours(out, 27) });
    return;
  }
  await workflow.transition(id, 'DELIVERED', heroActor, { delivery: { collectedCents: collect }, lat: zone.centerLat, lng: zone.centerLng, at: addHours(out, 1 + r.rand() * 3) });
  await ctx.db.update(orders).set({ rating: r.pick([5, 5, 4, 5]) }).where(and(eq(orders.id, id), eq(orders.status, 'DELIVERED')));
}
