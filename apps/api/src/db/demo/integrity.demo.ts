/* eslint-disable no-console */
import type { INestApplicationContext } from '@nestjs/common';
import { and, count, eq, inArray, like, sql } from 'drizzle-orm';
import { normalizeEgyptPhone, ROLE_PERMISSIONS, type FailureReason } from '@goturtle/shared';
import type { Db } from '../client';
import {
  brandLocations, brands, callLogs, couriers, customers, deliveryAttempts, inboundMessages, ledgerEntries, ledgerTransactions, notifications,
  orderEvents, orders, users, zones,
} from '../schema';
import { DB } from '../../core/database.module';
import type { ActorContext } from '../../common/actor';
import type { Principal } from '../../common/principal';
import { newId } from '../columns';
import { withDeadlockRetry } from '../helpers';
import { OrdersService } from '../../modules/orders/orders.service';
import { OrderWorkflowService } from '../../modules/orders/order-workflow.service';
import { CustomersService } from '../../modules/customers/customers.service';
import { ConfirmationService } from '../../modules/delivery-integrity/confirmation.service';
import { HoldsService } from '../../modules/delivery-integrity/holds.service';
import { AttemptsService } from '../../modules/delivery-integrity/attempts.service';
import { InboundService } from '../../modules/delivery-integrity/inbound.service';
import { AddressBookService } from '../../modules/address-book/address-book.service';

/**
 * Delivery-integrity demo (v1.1), created through the real services so holds,
 * timelines, tickets, ledger penalties and the address book are consistent:
 *
 *  - confirmations: pending (one blocking dispatch), confirmed / rescheduled by
 *    WhatsApp, confirmed by a phone call, declined by SMS / link, no response →
 *    ON_HOLD UNCONFIRMED; a WhatsApp shared location; an unmatched SMS
 *  - prepay holds: a prepay-only phone and a blocklisted phone (Cairo Gadgets)
 *  - network risk: one phone declining across three brands, a blocked customer
 *    with a reason, a prepay-only customer
 *  - failed attempts with call logs for three heroes (careful / careless / mixed),
 *    a customer-confirmed attempt, an open dispute (WhatsApp "٢"), an upheld
 *    dispute with a PENALTY adjustment and a rejected dispute
 *  - a verified pin from a Nile Threads delivery reused on a Bloom Beauty order
 *
 * Heroes HR-00003, HR-00006 and HR-00007 are used; HR-00001 (today's demo
 * runsheet) is never touched. Idempotent: skipped when "INT-" orders exist.
 */

const REF = 'INT-';
const H = 3_600_000;
const MIN = 60_000;

type Brand = typeof brands.$inferSelect;
type Zone = typeof zones.$inferSelect;
type Ref = { id: string; trackingNumber: string; riskScore: number };
type CallOutcome = 'NO_ANSWER' | 'BUSY' | 'ANSWERED';

const ago = (ms: number) => new Date(Date.now() - ms);
const e164 = (local: string) => normalizeEgyptPhone(local)!;
const LINK_CUSTOMER: ActorContext = { actorType: 'CUSTOMER', actorId: null, name: 'Customer (link)' };

export async function seedIntegrityDemo(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const [{ n: done }] = await db.select({ n: count() }).from(orders).where(like(orders.brandReference, `${REF}%`));
  if (Number(done) > 0) {
    console.log('• integrity demo already seeded — skipping');
    return;
  }

  const brandRows = await db.select().from(brands).where(eq(brands.status, 'ACTIVE'));
  const byCode = (code: string) => brandRows.find((b) => b.code === code);
  const NILE = byCode('NILE');
  const CGAD = byCode('CGAD');
  const BLOOM = byCode('BLOOM');
  const zoneRows = await db.select().from(zones);
  const zone = (code: string) => zoneRows.find((z) => z.code === code);
  const NASR = zone('CAI-NASR');
  const HELIO = zone('CAI-HELIO');
  const DOKKI = zone('GIZ-DOKKI');
  const ZAMALEK = zone('CAI-ZAMALEK');
  const heroRows = await db.select().from(couriers).where(inArray(couriers.code, ['HR-00003', 'HR-00006', 'HR-00007']));
  const [opsUser] = await db.select().from(users).where(eq(users.role, 'OPS_MANAGER')).limit(1);
  const [superUser] = await db.select().from(users).where(eq(users.role, 'SUPER_ADMIN')).limit(1);
  const staffUser = opsUser ?? superUser;
  if (!NILE || !CGAD || !BLOOM || !NASR || !HELIO || !DOKKI || !ZAMALEK || heroRows.length < 3 || !staffUser) {
    console.log('• integrity demo: base network / demo brands missing — skipped');
    return;
  }

  const ordersSvc = app.get(OrdersService, { strict: false });
  const workflow = app.get(OrderWorkflowService, { strict: false });
  const customersSvc = app.get(CustomersService, { strict: false });
  const confirmations = app.get(ConfirmationService, { strict: false });
  const holds = app.get(HoldsService, { strict: false });
  const attempts = app.get(AttemptsService, { strict: false });
  const inbound = app.get(InboundService, { strict: false });
  const addressBook = app.get(AddressBookService, { strict: false });

  const staff: ActorContext = { actorType: 'STAFF', actorId: staffUser.id, name: staffUser.name };
  const staffPrincipal: Principal = {
    kind: 'user', userId: staffUser.id, name: staffUser.name, role: staffUser.role, actorType: 'STAFF',
    brandId: null, courierId: null, hubId: null, permissions: ROLE_PERMISSIONS[staffUser.role],
  };
  const meta = { ip: null, userAgent: 'demo-seed' };
  const owners = await db.select().from(users).where(and(eq(users.role, 'BRAND_OWNER'), inArray(users.brandId, [NILE.id, CGAD.id, BLOOM.id])));
  const brandActor = (b: Brand): ActorContext => {
    const o = owners.find((u) => u.brandId === b.id);
    return { actorType: 'BRAND', actorId: o?.id ?? null, name: o?.name ?? b.name, brandId: b.id };
  };
  const heroNames = new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, heroRows.map((h) => h.userId)))).map((u) => [u.id, u.name]));
  const heroActor = (courierId: string): ActorContext => {
    const h = heroRows.find((x) => x.id === courierId)!;
    return { actorType: 'COURIER', actorId: h.userId, name: heroNames.get(h.userId) ?? h.code, courierId };
  };
  const locations = await db.select().from(brandLocations).where(eq(brandLocations.isDefault, true));
  const hero = (code: string) => heroRows.find((h) => h.code === code)!;
  const A = hero('HR-00003'); // careful hero (Nasr City)
  const B = hero('HR-00007'); // careless hero (Dokki / Zamalek)
  const C = hero('HR-00006'); // mixed (Dokki / Zamalek)

  const stats = { orders: 0, pending: 0, confirmed: 0, declined: 0, noResponse: 0, unconfirmedHolds: 0, prepayHolds: 0, disputesOpen: 0, disputesResolved: 0, calls: 0, pinsReused: 0, errors: 0 };
  const mine: string[] = [];
  let seq = 0;

  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 5) console.warn(`  integrity demo step "${label}" skipped:`, (err as Error).message);
    }
  };

  /** Creates an order through OrdersService (as the brand) and back-dates its creation. */
  async function order(
    b: Brand,
    z: Zone,
    o: { name: string; phone: string; line: string; cod: number; pin?: { lat: number; lng: number } | null; desc?: string; createdAgo?: number; building?: string },
  ): Promise<Ref> {
    seq++;
    const ref = await ordersSvc.create(
      {
        brandId: b.id,
        brandReference: `${REF}${b.code}-${String(seq).padStart(3, '0')}`,
        source: 'PORTAL',
        recipient: { name: o.name, phone: o.phone },
        address: {
          line: o.line, building: o.building ?? String(3 + seq), floor: String(1 + (seq % 9)), apartment: String(2 + (seq % 14)),
          zoneId: z.id, lat: o.pin?.lat ?? null, lng: o.pin?.lng ?? null,
        },
        package: { description: o.desc ?? 'Parcel', itemsCount: 1, weightGrams: 900 },
        paymentMethod: 'COD',
        codAmountCents: o.cod * 100,
        pickupLocationId: locations.find((l) => l.brandId === b.id)?.id ?? null,
      },
      brandActor(b),
    );
    stats.orders++;
    mine.push(ref.id);
    // The order.created listeners (address book, prepayment rule) also run asynchronously; running them here
    // (both are idempotent and lock the order row) keeps the seed deterministic before back-dating.
    await withDeadlockRetry(() => addressBook.captureOrderAddress(ref.id));
    await withDeadlockRetry(() => holds.applyPrepaymentRule(ref.id));
    const createdAt = ago(o.createdAgo ?? 2 * H);
    await withDeadlockRetry(async () => {
      await db.update(orders).set({ createdAt }).where(eq(orders.id, ref.id));
      await db.update(orderEvents).set({ createdAt }).where(and(eq(orderEvents.orderId, ref.id), eq(orderEvents.status, 'CREATED')));
      // A prepayment hold happened right after creation.
      const heldAt = new Date(createdAt.getTime() + MIN);
      const held = await db.update(orderEvents).set({ createdAt: heldAt }).where(and(eq(orderEvents.orderId, ref.id), eq(orderEvents.status, 'ON_HOLD')));
      if ((held as unknown as [{ affectedRows: number }])[0]?.affectedRows) await holds.patchMeta(db, ref.id, { heldAt: heldAt.toISOString() });
    });
    return { id: ref.id, trackingNumber: ref.trackingNumber, riskScore: ref.riskScore };
  }

  /** A recipient with a refusal history (COD risk above the hold threshold). */
  async function riskyCustomer(name: string, local: string, refused: number) {
    await db
      .insert(customers)
      .values({ phone: e164(local), name, totalOrders: refused, refusedOrders: refused, reliabilityScore: Math.round((4 / (refused + 5)) * 100) })
      .onDuplicateKeyUpdate({ set: { name } });
    return local;
  }

  const statusOf = async (id: string) => (await db.select({ s: orders.status }).from(orders).where(eq(orders.id, id)))[0]?.s;
  const toHub = (id: string, z: Zone, at: Date) => workflow.transition(id, 'RECEIVED_AT_HUB', staff, { hubId: z.hubId, at, isPublic: true });
  const near = (z: Zone, dLat: number, dLng: number) => ({ lat: Math.round((z.centerLat + dLat) * 1e6) / 1e6, lng: Math.round((z.centerLng + dLng) * 1e6) / 1e6 });
  const whatsapp = (phone: string, text: string | null, location?: { lat: number; lng: number }) =>
    inbound.handle({ channel: 'WHATSAPP', from: phone.replace('+', ''), providerMessageId: `wamid.demo.${newId()}`, text, location: location ?? null, payload: { type: location ? 'location' : 'text', demo: true } });
  const sms = (phone: string, text: string) => inbound.handle({ channel: 'SMS', from: phone, providerMessageId: `sms.demo.${newId()}`, text, payload: { gateway: 'demo' } });

  /** Back-dates a confirmation request (order field, timeline note and the message). */
  async function backdateRequest(orderId: string, at: Date) {
    await withDeadlockRetry(async () => {
      await db.update(orders).set({ confirmationRequestedAt: at }).where(eq(orders.id, orderId));
      await db.update(orderEvents).set({ createdAt: at }).where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.reason, 'CONFIRMATION_REQUESTED')));
      await db.update(notifications).set({ createdAt: at }).where(and(eq(notifications.orderId, orderId), eq(notifications.template, 'confirm_delivery')));
    });
  }

  /** Logged calls (provider history), `minutesBefore` the attempt. */
  async function calls(orderId: string, courierId: string, at: Date, minutesBefore: number[], outcomes: CallOutcome[] = []) {
    if (!minutesBefore.length) return;
    await db.insert(callLogs).values(
      minutesBefore.map((m, i) => {
        const startedAt = new Date(at.getTime() - m * MIN);
        const status = outcomes[i] ?? 'NO_ANSWER';
        return { orderId, courierId, provider: 'direct', status, durationSeconds: status === 'ANSWERED' ? 35 : 0, startedAt, endedAt: new Date(startedAt.getTime() + 40_000), createdAt: startedAt };
      }),
    );
    stats.calls += minutesBefore.length;
  }

  /** Hub → assigned → out for delivery → failed attempt at a position → back at the hub. Returns the attempt id. */
  async function failedRun(
    r: Ref,
    z: Zone,
    courierId: string,
    o: { outAgo: number; failAfterMin: number; reason: FailureReason; position: { lat: number; lng: number } | null; callsBefore: number[]; outcomes?: CallOutcome[]; note?: string },
  ) {
    const outAt = ago(o.outAgo);
    const failAt = new Date(outAt.getTime() + o.failAfterMin * MIN);
    await toHub(r.id, z, new Date(outAt.getTime() - 2 * H));
    await workflow.transition(r.id, 'ASSIGNED', staff, { courierId, at: new Date(outAt.getTime() - 30 * MIN) });
    await workflow.transition(r.id, 'OUT_FOR_DELIVERY', heroActor(courierId), { at: outAt });
    await calls(r.id, courierId, failAt, o.callsBefore, o.outcomes);
    await workflow.transition(r.id, 'FAILED_ATTEMPT', heroActor(courierId), {
      at: failAt, lat: o.position?.lat ?? null, lng: o.position?.lng ?? null, note: o.note ?? null, failure: { reason: o.reason },
    });
    await workflow.transition(r.id, 'RECEIVED_AT_HUB', staff, { hubId: z.hubId, clearRunsheet: true, at: new Date(failAt.getTime() + 2 * H), note: 'Back at the hub after a failed attempt', isPublic: false });
    const [a] = await db
      .select({ id: deliveryAttempts.id })
      .from(deliveryAttempts)
      .where(and(eq(deliveryAttempts.orderId, r.id), eq(deliveryAttempts.success, false)))
      .orderBy(sql`${deliveryAttempts.createdAt} desc`)
      .limit(1);
    return a.id;
  }

  // ------------------------------------------------------------------ network rules & prepay holds
  await step('prepay-only customer', async () => {
    const local = '01055501234';
    await db.insert(customers).values({ phone: e164(local), name: 'نرمين فوزي', totalOrders: 5, deliveredOrders: 1, refusedOrders: 4, reliabilityScore: 50 }).onDuplicateKeyUpdate({ set: { name: 'نرمين فوزي' } });
    const [c] = await db.select().from(customers).where(eq(customers.phone, e164(local)));
    await customersSvc.setPrepayment(c.id, true, 'Refused COD with three brands — prepay only', staffPrincipal, meta);
    const r = await order(CGAD, NASR, { name: 'نرمين فوزي', phone: local, line: '27 شارع مكرم عبيد، مدينة نصر', cod: 1450, desc: 'Smart watch', createdAgo: 5 * H });
    if ((await statusOf(r.id)) === 'ON_HOLD') stats.prepayHolds++;
  });

  await step('blocked customer', async () => {
    const local = '01266604321';
    const first = await order(NILE, HELIO, { name: 'Sherif Adel', phone: local, line: '14 El Merghany St, Heliopolis', cod: 650, desc: 'Linen shirt', createdAgo: 3 * 24 * H });
    await workflow.transition(first.id, 'CANCELLED', brandActor(NILE), { reason: 'BRAND_REQUEST', note: 'Customer stopped answering — cancelled before pickup', at: ago(3 * 24 * H - 3 * H) });
    const [c] = await db.select().from(customers).where(eq(customers.phone, e164(local)));
    await db.update(customers).set({ refusedOrders: 3, totalOrders: 4, reliabilityScore: 50 }).where(eq(customers.id, c.id));
    await customersSvc.setBlocked(c.id, true, 'Fake orders — refused 3 COD parcels and abused the hero', staffPrincipal, meta, false);
    // A new COD order to a blocklisted phone scores above the prepay threshold → held for prepayment.
    const r = await order(CGAD, HELIO, { name: 'Sherif Adel', phone: local, line: '14 El Merghany St, Heliopolis', cod: 2400, desc: 'Gaming mouse', createdAgo: 4 * H });
    if ((await statusOf(r.id)) === 'ON_HOLD') stats.prepayHolds++;
  });

  await step('cross-brand decliner', async () => {
    const local = '01144407788';
    const name = 'هاني شوقي';
    const line = '9 شارع عباس العقاد، مدينة نصر';
    const a = await order(NILE, NASR, { name, phone: local, line, cod: 1650, desc: 'Abaya', createdAgo: 30 * H });
    await confirmations.requestDue(new Date(), [a.id]);
    await backdateRequest(a.id, ago(29 * H));
    if ((await sms(e164(local), 'الغي الطلب مش عايزه')).applied) stats.declined++;
    const b = await order(BLOOM, NASR, { name, phone: local, line, cod: 1890, desc: 'Perfume 100ml', createdAgo: 20 * H });
    await confirmations.requestDue(new Date(), [b.id]);
    await backdateRequest(b.id, ago(19 * H));
    if ((await confirmations.respond(b.id, { action: 'DECLINE', channel: 'LINK', note: 'Ordered by mistake', actor: LINK_CUSTOMER })).changed) stats.declined++;
    // Third brand: now high risk, waiting for an answer at the hub and blocked from dispatch.
    const c = await order(CGAD, NASR, { name, phone: local, line, cod: 2200, desc: 'Power bank 20,000mAh', createdAgo: 6 * H });
    await toHub(c.id, NASR, ago(3 * H));
    await confirmations.requestDue(new Date(), [c.id]);
    await backdateRequest(c.id, ago(2 * H));
    stats.pending++;
  });

  // ------------------------------------------------------------------ confirmations (Cairo Gadgets = main brand demo account)
  await step('confirmations', async () => {
    const confirmed = await order(CGAD, NASR, { name: 'Youssef Galal', phone: '01011122233', line: '33 Makram Ebeid St, Nasr City', cod: 1899, desc: 'Wireless earbuds', createdAgo: 8 * H });
    await confirmations.requestDue(new Date(), [confirmed.id]);
    await backdateRequest(confirmed.id, ago(7 * H));
    if ((await whatsapp(e164('01011122233'), '1')).applied) stats.confirmed++;

    const moved = await order(CGAD, HELIO, { name: 'سلمى الشريف', phone: '01522233344', line: '5 شارع الثورة، مصر الجديدة', cod: 3200, desc: 'Phone case + charger', createdAgo: 9 * H });
    await confirmations.requestDue(new Date(), [moved.id]);
    await backdateRequest(moved.id, ago(8 * H));
    if ((await whatsapp(e164('01522233344'), '٢ بكره بعد العصر لو سمحت')).applied) stats.confirmed++;

    const byPhone = await order(NILE, NASR, { name: 'Dina Mansour', phone: '01277788899', line: '41 Abbas El Akkad St, Nasr City', cod: 2450, desc: 'Denim jacket', createdAgo: 10 * H });
    await confirmations.requestDue(new Date(), [byPhone.id]);
    await backdateRequest(byPhone.id, ago(9 * H));
    if ((await confirmations.respond(byPhone.id, { action: 'CONFIRM', channel: 'PHONE', note: 'Called — at home after 5 pm', actor: staff })).changed) stats.confirmed++;

    const declined = await order(CGAD, HELIO, { name: 'Tarek Hamdy', phone: '01099988877', line: '22 Baghdad St, Korba, Heliopolis', cod: 4500, desc: 'Smart watch', createdAgo: 12 * H });
    await confirmations.requestDue(new Date(), [declined.id]);
    await backdateRequest(declined.id, ago(11 * H));
    if ((await sms(e164('01099988877'), 'cancel please, I bought it from the store')).applied) stats.declined++;

    // A shared WhatsApp location for an order without a pin, still awaiting the answer.
    const located = await order(CGAD, NASR, { name: 'عمر حجازي', phone: '01188877766', line: 'عمارات العبور، صلاح سالم، مدينة نصر', cod: 1750, desc: 'Bluetooth speaker', createdAgo: 3 * H });
    await confirmations.requestDue(new Date(), [located.id]);
    await backdateRequest(located.id, ago(150 * MIN));
    await whatsapp(e164('01188877766'), 'ده اللوكيشن', near(NASR, 0.0042, -0.0035));
    stats.pending++;

    // Low risk but high COD: waiting for the customer.
    const waiting = await order(NILE, HELIO, { name: 'Laila Kamal', phone: '01555566677', line: '18 El Nozha St, Heliopolis', cod: 2100, desc: 'Cotton dress', createdAgo: 90 * MIN });
    await confirmations.requestDue(new Date(), [waiting.id]);
    stats.pending++;

    // A reply nobody could match (unknown sender).
    await sms('+201000123456', 'مين معايا؟ وصلني رقمكم');
  });

  // ------------------------------------------------------------------ no response → ON_HOLD UNCONFIRMED
  await step('no-response holds', async () => {
    const s = await holds.config();
    const atHub = await order(CGAD, NASR, { name: 'Rami Fathy', phone: await riskyCustomer('Rami Fathy', '01277300637', 4), line: 'Villa 4, 7th district, Nasr City', cod: 950, desc: 'Gaming mouse', createdAgo: 26 * H });
    await toHub(atHub.id, NASR, ago(24 * H));
    const created = await order(CGAD, NASR, { name: 'مصطفى عزت', phone: await riskyCustomer('مصطفى عزت', '01033344455', 3), line: '7 شارع يوسف عباس، مدينة نصر', cod: 1250, desc: 'Phone case + charger', createdAgo: 25 * H });
    const quiet = await order(BLOOM, HELIO, { name: 'Habiba Samir', phone: '01244455566', line: '3 Thawra St, Heliopolis', cod: 1990, desc: 'Skincare set', createdAgo: 25 * H });
    const ids = [atHub.id, created.id, quiet.id];
    await confirmations.requestDue(new Date(), ids);
    for (const id of ids) await backdateRequest(id, ago((s.noResponseAfterHours + 2) * H));
    const out = await confirmations.expireDue(new Date(), ids);
    stats.noResponse += out.noResponse;
    stats.unconfirmedHolds += out.held;
    // The holds look like they happened when the answer window closed.
    await db.update(orderEvents).set({ createdAt: ago(2 * H) }).where(and(inArray(orderEvents.orderId, ids), inArray(orderEvents.reason, ['CONFIRMATION_NO_RESPONSE', 'UNCONFIRMED'])));
    for (const id of ids) if ((await statusOf(id)) === 'ON_HOLD') await holds.patchMeta(db, id, { heldAt: ago(2 * H).toISOString() });
  });

  // ------------------------------------------------------------------ attempts, calls and disputes
  await step('attempt history', async () => {
    // Older attempts (outside the dispute window) so the hero scores have substance.
    const history: Array<{ h: typeof A; z: Zone; days: number; far: boolean; calls: number[]; name: string }> = [
      { h: A, z: NASR, days: 3, far: false, calls: [14, 8, 3], name: 'Ahmed Saleh' },
      { h: A, z: NASR, days: 5, far: false, calls: [12, 5], name: 'منى جابر' },
      { h: B, z: DOKKI, days: 2, far: true, calls: [], name: 'Karim Ezzat' },
      { h: B, z: ZAMALEK, days: 4, far: true, calls: [2], name: 'نور حسن' },
      { h: C, z: DOKKI, days: 3, far: false, calls: [9, 4], name: 'Amr Shaker' },
    ];
    for (const [i, x] of history.entries()) {
      const pin = near(x.z, 0.002 * (i % 3), -0.0015);
      const r = await order(i % 2 ? NILE : CGAD, x.z, { name: x.name, phone: `0101234${5600 + i}`, line: `${10 + i} Main St, ${x.z.nameEn}`, cod: 420 + i * 90, pin, createdAgo: (x.days + 1) * 24 * H });
      await failedRun(r, x.z, x.h.id, {
        outAgo: x.days * 24 * H, failAfterMin: 70, reason: i % 2 ? 'CUSTOMER_NOT_PRESENT' : 'CUSTOMER_UNREACHABLE',
        position: x.far ? { lat: pin.lat + 0.0095, lng: pin.lng + 0.004 } : { lat: pin.lat + 0.0007, lng: pin.lng + 0.0004 }, callsBefore: x.calls,
      });
    }
  });

  await step('attempt confirmed by the customer', async () => {
    const pin = near(NASR, -0.003, 0.002);
    const r = await order(CGAD, NASR, { name: 'Farida Mahmoud', phone: '01066677788', line: '12 Hassan El Maamoun St, Nasr City', cod: 780, pin, createdAgo: 20 * H });
    await failedRun(r, NASR, A.id, {
      outAgo: 6 * H, failAfterMin: 40, reason: 'CUSTOMER_NOT_PRESENT', position: { lat: pin.lat + 0.0006, lng: pin.lng - 0.0004 },
      callsBefore: [11, 6], outcomes: ['NO_ANSWER', 'BUSY'], note: 'Doorman said she is travelling',
    });
    await whatsapp(e164('01066677788'), '1 صح أنا كنت مسافرة');
  });

  await step('open dispute', async () => {
    const pin = near(DOKKI, 0.0012, 0.0021);
    const r = await order(CGAD, DOKKI, { name: 'ياسمين عبد الرحمن', phone: '01522211100', line: '8 شارع مصدق، الدقي', cod: 1350, pin, desc: 'Wireless earbuds', createdAgo: 22 * H });
    await failedRun(r, DOKKI, B.id, { outAgo: 9 * H, failAfterMin: 35, reason: 'CUSTOMER_UNREACHABLE', position: { lat: pin.lat + 0.0098, lng: pin.lng - 0.0031 }, callsBefore: [] });
    const out = await whatsapp(e164('01522211100'), '٢ محدش جه ولا اتصل خالص، أنا كنت في البيت');
    if (out.intent === 'ATTEMPT_FALSE') stats.disputesOpen++;
  });

  await step('upheld dispute with a penalty', async () => {
    const pin = near(ZAMALEK, -0.0015, 0.001);
    const r = await order(NILE, ZAMALEK, { name: 'Mariam Nabil', phone: '01200011122', line: '17 Brazil St, Zamalek', cod: 1150, pin, desc: 'Summer set', createdAgo: 30 * H });
    const attemptId = await failedRun(r, ZAMALEK, B.id, { outAgo: 20 * H, failAfterMin: 25, reason: 'CUSTOMER_NOT_PRESENT', position: { lat: pin.lat + 0.0062, lng: pin.lng + 0.0019 }, callsBefore: [1] });
    await attempts.feedback(r.id, { attemptId, answer: 'DISPUTE', channel: 'LINK', note: 'I was home all evening — the bell works and nobody called twice', actor: LINK_CUSTOMER });
    await attempts.resolve(attemptId, { decision: 'UPHELD', penaltyCents: 5000, note: 'GPS shows the hero 700 m away and a single call — fake attempt' }, staffPrincipal, meta);
    stats.disputesResolved++;
  });

  await step('rejected dispute', async () => {
    const pin = near(DOKKI, -0.0021, -0.0012);
    const r = await order(BLOOM, DOKKI, { name: 'Aya Ibrahim', phone: '01100022233', line: '4 Tahrir St, Dokki', cod: 890, pin, desc: 'Hair care bundle', createdAgo: 18 * H });
    const attemptId = await failedRun(r, DOKKI, C.id, { outAgo: 14 * H, failAfterMin: 30, reason: 'CUSTOMER_UNREACHABLE', position: { lat: pin.lat + 0.0005, lng: pin.lng + 0.0003 }, callsBefore: [12, 7, 2] });
    await attempts.feedback(r.id, { attemptId, answer: 'DISPUTE', channel: 'LINK', note: 'My phone was on all day', actor: LINK_CUSTOMER });
    await attempts.resolve(attemptId, { decision: 'REJECTED', note: 'Three spaced calls and GPS at the building — the attempt was real' }, staffPrincipal, meta);
    stats.disputesResolved++;
  });

  // ------------------------------------------------------------------ verified pin reused across brands
  await step('pin reuse', async () => {
    const pin = near(NASR, 0.0031, 0.0024);
    const local = '01277766655';
    const first = await order(NILE, NASR, { name: 'مريم فتحي', phone: local, line: '23 شارع الطيران، مدينة نصر', building: '23', cod: 560, pin, desc: 'Kids t-shirts ×3', createdAgo: 3 * 24 * H });
    const outAt = ago(2 * 24 * H);
    await toHub(first.id, NASR, new Date(outAt.getTime() - 3 * H));
    await workflow.transition(first.id, 'ASSIGNED', staff, { courierId: A.id, at: new Date(outAt.getTime() - 40 * MIN) });
    await workflow.transition(first.id, 'OUT_FOR_DELIVERY', heroActor(A.id), { at: outAt });
    const [row] = await db.select({ collect: orders.collectCents }).from(orders).where(eq(orders.id, first.id));
    await workflow.transition(first.id, 'DELIVERED', heroActor(A.id), {
      at: new Date(outAt.getTime() + 95 * MIN), lat: pin.lat + 0.0001, lng: pin.lng, delivery: { collectedCents: row.collect, receivedBy: 'مريم فتحي' },
    });
    // Another brand, same phone, the same address written differently, no pin → the verified pin is reused.
    const second = await order(BLOOM, NASR, { name: 'Mariam Fathy', phone: local, line: 'مدينة نصر - ٢٣ ش الطيران', building: '23', cod: 740, desc: 'Lipstick collection', createdAgo: 70 * MIN });
    const [o] = await db.select({ lat: orders.lat }).from(orders).where(eq(orders.id, second.id));
    if (o?.lat != null) stats.pinsReused++;
  });

  // Ledger rows dated when the money moved (delivery), as the operations demo does.
  await step('ledger dates', async () => {
    const ids = sql.join(mine.map((id) => sql`${id}`), sql`, `);
    await db.execute(sql`
      update ${ledgerTransactions} lt
      join ${orders} o on o.id = lt.orderId
      set lt.createdAt = o.deliveredAt
      where lt.orderId in (${ids}) and o.deliveredAt is not null`);
    await db.execute(sql`
      update ${ledgerEntries} le
      join ${ledgerTransactions} lt on lt.id = le.transactionId
      set le.createdAt = lt.createdAt
      where lt.orderId in (${ids})`);
  });

  const [{ n: inboundCount }] = await db.select({ n: count() }).from(inboundMessages);
  console.log(
    `✔ integrity demo: ${stats.orders} orders, confirmations ${stats.pending} pending / ${stats.confirmed} confirmed / ${stats.declined} declined / ${stats.noResponse} no response, ` +
      `holds ${stats.unconfirmedHolds} unconfirmed + ${stats.prepayHolds} prepay, disputes ${stats.disputesOpen} open + ${stats.disputesResolved} resolved, ` +
      `${stats.calls} call logs, ${Number(inboundCount)} inbound messages, ${stats.pinsReused} verified pin reused across brands, ` +
      `network: 1 cross-brand decliner, 1 blocked, 1 prepay-only` +
      (stats.errors ? `, ${stats.errors} steps skipped` : ''),
  );
}
