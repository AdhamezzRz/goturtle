import { createHmac } from 'node:crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import { integrationConnections, orders } from '../../schema';
import { IntegrationsService } from '../../../modules/integrations/integrations.service';
import { marketplaceExternalId, type MarketplaceProvider } from '../../../modules/integrations/marketplaces';
import { addHours, backdateCreation, META, type IntakeCtx } from './context';

const SALLA_SECRET = 'demo-salla-webhook-secret';

/** Salla & EasyOrders order webhooks (Brand → Developers → Egyptian stores), delivered through the real signed receivers. */
export async function seedStoreConnections(ctx: IntakeCtx): Promise<{ connections: number; orders: number }> {
  const brand = ctx.brands.get('CGAD') ?? [...ctx.brands.values()][0];
  if (!brand) return { connections: 0, orders: 0 };
  const integrations = ctx.app.get(IntegrationsService, { strict: false });
  const { db } = ctx;

  const ensure = async (provider: MarketplaceProvider, shopDomain: string, credentials: Record<string, string>) => {
    const [found] = await db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.brandId, brand.brand.id), eq(integrationConnections.provider, provider)))
      .limit(1);
    if (found) return found;
    const created = await integrations.create(brand.brand.id, { provider, shopDomain, credentials, settings: { defaultWeightGrams: 800 } }, brand.principal, META);
    const [row] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, created.id)).limit(1);
    return row;
  };
  const salla = await ensure('SALLA', 'cairo-gadgets.salla.sa', { webhookSecret: SALLA_SECRET });
  const easy = await ensure('EASYORDERS', 'cairogadgets.easy-orders.net', {});

  const nasr = ctx.zones.get('CAI-NASR');
  const send = async (provider: MarketplaceProvider, connectionId: string, payload: object, headers: Record<string, string>, createdHoursAgo: number, externalId: string) => {
    const raw = Buffer.from(JSON.stringify(payload));
    const res = await integrations.inboundMarketplace(provider, connectionId, { headers: { ...headers, 'content-type': 'application/json' }, rawBody: raw, body: payload, token: null });
    if (res.action === 'created') {
      const [o] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.brandId, brand.brand.id), eq(orders.externalId, marketplaceExternalId(provider, externalId)))).limit(1);
      if (o) await backdateCreation(db, o.id, addHours(ctx.now, -createdHoursAgo));
    }
    return res;
  };
  const sallaOrder = (id: number, ref: number, name: string, mobile: string, street: string, items: Array<[string, number]>, total: number, cod: boolean) => ({
    event: 'order.created', merchant: 470112, created_at: new Date().toISOString(),
    data: {
      id, reference_id: ref, status: { slug: 'under_review' }, payment_method: cod ? 'cod' : 'credit_card', currency: 'EGP',
      amounts: { total: { amount: total, currency: 'EGP' } },
      customer: { first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' '), mobile: mobile.slice(1), mobile_code: '+20' },
      shipping: { receiver: { name, phone: `+2${mobile}` }, address: { shipping_address: street, block: nasr?.nameEn ?? 'Nasr City', city: 'Cairo', geo_coordinates: { lat: nasr?.centerLat ?? 30.0566, lng: nasr?.centerLng ?? 31.3433 } } },
      items: items.map(([n, q]) => ({ name: n, quantity: q, weight: 0.35 })),
    },
  });
  const sig = (body: object) => ({ 'x-salla-signature': createHmac('sha256', SALLA_SECRET).update(Buffer.from(JSON.stringify(body))).digest('hex') });
  const s1 = sallaOrder(880101, 30451, 'Hana Fathy', '01012345601', '14 Abbas El Akkad St', [['Smart watch S8', 1]], 1899, true);
  const s2 = sallaOrder(880102, 30452, 'Karim Adel', '01112345602', '3 Makram Ebeid St', [['Earbuds Pro', 1], ['USB-C cable', 2]], 1449, false);
  await send('SALLA', salla.id, s1, sig(s1), 30, '880101');
  await send('SALLA', salla.id, s2, sig(s2), 20, '880102');

  const easyOrder = (id: string, short: string, name: string, phone: string, address: string, items: Array<[string, number, number]>, status = 'pending') => ({
    id, short_id: short, full_name: name, phone, government: 'القاهرة', address, payment_method: 'cod', status,
    total_cost: items.reduce((s, [, q, p]) => s + q * p, 0) + 60, shipping_cost: 60, cart_items: items.map(([n, q, p]) => ({ quantity: q, price: p, product: { name: n } })),
  });
  const secret = { secret: easy.inboundSecret };
  await send('EASYORDERS', easy.id, easyOrder('eo-7f3a91c2', 'EO50231', 'محمود سامي', '01223456703', '22 شارع مكرم عبيد، مدينة نصر', [['باور بانك ٢٠٠٠٠', 1, 749]]), secret, 26, 'eo-7f3a91c2');
  await send('EASYORDERS', easy.id, easyOrder('eo-7f3a91c3', 'EO50232', 'نورهان علي', '01523456704', '5 شارع الطيران، مدينة نصر', [['جراب موبايل', 2, 180], ['شاحن سريع', 1, 320]]), secret, 8, 'eo-7f3a91c3');
  // The buyer cancelled the second EasyOrders order in the store — the shipment is cancelled too.
  await send('EASYORDERS', easy.id, easyOrder('eo-7f3a91c3', 'EO50232', 'نورهان علي', '01523456704', '5 شارع الطيران، مدينة نصر', [['جراب موبايل', 2, 180]], 'canceled'), secret, 6, 'eo-7f3a91c3');

  const imported = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.brandId, brand.brand.id), inArray(orders.source, ['SALLA', 'EASYORDERS']), like(orders.externalId, '%:%')));
  return { connections: 2, orders: imported.length };
}
