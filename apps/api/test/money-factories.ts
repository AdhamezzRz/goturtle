import { and, eq, like } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { generateTrackingNumber, quote, type OrderStatus } from '@goturtle/shared';
import * as s from '../src/db/schema';
import { LedgerService } from '../src/core/ledger/ledger.service';
import { PostingsService } from '../src/core/ledger/postings.service';
import type { AccountRef } from '../src/core/ledger/accounts';
import { OrderWorkflowService } from '../src/modules/orders/order-workflow.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import type { ActorContext } from '../src/common/actor';
import type { TestContext } from './helpers';
import { bearer, tokenFor, type Agent } from './ops-factories';

export const API = '/api/v1';
export const STAFF_ACTOR: ActorContext = { actorType: 'STAFF', actorId: null, name: 'Money e2e' };

type OrderRow = typeof s.orders.$inferSelect;

const phone = (prefix = '+2015') => `${prefix}${String(randomInt(10 ** 8)).padStart(8, '0')}`;

export const ledger = (t: TestContext) => t.app.get(LedgerService);
export const balance = (t: TestContext, ref: AccountRef) => ledger(t).balance(ref);
export const wallet = (t: TestContext, brandId: string) => balance(t, { brandWallet: brandId });

export async function assertBalanced(t: TestContext) {
  const tb = await ledger(t).trialBalance();
  expect(tb.totalDebits).toBe(tb.totalCredits);
  expect(tb.balanced).toBe(true);
}

/** Fresh hero (own custody / payable accounts) with a bearer agent. */
export async function moneyHero(t: TestContext, hubCode = 'HUB-NSR') {
  const [hub] = await t.db.select().from(s.hubs).where(eq(s.hubs.code, hubCode)).limit(1);
  const [u] = await t.db.insert(s.users).values({ name: `Money Hero ${randomInt(1e6)}`, phone: phone(), role: 'COURIER', passwordHash: 'x' }).$returningId();
  const [c] = await t.db
    .insert(s.couriers)
    .values({ userId: u.id, code: `MH-${randomInt(1e8)}`, employmentType: 'FREELANCE', status: 'ACTIVE', homeHubId: hub.id, perDeliveryRateCents: 2000, cashLimitCents: 10_000_000 })
    .$returningId();
  const agent: Agent = bearer(t, await tokenFor(t, u.id, 'COURIER'));
  const reload = async () => (await t.db.select().from(s.couriers).where(eq(s.couriers.id, c.id)).limit(1))[0];
  return { id: c.id, userId: u.id, hubId: hub.id, agent, reload };
}

/** Fresh active brand with an owner (and optional staff) agent. */
export async function moneyBrand(t: TestContext, opts: { withStaff?: boolean } = {}) {
  const code = `M${randomInt(1e8)}`;
  const [b] = await t.db
    .insert(s.brands)
    .values({ code, name: `Money Brand ${code}`, phone: phone('+2011'), status: 'ACTIVE', settlementCycle: 'MONTHLY', payoutMethod: 'INSTAPAY' })
    .$returningId();
  const [owner] = await t.db.insert(s.users).values({ name: `Owner ${code}`, phone: phone('+2011'), role: 'BRAND_OWNER', brandId: b.id, passwordHash: 'x' }).$returningId();
  const brand = { id: b.id, code, ownerUserId: owner.id, owner: bearer(t, await tokenFor(t, owner.id, 'BRAND_OWNER')), staff: null as Agent | null };
  if (opts.withStaff) {
    const [st] = await t.db.insert(s.users).values({ name: `Staff ${code}`, phone: phone('+2011'), role: 'BRAND_STAFF', brandId: b.id, passwordHash: 'x' }).$returningId();
    brand.staff = bearer(t, await tokenFor(t, st.id, 'BRAND_STAFF'));
  }
  return brand;
}

/** Fees exactly as the brand's rate card quotes them (zone CAI-NASR). */
export async function feesOf(t: TestContext, brandId: string, input: { codCents: number; weightGrams?: number; declaredValueCents?: number }) {
  const { card } = await t.app.get(PricingService).rateCardForBrand(brandId);
  const [zone] = await t.db.select().from(s.zones).where(eq(s.zones.code, 'CAI-NASR')).limit(1);
  return quote(card, {
    tier: zone.tier, serviceLevel: 'STANDARD', type: 'DELIVERY', weightGrams: input.weightGrams ?? 1000,
    paymentMethod: input.codCents > 0 ? 'COD' : 'PREPAID', codAmountCents: input.codCents, declaredValueCents: input.declaredValueCents ?? 0, feesPaidBy: 'BRAND',
  });
}

/** Inserts an order row priced with the brand's rate card, in any status. */
export async function insertOrder(
  t: TestContext,
  o: {
    brandId: string; status?: OrderStatus; codCents?: number; courierId?: string | null; hubId?: string | null; weightGrams?: number; declaredValueCents?: number;
    deliveredAt?: Date | null; returnedAt?: Date | null; promisedBy?: Date | null; updatedAt?: Date;
  },
): Promise<OrderRow> {
  const [zone] = await t.db.select().from(s.zones).where(eq(s.zones.code, 'CAI-NASR')).limit(1);
  const [cust] = await t.db.insert(s.customers).values({ phone: phone(), name: 'Money Customer' }).$returningId();
  const cod = o.codCents ?? 0;
  const q = await feesOf(t, o.brandId, { codCents: cod, weightGrams: o.weightGrams, declaredValueCents: o.declaredValueCents });
  const status = o.status ?? 'CREATED';
  const [row] = await t.db
    .insert(s.orders)
    .values({
      trackingNumber: generateTrackingNumber(), brandId: o.brandId, status, customerId: cust.id, recipientName: 'Money Recipient', recipientPhone: phone(),
      addressLine: '1 Abbas El Akkad, Nasr City', zoneId: zone.id, courierId: o.courierId ?? null, hubId: o.hubId ?? null,
      paymentMethod: cod > 0 ? 'COD' : 'PREPAID', codAmountCents: cod, collectCents: cod, collectedCents: status === 'DELIVERED' ? cod : 0,
      weightGrams: o.weightGrams ?? 1000, declaredValueCents: o.declaredValueCents ?? 0,
      shippingFeeCents: q.shippingFeeCents, codFeeCents: q.codFeeCents, extraFeesCents: q.extraFeesCents, vatCents: q.vatCents, totalFeesCents: q.totalFeesCents,
      deliveredAt: status === 'DELIVERED' ? o.deliveredAt ?? new Date() : null, returnedAt: o.returnedAt ?? null, promisedBy: o.promisedBy ?? null,
      ...(o.updatedAt ? { updatedAt: o.updatedAt } : {}),
    })
    .$returningId();
  return (await t.db.select().from(s.orders).where(eq(s.orders.id, row.id)).limit(1))[0];
}

/** A DELIVERED cash order with its real postings (custody, wallet, fees, hero earning). */
export async function deliveredOrder(t: TestContext, o: { brandId: string; codCents: number; courierId: string; deliveredAt?: Date }) {
  const order = await insertOrder(t, { ...o, status: 'DELIVERED' });
  await t.db.transaction(async (tx) => {
    const [courier] = await ledger(t).lockCouriers(tx, [o.courierId]);
    await t.app.get(PostingsService).orderDelivered(tx, order, courier);
  });
  return order;
}

/** An order on the hero's hands, OUT_FOR_DELIVERY, moved there through the real workflow. */
export async function outForDelivery(t: TestContext, o: { brandId: string; codCents: number; hero: { id: string; hubId: string } }) {
  const order = await insertOrder(t, { brandId: o.brandId, codCents: o.codCents });
  const wf = t.app.get(OrderWorkflowService);
  await wf.transition(order.id, 'RECEIVED_AT_HUB', STAFF_ACTOR, { hubId: o.hero.hubId });
  await wf.transition(order.id, 'ASSIGNED', STAFF_ACTOR, { courierId: o.hero.id });
  return wf.transition(order.id, 'OUT_FOR_DELIVERY', STAFF_ACTOR, { courierId: o.hero.id });
}

export async function reloadOrder(t: TestContext, id: string): Promise<OrderRow> {
  return (await t.db.select().from(s.orders).where(eq(s.orders.id, id)).limit(1))[0];
}

/** Ledger lines of one transaction reference as { accountCode: signed debit − credit }. */
export async function postingOf(t: TestContext, reference: string) {
  const rows = await t.db
    .select({ code: s.ledgerAccounts.code, kind: s.ledgerTransactions.kind, debit: s.ledgerEntries.debitCents, credit: s.ledgerEntries.creditCents })
    .from(s.ledgerEntries)
    .innerJoin(s.ledgerTransactions, eq(s.ledgerTransactions.id, s.ledgerEntries.transactionId))
    .innerJoin(s.ledgerAccounts, eq(s.ledgerAccounts.id, s.ledgerEntries.accountId))
    .where(eq(s.ledgerTransactions.reference, reference));
  const lines: Record<string, number> = {};
  for (const r of rows) lines[r.code] = (lines[r.code] ?? 0) + r.debit - r.credit;
  return { kind: rows[0]?.kind ?? null, lines };
}

export async function transactionsLike(t: TestContext, pattern: string) {
  return t.db.select().from(s.ledgerTransactions).where(like(s.ledgerTransactions.reference, pattern));
}

export async function notificationsFor(t: TestContext, userId: string, template: string) {
  return t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.template, template)));
}
