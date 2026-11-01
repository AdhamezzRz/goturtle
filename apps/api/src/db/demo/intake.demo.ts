/* eslint-disable no-console */
import type { INestApplicationContext } from '@nestjs/common';
import { and, count, eq, inArray, isNotNull, like, sql } from 'drizzle-orm';
import { carrierPartners, cashHandovers, couriers, integrationConnections, orderLinks, orders } from '../schema';
import { cairoToday } from '../helpers';
import { SettingsService } from '../../modules/settings/settings.service';
import type { ForecastEvent } from '../../modules/settings/settings.registry';
import { loadContext, META, syncLedgerEntryTimes, type IntakeCtx } from './intake/context';
import { seedForecastHistory } from './intake/history';
import { seedOrderLinks } from './intake/links';
import { seedStoreConnections } from './intake/stores';
import { seedPartners } from './intake/partners';

/**
 * v1.1 intake & platform demo: order links with buyer orders, EasyOrders and
 * Salla connections with inbound orders, two partner carriers with handed-off
 * shipments, custody and a remittance, 8 weeks of order history for the
 * demand forecast and a few forecast events. Everything goes through the real
 * services and is back-dated; each part is idempotent and failures are logged,
 * never thrown.
 */
export async function seedIntakeDemo(app: INestApplicationContext): Promise<void> {
  const ctx = await loadContext(app);
  if (!ctx) {
    console.log('• intake demo skipped (no brands / staff yet)');
    return;
  }
  const started = Date.now();
  const step = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      console.warn(`  intake demo: ${name} skipped — ${(err as Error).message}`);
      return fallback;
    }
  };
  await step('forecast history', () => seedForecastHistory(ctx), 0);
  const links = await step('order links', () => seedOrderLinks(ctx), { code: null as string | null, links: 0, orders: 0 });
  await step('store connections', () => seedStoreConnections(ctx), { connections: 0, orders: 0 });
  await step('partner carriers', () => seedPartners(ctx), { partners: 0, skipped: 0 });
  const events = await step('forecast events', () => seedForecastEvents(ctx), 0);
  await step('ledger times', () => syncLedgerEntryTimes(ctx.db), undefined);

  const s = await step('summary', () => summarize(ctx), null);
  if (!s) return;
  console.log(
    `✔ intake demo: ${s.links} order links (public /o/${links.code ?? '—'}), ${s.linkOrders} link orders (${s.linkDelivered} delivered), ` +
      `${s.connections} store connections (EasyOrders, Salla) with ${s.storeOrders} inbound orders, ${s.partners} partner carriers with ${s.shipments} shipments ` +
      `(${s.pDelivered} delivered, ${s.pFailed} failed, ${s.pReturned} returning, ${s.pOut} out) + ${s.queued} in the handoff queue, partner custody ${(s.custodyCents / 100).toFixed(0)} EGP & ${s.remittances} remittance, ` +
      `${s.history} history orders (8 weeks), ${events} forecast events — ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

/** White Friday and two more demand events, only when an admin has not set any. */
async function seedForecastEvents(ctx: IntakeCtx): Promise<number> {
  const settings = ctx.app.get(SettingsService, { strict: false });
  const current = await settings.get('platform');
  if (current.forecastEvents.length) return current.forecastEvents.length;
  const today = cairoToday(ctx.now);
  const year = Number(today.slice(0, 4));
  const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  // White Friday = the last Friday of November.
  const whiteFriday = (y: number) => {
    const last = new Date(Date.UTC(y, 10, 30));
    last.setUTCDate(30 - ((last.getUTCDay() + 2) % 7));
    return last.toISOString().slice(0, 10);
  };
  const upcoming = (fn: (y: number) => string) => (fn(year) >= today ? fn(year) : fn(year + 1));
  const wf = upcoming(whiteFriday);
  const singles = upcoming((y) => ymd(y, 11, 11));
  const events: ForecastEvent[] = [
    { name: '11.11 sale', from: singles, to: singles, multiplier: 1.4 },
    { name: 'White Friday week', from: shift(wf, -1), to: shift(wf, 3), multiplier: 2.2 },
    { name: 'Ramadan 2027', from: '2027-02-08', to: '2027-03-09', multiplier: 1.3 },
  ];
  await settings.set('platform', { forecastEvents: events }, ctx.staffPrincipal, META);
  return events.length;
}

async function summarize(ctx: IntakeCtx) {
  const { db } = ctx;
  const n = async (q: Promise<Array<{ n: number | string }>>) => Number((await q)[0]?.n ?? 0);
  const partners = await db.select().from(carrierPartners);
  const partnerIds = partners.map((p) => p.id);
  const vcs = partners.length ? await db.select({ id: couriers.id, cash: couriers.cashOnHandCents }).from(couriers).where(inArray(couriers.code, partners.map((p) => `PT-${p.code}`))) : [];
  const vcIds = vcs.map((v) => v.id);
  const shipments = partnerIds.length
    ? await db.select({ status: orders.status, courierId: orders.courierId }).from(orders).where(and(inArray(orders.partnerCarrierId, partnerIds), isNotNull(orders.handedToPartnerAt)))
    : [];
  const withPartner = (s: (typeof shipments)[number]) => !!s.courierId && vcIds.includes(s.courierId);
  return {
    links: await n(db.select({ n: count() }).from(orderLinks)),
    linkOrders: await n(db.select({ n: count() }).from(orders).where(eq(orders.source, 'ORDER_LINK'))),
    linkDelivered: await n(db.select({ n: count() }).from(orders).where(and(eq(orders.source, 'ORDER_LINK'), eq(orders.status, 'DELIVERED')))),
    connections: await n(db.select({ n: count() }).from(integrationConnections).where(inArray(integrationConnections.provider, ['EASYORDERS', 'SALLA']))),
    storeOrders: await n(db.select({ n: count() }).from(orders).where(inArray(orders.source, ['EASYORDERS', 'SALLA']))),
    partners: partners.length,
    shipments: shipments.length,
    pDelivered: shipments.filter((x) => x.status === 'DELIVERED' && withPartner(x)).length,
    pFailed: shipments.filter((x) => x.status === 'FAILED_ATTEMPT' && withPartner(x)).length,
    pReturned: shipments.filter((x) => ['RETURN_PENDING', 'RETURN_OUT', 'RETURNED'].includes(x.status)).length,
    pOut: shipments.filter((x) => x.status === 'OUT_FOR_DELIVERY' && withPartner(x)).length,
    queued: await n(db.select({ n: count() }).from(orders).where(and(like(orders.brandReference, 'PT-%'), eq(orders.status, 'RECEIVED_AT_HUB')))),
    custodyCents: vcs.reduce((s, v) => s + v.cash, 0),
    remittances: vcIds.length ? await n(db.select({ n: count() }).from(cashHandovers).where(inArray(cashHandovers.courierId, vcIds))) : 0,
    history: await n(db.select({ n: sql<number>`count(*)` }).from(orders).where(like(orders.brandReference, 'HIST-%'))),
  };
}
