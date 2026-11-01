import { and, desc, eq } from 'drizzle-orm';
import { normalizeEgyptPhone } from '@goturtle/shared';
import * as s from '../src/db/schema';
import { cairoToday } from '../src/db/helpers';
import { addDays } from '../src/modules/orders/ops-kit';
import { ConfirmationService } from '../src/modules/delivery-integrity/confirmation.service';
import { HoldsService } from '../src/modules/delivery-integrity/holds.service';
import { OrderWorkflowService } from '../src/modules/orders/order-workflow.service';
import { signLink } from '../src/modules/delivery-integrity/integrity.util';
import type { TestContext } from './helpers';
import { bearer, bootTestApp, courierByCode, createTestBrand, customerTokenFor, hubId, orderBody, randomPhone, tokenFor } from './ops-factories';
import { orderRow, waitFor } from './integrity-factories';

const API = '/api/v1';

/** RTO shield: confirmation before dispatch, holds, dispatch guard, prepayment rule, network risk. */
describe('Delivery integrity — confirmations & holds (e2e)', () => {
  let t: TestContext;
  let conf: ConfirmationService;
  let holds: HoldsService;
  let hubNsr: string;
  let hero3: string;

  beforeAll(async () => {
    t = await bootTestApp();
    conf = t.app.get(ConfirmationService);
    holds = t.app.get(HoldsService);
    hubNsr = await hubId(t, 'HUB-NSR');
    hero3 = (await courierByCode(t, 'HR-00003')).id;
  });
  afterAll(() => t.close());

  /** A recipient with a refusal history: COD risk ≥ 60 (hold threshold) but < 85 (prepay threshold). */
  async function riskyPhone(refused = 4, extra: Partial<typeof s.customers.$inferInsert> = {}) {
    const phone = randomPhone('012');
    await t.db.insert(s.customers).values({ phone: normalizeEgyptPhone(phone)!, name: 'Risky Rami', totalOrders: refused, refusedOrders: refused, reliabilityScore: 40, ...extra });
    return phone;
  }

  async function newOrder(b: Awaited<ReturnType<Awaited<ReturnType<typeof createTestBrand>>['login']>>, overrides: Record<string, unknown> = {}) {
    const res = await b.post(`${API}/orders`).send(orderBody(overrides));
    expect(res.status).toBe(201);
    return res.body as { id: string; trackingNumber: string; riskScore: number; status: string };
  }

  async function confirmationMessage(orderId: string) {
    const [n] = await t.db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.orderId, orderId), eq(s.notifications.template, 'confirm_delivery')))
      .orderBy(desc(s.notifications.createdAt))
      .limit(1);
    return n;
  }

  const tokenIn = (body: string, key = 'c') => new RegExp(`[?&]${key}=([A-Za-z0-9_.-]+)`).exec(body)?.[1] ?? '';

  async function toHub(tn: string) {
    const res = await (await t.as('hub')).post(`${API}/dispatch/scan/inbound`).send({ hubId: hubNsr, trackingNumber: tn });
    expect(res.status).toBe(200);
    return res.body;
  }

  it('asks risky / high-COD recipients to confirm and confirms through the signed link', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const risky = await newOrder(b, { recipient: { name: 'Rami', phone: await riskyPhone() } });
    const bigCod = await newOrder(b, { codAmountCents: 250_000 });
    const safe = await newOrder(b, { codAmountCents: 40_000 });
    expect(risky.riskScore).toBeGreaterThanOrEqual(60);

    expect(await conf.requestDue(new Date(), [risky.id, bigCod.id, safe.id])).toBe(2);
    expect((await orderRow(t, risky.id)).confirmationStatus).toBe('PENDING');
    expect((await orderRow(t, bigCod.id)).confirmationStatus).toBe('PENDING');
    expect((await orderRow(t, safe.id)).confirmationStatus).toBe('NOT_REQUIRED');
    // claimed once: a second run does not message again
    expect(await conf.requestDue(new Date(), [risky.id])).toBe(0);

    const msg = await confirmationMessage(risky.id);
    expect(msg.channel).toBe('WHATSAPP');
    expect(msg.body).toContain(risky.trackingNumber);
    expect(msg.body).toMatch(/1.*2.*3/);
    expect(msg.body).toContain(`/t/${risky.trackingNumber}?c=`);
    const token = tokenIn(msg.body);

    const state = await t.http().get(`${API}/track/${risky.trackingNumber}/integrity`).query({ c: token });
    expect(state.status).toBe(200);
    expect(state.body.confirmation).toMatchObject({ status: 'PENDING', canRespond: true, authorized: true, link: 'VALID' });
    const anonymous = await t.http().get(`${API}/track/${risky.trackingNumber}/integrity`);
    expect(anonymous.body.confirmation.authorized).toBe(false);

    // forged / foreign tokens are refused
    const forged = await t.http().post(`${API}/track/${risky.trackingNumber}/confirmation`).send({ action: 'CONFIRM', token: `${token.slice(0, -2)}xx` });
    expect(forged.status).toBe(403);
    expect(forged.body.code).toBe('LINK_INVALID');
    const otherTn = await t.http().post(`${API}/track/${bigCod.trackingNumber}/confirmation`).send({ action: 'CONFIRM', token });
    expect(otherTn.body.code).toBe('LINK_INVALID');
    const expired = signLink(risky.trackingNumber, 'confirm', -1000);
    expect((await t.http().post(`${API}/track/${risky.trackingNumber}/confirmation`).send({ action: 'CONFIRM', token: expired })).body.code).toBe('LINK_EXPIRED');
    expect((await t.http().post(`${API}/track/${risky.trackingNumber}/confirmation`).send({ action: 'MAYBE', token })).status).toBe(400);

    const ok = await t.http().post(`${API}/track/${risky.trackingNumber}/confirmation`).send({ action: 'CONFIRM', token });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ action: 'CONFIRM', changed: true, confirmationStatus: 'CONFIRMED', status: 'CREATED' });
    const again = await t.http().post(`${API}/track/${risky.trackingNumber}/confirmation`).send({ action: 'CONFIRM', token });
    expect(again.body.changed).toBe(false);
    const row = await orderRow(t, risky.id);
    expect(row.confirmationChannel).toBe('LINK');
    expect(row.confirmationRespondedAt).toBeTruthy();
    const view = (await (await t.as('ops')).get(`${API}/integrity/orders/${risky.id}`)).body;
    expect(view.confirmation.status).toBe('CONFIRMED');
    expect(view.history.map((h: { reason: string }) => h.reason)).toEqual(expect.arrayContaining(['CONFIRMATION_REQUESTED', 'CONFIRMATION_CONFIRMED']));
    // the brand sees its own order's confirmation, not someone else's
    expect((await b.get(`${API}/integrity/orders/${risky.id}`)).body.confirmation.status).toBe('CONFIRMED');
    expect((await (await t.as('brandNile')).get(`${API}/integrity/orders/${risky.id}`)).status).toBe(404);
  });

  it('declines before pickup (cancelled) and after the hub scan (returned to the brand), counting a refusal', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const phone = randomPhone();
    const early = await newOrder(b, { recipient: { name: 'Dina', phone }, codAmountCents: 200_000 });
    const late = await newOrder(b, { recipient: { name: 'Dina', phone }, codAmountCents: 200_000 });
    await toHub(late.trackingNumber);
    await conf.requestDue(new Date(), [early.id, late.id]);

    const t1 = tokenIn((await confirmationMessage(early.id)).body);
    const d1 = await t.http().post(`${API}/track/${early.trackingNumber}/confirmation`).send({ action: 'DECLINE', token: t1, note: 'Ordered by mistake' });
    expect(d1.body).toMatchObject({ confirmationStatus: 'DECLINED', status: 'CANCELLED' });

    // a verified customer session works without the link
    const session = bearer(t, await customerTokenFor(t, normalizeEgyptPhone(phone)!));
    const d2 = await session.post(`${API}/track/${late.trackingNumber}/confirmation`).send({ action: 'DECLINE' });
    expect(d2.status).toBe(200);
    expect(d2.body).toMatchObject({ confirmationStatus: 'DECLINED', status: 'RETURN_PENDING' });
    expect((await orderRow(t, late.id)).confirmationChannel).toBe('TRACKING');
    const [c] = await t.db.select().from(s.customers).where(eq(s.customers.phone, normalizeEgyptPhone(phone)!));
    expect(c.refusedOrders).toBe(2);
    // a declined order cannot be confirmed afterwards
    expect((await session.post(`${API}/track/${late.trackingNumber}/confirmation`).send({ action: 'CONFIRM' })).body.code).toBe('CONFIRMATION_CLOSED');
    // another customer cannot act on this shipment
    const stranger = bearer(t, await customerTokenFor(t, '+201011112222'));
    expect((await stranger.post(`${API}/track/${early.trackingNumber}/confirmation`).send({ action: 'CONFIRM' })).body.code).toBe('LINK_INVALID');
  });

  it('reschedules to a chosen day (and to tomorrow by default from a reply)', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const o = await newOrder(b, { codAmountCents: 180_000 });
    await toHub(o.trackingNumber);
    await conf.requestDue(new Date(), [o.id]);
    const token = tokenIn((await confirmationMessage(o.id)).body);
    const tooFar = await t.http().post(`${API}/track/${o.trackingNumber}/confirmation`).send({ action: 'RESCHEDULE', date: addDays(cairoToday(), 12), token });
    expect(tooFar.body.code).toBe('INVALID_DATE');
    const day = addDays(cairoToday(), 3);
    const res = await t.http().post(`${API}/track/${o.trackingNumber}/confirmation`).send({ action: 'RESCHEDULE', date: day, token });
    expect(res.body).toMatchObject({ confirmationStatus: 'RESCHEDULED', status: 'RECEIVED_AT_HUB', scheduledDate: day });
    const row = await orderRow(t, o.id);
    expect(row.scheduledDate).toBe(day);
    // staff record a phone call: back to confirmed
    const rec = await (await t.as('support')).post(`${API}/integrity/confirmations/${o.id}/record`).send({ action: 'CONFIRM', note: 'Called the customer' });
    expect(rec.body).toMatchObject({ confirmationStatus: 'CONFIRMED', changed: true });
    expect((await orderRow(t, o.id)).confirmationChannel).toBe('PHONE');
  });

  it('no response → NO_RESPONSE and ON_HOLD UNCONFIRMED above the hold threshold; confirming releases it', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const created = await newOrder(b, { recipient: { name: 'Rami', phone: await riskyPhone() } });
    const atHub = await newOrder(b, { recipient: { name: 'Rami', phone: await riskyPhone() } });
    const lowRisk = await newOrder(b, { codAmountCents: 300_000 });
    await toHub(atHub.trackingNumber);
    await conf.requestDue(new Date(), [created.id, atHub.id, lowRisk.id]);
    // nothing expires before the configured hours
    expect((await conf.expireDue(new Date(), [created.id, atHub.id, lowRisk.id])).noResponse).toBe(0);
    const old = new Date(Date.now() - 21 * 3_600_000);
    for (const id of [created.id, atHub.id, lowRisk.id]) await t.db.update(s.orders).set({ confirmationRequestedAt: old }).where(eq(s.orders.id, id));
    const out = await conf.expireDue(new Date(), [created.id, atHub.id, lowRisk.id]);
    expect(out).toEqual({ noResponse: 3, held: 2 });

    for (const id of [created.id, atHub.id]) {
      const row = await orderRow(t, id);
      expect(row).toMatchObject({ confirmationStatus: 'NO_RESPONSE', status: 'ON_HOLD', holdReason: 'UNCONFIRMED' });
    }
    expect(await orderRow(t, lowRisk.id)).toMatchObject({ confirmationStatus: 'NO_RESPONSE', status: 'CREATED', holdReason: null });
    const [ev] = await t.db.select().from(s.orderEvents).where(and(eq(s.orderEvents.orderId, created.id), eq(s.orderEvents.status, 'ON_HOLD'))).limit(1);
    expect(ev).toMatchObject({ actorType: 'SYSTEM', reason: 'UNCONFIRMED', isPublic: false });

    // holds list + release refused while unconfirmed
    const ops = await t.as('ops');
    const list = await ops.get(`${API}/integrity/holds`).query({ reason: 'UNCONFIRMED', q: atHub.trackingNumber });
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([atHub.id]);
    expect(list.body.data[0].holdFrom).toBe('RECEIVED_AT_HUB');
    expect((await ops.post(`${API}/integrity/holds/${atHub.id}/release`).send({})).body.code).toBe('CONFIRMATION_REQUIRED');

    // the customer answers late: released back to where each order was
    const t1 = tokenIn((await confirmationMessage(created.id)).body);
    expect((await t.http().post(`${API}/track/${created.trackingNumber}/confirmation`).send({ action: 'CONFIRM', token: t1 })).body).toMatchObject({ status: 'CREATED', confirmationStatus: 'CONFIRMED' });
    const t2 = tokenIn((await confirmationMessage(atHub.id)).body);
    expect((await t.http().post(`${API}/track/${atHub.trackingNumber}/confirmation`).send({ action: 'CONFIRM', token: t2 })).body).toMatchObject({ status: 'RECEIVED_AT_HUB', confirmationStatus: 'CONFIRMED' });
    expect((await orderRow(t, atHub.id)).holdReason).toBeNull();
  });

  it('dispatch guard refuses unconfirmed high-risk parcels unless an ops manager overrides', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const o = await newOrder(b, { recipient: { name: 'Rami', phone: await riskyPhone() } });
    await toHub(o.trackingNumber);
    await conf.requestDue(new Date(), [o.id]);
    const dispatcher = await t.as('dispatcher');

    const rs = await dispatcher.post(`${API}/runsheets`).send({ courierId: hero3, orderIds: [o.id] });
    expect(rs.status).toBe(409);
    expect(rs.body.code).toBe('CONFIRMATION_REQUIRED');
    expect(rs.body.details).toMatchObject({ confirmationStatus: 'PENDING', threshold: 60 });

    const auto = await dispatcher.post(`${API}/dispatch/auto-assign`).send({ orderIds: [o.id] });
    expect(auto.status).toBe(200);
    expect(auto.body.skipped).toEqual([expect.objectContaining({ orderId: o.id, reasons: ['CONFIRMATION_REQUIRED'] })]);
    const suggest = await dispatcher.get(`${API}/dispatch/suggest/${o.id}`);
    expect(suggest.body).toMatchObject({ blockedBy: 'CONFIRMATION_REQUIRED', candidates: [] });

    // workflow extension: only OPS_MANAGER / SUPER_ADMIN may override
    const workflow = t.app.get(OrderWorkflowService);
    const [dispUser] = await t.db.select().from(s.users).where(eq(s.users.phone, '+201000000002'));
    await expect(
      workflow.transition(o.id, 'ASSIGNED', { actorType: 'STAFF', actorId: dispUser.id, name: dispUser.name }, { courierId: hero3, extensions: { integrityOverride: true } }),
    ).rejects.toMatchObject({ code: 'OVERRIDE_NOT_ALLOWED' });
    expect((await dispatcher.post(`${API}/integrity/holds/${o.id}/override`).send({ reason: 'Customer confirmed by phone' })).body.code).toBe('OVERRIDE_NOT_ALLOWED');

    const ops = await t.as('ops');
    const ov = await ops.post(`${API}/integrity/holds/${o.id}/override`).send({ reason: 'Brand confirmed with the customer by phone' });
    expect(ov.status).toBe(200);
    expect(ov.body.override).toMatchObject({ reason: 'Brand confirmed with the customer by phone' });
    const [audit] = await t.db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, o.id), eq(s.auditLogs.action, 'integrity.override'))).limit(1);
    expect(audit).toBeTruthy();
    const rs2 = await dispatcher.post(`${API}/runsheets`).send({ courierId: hero3, orderIds: [o.id] });
    expect(rs2.status).toBe(201);
    expect((await orderRow(t, o.id)).status).toBe('ASSIGNED');

    // the extension path for a manager on a second parcel
    const o2 = await newOrder(b, { recipient: { name: 'Rami', phone: await riskyPhone() } });
    await toHub(o2.trackingNumber);
    await conf.requestDue(new Date(), [o2.id]);
    const [opsUser] = await t.db.select().from(s.users).where(eq(s.users.phone, '+201000000001'));
    const moved = await workflow.transition(o2.id, 'ASSIGNED', { actorType: 'STAFF', actorId: opsUser.id, name: opsUser.name }, { courierId: hero3, extensions: { integrityOverride: true, integrityOverrideReason: 'VIP customer' } });
    expect(moved.status).toBe('ASSIGNED');
    expect((await (await t.as('ops')).get(`${API}/integrity/orders/${o2.id}`)).body.override.reason).toBe('VIP customer');
    await workflow.transition(o2.id, 'RECEIVED_AT_HUB', { actorType: 'STAFF', actorId: opsUser.id, name: opsUser.name }, { clearRunsheet: true });
  });

  it('holds COD to prepay-only recipients until the brand collects online or switches to prepaid', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const ops = await t.as('ops');
    const phone = randomPhone('015');
    await t.db.insert(s.customers).values({ phone: normalizeEgyptPhone(phone)!, name: 'Soha' });
    const [c] = await t.db.select().from(s.customers).where(eq(s.customers.phone, normalizeEgyptPhone(phone)!));
    expect((await (await t.as('hub')).post(`${API}/customers/${c.id}/prepayment`).send({ required: true })).status).toBe(403);
    const rule = await ops.post(`${API}/customers/${c.id}/prepayment`).send({ required: true, reason: 'Refused 3 brands' });
    expect(rule.status).toBe(200);
    expect(rule.body.requirePrepayment).toBe(true);
    expect((await t.db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, c.id), eq(s.auditLogs.action, 'customer.prepay_on')))).length).toBe(1);

    const held = await newOrder(b, { recipient: { name: 'Soha', phone }, codAmountCents: 90_000 });
    const row = await waitFor(async () => {
      const r = await orderRow(t, held.id);
      return r.status === 'ON_HOLD' ? r : null;
    });
    expect(row.holdReason).toBe('PREPAY_REQUIRED');
    const notes = await waitFor(async () => {
      const n = await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, brand.ownerId), eq(s.notifications.template, 'prepay_required')));
      return n.length ? n : null;
    });
    expect(notes[0].data).toMatchObject({ orderId: held.id, holdReason: 'PREPAY_REQUIRED' });
    const prepaidOrder = await newOrder(b, { recipient: { name: 'Soha', phone }, paymentMethod: 'PREPAID', codAmountCents: 0 });

    // the brand sees why and what to do
    const view = (await b.get(`${API}/integrity/orders/${held.id}`)).body;
    expect(view.hold).toMatchObject({ reason: 'PREPAY_REQUIRED', from: 'CREATED' });
    expect(view.dispatchBlocked.code).toBe('CONFIRMATION_REQUIRED');
    expect((await b.post(`${API}/integrity/holds/${held.id}/release`).send({})).body.code).toBe('PREPAYMENT_REQUIRED');
    const patched = await b.patch(`${API}/orders/${held.id}`).send({ paymentMethod: 'PREPAID' });
    expect(patched.status).toBe(200);
    const released = await b.post(`${API}/integrity/holds/${held.id}/release`).send({ note: 'Paid by InstaPay' });
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ status: 'CREATED', holdReason: null });

    // the job releases holds whose order became prepaid elsewhere (payment link)
    const viaLink = await newOrder(b, { recipient: { name: 'Soha', phone }, codAmountCents: 60_000 });
    await waitFor(async () => (await orderRow(t, viaLink.id)).status === 'ON_HOLD');
    await t.db.update(s.orders).set({ paymentMethod: 'PREPAID', collectCents: 0 }).where(eq(s.orders.id, viaLink.id));
    expect(await holds.sweepPrepaid()).toBeGreaterThanOrEqual(1);
    expect((await orderRow(t, viaLink.id)).status).toBe('CREATED');
    await new Promise((r) => setTimeout(r, 200));
    expect((await orderRow(t, prepaidOrder.id)).status).toBe('CREATED');

    // a staff cancel of a held order
    const toCancel = await newOrder(b, { recipient: { name: 'Soha', phone }, codAmountCents: 60_000 });
    await waitFor(async () => (await orderRow(t, toCancel.id)).status === 'ON_HOLD');
    const cancelled = await ops.post(`${API}/integrity/holds/${toCancel.id}/cancel`).send({ note: 'Brand asked to cancel' });
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await b.post(`${API}/integrity/holds/${toCancel.id}/release`).send({})).body.code).toBe('NOT_ON_HOLD');
  });

  it('holds COD above the prepay risk threshold', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const phone = await riskyPhone(6, { isBlocked: true });
    const o = await newOrder(b, { recipient: { name: 'Rami', phone }, codAmountCents: 120_000 });
    expect(o.riskScore).toBeGreaterThanOrEqual(85);
    const row = await waitFor(async () => {
      const r = await orderRow(t, o.id);
      return r.status === 'ON_HOLD' ? r : null;
    });
    expect(row.holdReason).toBe('PREPAY_REQUIRED');
    const ov = await (await t.as('admin')).post(`${API}/integrity/holds/${o.id}/override`).send({ reason: 'Known wholesale customer' });
    expect(ov.body).toMatchObject({ status: 'CREATED', holdReason: null });
  });

  it('brand risk lookup returns only coarse signals and never other brands’ data', async () => {
    const nile = await t.as('brandNile');
    const phone = await riskyPhone(3, { deliveredOrders: 1, totalOrders: 4, requirePrepayment: true });
    const res = await nile.get(`${API}/customers/risk`).query({ phone });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['flags', 'level', 'requiresPrepayment', 'score', 'verifiedPinAvailable']);
    expect(res.body).toMatchObject({ requiresPrepayment: true, verifiedPinAvailable: false });
    expect(res.body.flags).toEqual(expect.arrayContaining(['FREQUENT_REFUSALS', 'PREPAY_ONLY']));
    expect(['MEDIUM', 'HIGH']).toContain(res.body.level);
    expect(JSON.stringify(res.body)).not.toContain('Rami');

    const fresh = await nile.get(`${API}/customers/risk`).query({ phone: randomPhone(), codAmountCents: 600_000 });
    expect(fresh.body.flags).toEqual(['NEW_RECIPIENT']);
    expect(fresh.body.score).toBeGreaterThan(0);
    expect((await nile.get(`${API}/customers/risk`).query({ phone: '12345' })).body.code).toBe('INVALID_PHONE');
    // brands still cannot read customer profiles
    const [c] = await t.db.select().from(s.customers).where(eq(s.customers.phone, normalizeEgyptPhone(phone)!));
    expect((await nile.get(`${API}/customers/${c.id}`)).status).toBe(403);
    const customer = bearer(t, await customerTokenFor(t, c.phone));
    expect((await customer.get(`${API}/customers/risk`).query({ phone })).status).toBe(403);
  });

  it('network risk lists phones declining across brands; staff block with reason and prepay rule (audited)', async () => {
    const phone = randomPhone('011');
    const support = await t.as('support');
    for (const _ of [1, 2]) {
      const brand = await createTestBrand(t);
      const o = await newOrder(await brand.login(), { recipient: { name: 'Hany', phone }, codAmountCents: 200_000 });
      await support.post(`${API}/integrity/confirmations/${o.id}/record`).send({ action: 'DECLINE', note: 'Not interested' }).expect(200);
    }
    const ops = await t.as('ops');
    const risk = await ops.get(`${API}/integrity/network-risk`).query({ q: phone });
    expect(risk.status).toBe(200);
    expect(risk.body.data).toHaveLength(1);
    expect(risk.body.data[0]).toMatchObject({ refusalBrands: 2, declines: 2 });
    const customerId = risk.body.data[0].customer.id;

    const block = await ops.post(`${API}/customers/${customerId}/block`).send({ reason: 'Declines across brands', requirePrepayment: true });
    expect(block.body).toMatchObject({ isBlocked: true, blockedReason: 'Declines across brands', requirePrepayment: true });
    expect(block.body.blockedAt).toBeTruthy();
    const blocked = await ops.get(`${API}/integrity/network-risk`).query({ scope: 'blocked', q: phone });
    expect(blocked.body.data.map((r: { customer: { id: string } }) => r.customer.id)).toEqual([customerId]);
    const unblock = await ops.post(`${API}/customers/${customerId}/unblock`).send({ reason: 'Paid outstanding' });
    expect(unblock.body).toMatchObject({ isBlocked: false, blockedReason: null, requirePrepayment: true });
    const actions = (await t.db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, customerId))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['customer.block', 'customer.unblock']));

    const overview = await ops.get(`${API}/integrity/overview`);
    expect(overview.status).toBe(200);
    expect(overview.body.confirmations.last30.declined).toBeGreaterThanOrEqual(2);
    expect(overview.body.rto.last30).toHaveProperty('rate');
    expect(overview.body.customers.prepayOnly).toBeGreaterThanOrEqual(1);
    expect((await (await t.as('brandNile')).get(`${API}/integrity/overview`)).status).toBe(403);
  });

  it('lists pending confirmations and re-sends with a cooldown', async () => {
    const brand = await createTestBrand(t);
    const o = await newOrder(await brand.login(), { recipient: { name: 'Rami', phone: await riskyPhone() } });
    await conf.requestDue(new Date(), [o.id]);
    const ops = await t.as('ops');
    const list = await ops.get(`${API}/integrity/confirmations`).query({ q: o.trackingNumber });
    expect(list.body.data[0]).toMatchObject({ id: o.id, confirmationStatus: 'PENDING', blocksDispatch: true });
    expect((await ops.post(`${API}/integrity/confirmations/${o.id}/resend`).send({})).body.code).toBe('TOO_SOON');
    await t.db.update(s.notifications).set({ createdAt: new Date(Date.now() - 3_600_000) }).where(eq(s.notifications.orderId, o.id));
    expect((await ops.post(`${API}/integrity/confirmations/${o.id}/resend`).send({})).body).toMatchObject({ ok: true, confirmationStatus: 'PENDING' });
    expect((await t.db.select().from(s.notifications).where(and(eq(s.notifications.orderId, o.id), eq(s.notifications.template, 'confirm_delivery')))).length).toBe(2);
    // the hero app cannot reach staff integrity endpoints
    const [hero] = await t.db.select().from(s.couriers).where(eq(s.couriers.id, hero3));
    expect((await bearer(t, await tokenFor(t, hero.userId, 'COURIER')).get(`${API}/integrity/holds`)).status).toBe(403);
  });
});
