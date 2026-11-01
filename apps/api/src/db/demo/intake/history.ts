import { count, eq, like, min, notLike } from 'drizzle-orm';
import { orders } from '../../schema';
import { cairoDateTime, cairoToday } from '../../helpers';
import { OrdersService } from '../../../modules/orders/orders.service';
import { OrderWorkflowService } from '../../../modules/orders/order-workflow.service';
import { CashService } from '../../../modules/cash/cash.service';
import { addHours, backdateCreation, demoPhone, META, NAMES, retimeHandover, retimeLedgerForOrders, rng, type CourierRow, type IntakeCtx } from './context';

/** Sun … Sat — Friday is the quiet day in Egypt, Thursday the busiest. */
const WEEKDAY = [1.05, 1.0, 1.08, 1.02, 1.18, 0.5, 0.8];
const WEEKS = 8;
const PRODUCTS = ['Wireless earbuds', 'Linen shirt', 'Skincare set', 'Power bank', 'Cotton dress', 'Perfume 100ml', 'Smart watch', 'Abaya'];

/**
 * Eight weeks of order history for the demand forecast, through the real
 * order + workflow services (back-dated with `at`, so the delivery-integrity
 * proof rules treat it as history). The operations demo covers the last ~3
 * weeks; this fills the weeks before it. Cash the heroes collected is handed
 * over (one confirmed handover per hero) so custody does not balloon.
 * Idempotent: skipped once HIST- orders exist.
 */
export async function seedForecastHistory(ctx: IntakeCtx): Promise<number> {
  const { db } = ctx;
  const [{ n }] = await db.select({ n: count() }).from(orders).where(like(orders.brandReference, 'HIST-%'));
  if (Number(n) > 0) return Number(n);
  const ordersSvc = ctx.app.get(OrdersService, { strict: false });
  const workflow = ctx.app.get(OrderWorkflowService, { strict: false });
  const cash = ctx.app.get(CashService, { strict: false });
  const r = rng(20261101);

  // Fill from 8 weeks ago up to the day before the operations demo starts.
  const [first] = await db.select({ at: min(orders.createdAt) }).from(orders).where(notLike(orders.brandReference, 'HIST-%'));
  const today = cairoToday(ctx.now);
  const dayStr = (ago: number) => cairoToday(new Date(ctx.now.getTime() - ago * 86_400_000));
  const firstAgo = first?.at ? Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${cairoToday(new Date(first.at))}T00:00:00Z`)) / 86_400_000)) : 0;
  const brands = [...ctx.brands.values()];
  const zones = [...ctx.zones.values()].filter((z) => z.isActive && ctx.heroesByZone.has(z.id));
  const weighted = zones.flatMap((z) => Array(z.tier === 'A' ? 3 : 1).fill(z) as typeof zones);
  if (!brands.length || !weighted.length) return 0;
  const customers = Array.from({ length: 90 }, () => ({ name: r.pick(NAMES), phone: demoPhone(r) }));

  const ids: string[] = [];
  const collectedByHero = new Map<string, { hero: CourierRow; cents: number; last: Date }>();
  let seq = 0;
  for (let ago = WEEKS * 7; ago > firstAgo; ago--) {
    const day = dayStr(ago);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const perDay = Math.max(2, Math.round(13 * WEEKDAY[weekday] * (1 - ago * 0.004) * (0.85 + r.rand() * 0.3)));
    for (let i = 0; i < perDay; i++) {
      const brand = r.pick(brands);
      const zone = r.pick(weighted);
      const hero = r.pick(ctx.heroesByZone.get(zone.id)!);
      const customer = r.pick(customers);
      const created = cairoDateTime(day, `${String(r.between(8, 21)).padStart(2, '0')}:${String(r.between(0, 59)).padStart(2, '0')}`);
      const cod = r.chance(0.82);
      try {
        const ref = await ordersSvc.create(
          {
            brandId: brand.brand.id,
            brandReference: `HIST-${brand.brand.code}-${String(++seq).padStart(4, '0')}`,
            source: r.chance(0.3) ? 'API' : 'PORTAL',
            recipient: { name: customer.name, phone: customer.phone },
            address: { line: `${r.between(1, 120)} ${zone.nameEn} St, ${zone.nameEn}`, building: String(r.between(1, 40)), floor: String(r.between(0, 9)), zoneId: zone.id, lat: zone.centerLat + (r.rand() - 0.5) * 0.02, lng: zone.centerLng + (r.rand() - 0.5) * 0.02 },
            package: { description: r.pick(PRODUCTS), itemsCount: r.between(1, 3), weightGrams: r.between(300, 3500) },
            paymentMethod: cod ? 'COD' : 'PREPAID',
            codAmountCents: cod ? r.pick([180, 250, 320, 450, 600, 780, 950]) * 100 : 0,
          },
          brand.actor,
        );
        ids.push(ref.id);
        await backdateCreation(db, ref.id, created);
        // Risky parcels were cancelled by the brand back then (they would be held for confirmation today).
        if (ref.riskScore >= 60 || r.chance(0.04)) {
          await workflow.transition(ref.id, 'CANCELLED', brand.actor, { reason: 'BRAND_REQUEST', note: 'Customer cancelled before pickup', at: addHours(created, 1) });
          continue;
        }
        await workflow.transition(ref.id, 'RECEIVED_AT_HUB', ctx.staff, { hubId: zone.hubId, note: 'Dropped at the hub by the brand', at: addHours(created, 4) });
        const out = cairoDateTime(dayStr(ago - 1), `${String(r.between(9, 12)).padStart(2, '0')}:${String(r.between(0, 59)).padStart(2, '0')}`);
        await workflow.transition(ref.id, 'OUT_FOR_DELIVERY', ctx.staff, { courierId: hero.id, at: out });
        const heroActor = ctx.heroActor(hero);
        if (r.chance(0.07)) {
          await workflow.transition(ref.id, 'FAILED_ATTEMPT', heroActor, { failure: { reason: 'CUSTOMER_REFUSED' }, note: 'رفض الاستلام', at: addHours(out, 2) });
          await workflow.transition(ref.id, 'RETURN_OUT', heroActor, { courierId: hero.id, at: addHours(out, 26) });
          await workflow.transition(ref.id, 'RETURNED', heroActor, { note: 'Returned to the brand', at: addHours(out, 29) });
          continue;
        }
        const at = addHours(out, 1 + r.rand() * 5);
        const [row] = await db.select({ collect: orders.collectCents }).from(orders).where(eq(orders.id, ref.id));
        await workflow.transition(ref.id, 'DELIVERED', heroActor, { delivery: { collectedCents: row.collect, receivedBy: customer.name }, lat: zone.centerLat, lng: zone.centerLng, at });
        if (row.collect > 0) {
          const acc = collectedByHero.get(hero.id) ?? { hero, cents: 0, last: at };
          acc.cents += row.collect;
          if (at > acc.last) acc.last = at;
          collectedByHero.set(hero.id, acc);
        }
      } catch (err) {
        console.warn('  history order skipped:', (err as Error).message);
      }
    }
  }
  await retimeLedgerForOrders(db, ids);

  // Heroes handed the collected cash in at their hub.
  for (const { hero, cents, last } of collectedByHero.values()) {
    try {
      const h = (await cash.record(
        { courierId: hero.id, amountCents: cents, method: 'CASH_AT_HUB', ...(hero.homeHubId ? { hubId: hero.homeHubId } : {}), notes: 'Cash handed in at the hub (history)' },
        ctx.staffPrincipal,
        META,
      )) as { id: string };
      await retimeHandover(db, h.id, addHours(last, 3));
    } catch (err) {
      console.warn('  history handover skipped:', (err as Error).message);
    }
  }
  return ids.length;
}
