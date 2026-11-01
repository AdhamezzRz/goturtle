import { and, desc, eq } from 'drizzle-orm';
import { normalizeEgyptPhone } from '@goturtle/shared';
import * as s from '../src/db/schema';
import { config } from '../src/config';
import { AttemptsService } from '../src/modules/delivery-integrity/attempts.service';
import { DirectCallProvider, TwilioProxyProvider, twilioSignature } from '../src/modules/delivery-integrity/call-providers';
import type { TestContext } from './helpers';
import { bearer, bootTestApp, courierByCode, createTestBrand, hubId, ledgerOf, orderBody, randomPhone, tokenFor, type Agent } from './ops-factories';
import { logSpacedCalls, orderRow, waBody, waSignature, waitFor } from './integrity-factories';

const API = '/api/v1';
const DEST = { lat: 30.0590, lng: 31.3420 }; // 5 Abbas El Akkad, Nasr City
const NEAR = { lat: 30.0601, lng: 31.3428 }; // ~140 m away
const FAR = { lat: 30.0680, lng: 31.3420 }; // ~1 km away
const WA_SECRET = 'wa-secret-attempts';

/** Attempt integrity: calls, geofence & call rules, customer verification, disputes with penalties. */
describe('Delivery integrity — attempts & disputes (e2e)', () => {
  let t: TestContext;
  let hubNsr: string;
  let heroId: string;
  let hero: Agent;
  let otherHero: Agent;
  const env = { ...process.env };

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = WA_SECRET;
    process.env.TWILIO_AUTH_TOKEN = 'twilio-token-test';
    t = await bootTestApp();
    hubNsr = await hubId(t, 'HUB-NSR');
    const h = await courierByCode(t, 'HR-00009');
    heroId = h.id;
    hero = bearer(t, await tokenFor(t, h.userId, 'COURIER'));
    otherHero = bearer(t, await tokenFor(t, (await courierByCode(t, 'HR-00010')).userId, 'COURIER'));
  });
  afterAll(async () => {
    process.env.WHATSAPP_APP_SECRET = env.WHATSAPP_APP_SECRET;
    process.env.TWILIO_AUTH_TOKEN = env.TWILIO_AUTH_TOKEN;
    t.app.get(AttemptsService).useCallProvider(new DirectCallProvider());
    await t.close();
  });

  /** A parcel out for delivery with HR-00009 (with or without a pin). */
  async function outForDelivery(opts: { pin?: boolean; phone?: string } = {}) {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const phone = opts.phone ?? randomPhone('010');
    const address = opts.pin === false ? { line: '12 Makram Ebeid St, Nasr City' } : { line: '5 Abbas El Akkad, Nasr City', ...DEST };
    const created = await b.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Karim Adel', phone }, address, codAmountCents: 80_000 }));
    expect(created.status).toBe(201);
    await (await t.as('hub')).post(`${API}/dispatch/scan/inbound`).send({ hubId: hubNsr, trackingNumber: created.body.trackingNumber }).expect(200);
    const d = await t.as('dispatcher');
    const rs = await d.post(`${API}/runsheets`).send({ courierId: heroId, orderIds: [created.body.id] });
    expect(rs.status).toBe(201);
    const out = await (await t.as('ops')).post(`${API}/runsheets/${rs.body.id}/dispatch`).send({ override: true });
    expect(out.status).toBe(200);
    return { order: created.body as { id: string; trackingNumber: string }, phone: normalizeEgyptPhone(phone)!, brand };
  }

  const backdateCalls = (orderId: string, minutesAgo: number[]) =>
    t.db
      .select({ id: s.callLogs.id })
      .from(s.callLogs)
      .where(eq(s.callLogs.orderId, orderId))
      .orderBy(s.callLogs.createdAt)
      .then(async (rows) => {
        for (const [i, r] of rows.entries()) {
          const at = new Date(Date.now() - (minutesAgo[i] ?? 0) * 60_000);
          await t.db.update(s.callLogs).set({ startedAt: at, createdAt: at }).where(eq(s.callLogs.id, r.id));
        }
      });

  const failedAttempt = async (orderId: string) =>
    (await t.db.select().from(s.deliveryAttempts).where(and(eq(s.deliveryAttempts.orderId, orderId), eq(s.deliveryAttempts.success, false))).orderBy(desc(s.deliveryAttempts.createdAt)).limit(1))[0];

  it('logs calls (own orders only), returns the number to dial and records the outcome', async () => {
    const { order, phone } = await outForDelivery();
    const call = await hero.post(`${API}/hero/tasks/orders/${order.id}/call`).send({});
    expect(call.status).toBe(200);
    expect(call.body).toMatchObject({ provider: 'direct', masked: false, dial: `tel:${phone}` });
    expect(call.body.calls).toMatchObject({ made: 1, logged: 1, requiredForUnreachable: 2, spacingMinutes: 3 });
    expect(new Date(call.body.calls.nextCountedAt).getTime()).toBeGreaterThan(Date.now());
    expect((await otherHero.post(`${API}/hero/tasks/orders/${order.id}/call`).send({})).status).toBe(404);
    expect((await hero.post(`${API}/hero/tasks/orders/${order.id}/call`).send({ to: 'ALT' })).body.code).toBe('NO_ALT_PHONE');

    const result = await hero.post(`${API}/hero/tasks/calls/${call.body.callLogId}/result`).send({ status: 'NO_ANSWER', durationSeconds: 0 });
    expect(result.status).toBe(200);
    expect(result.body.call).toMatchObject({ status: 'NO_ANSWER' });
    expect((await otherHero.post(`${API}/hero/tasks/calls/${call.body.callLogId}/result`).send({ status: 'ANSWERED' })).status).toBe(404);
    expect((await hero.post(`${API}/hero/tasks/calls/${call.body.callLogId}/result`).send({ status: 'RINGING' })).status).toBe(400);

    const rules = await hero.get(`${API}/hero/tasks/orders/${order.id}/integrity`);
    expect(rules.body).toMatchObject({ geofenceMeters: 300, destination: DEST, callProvider: 'direct' });
    expect(rules.body.calls.list).toHaveLength(1);
  });

  it('refuses failed attempts without GPS, outside the geofence or without enough spaced calls', async () => {
    const { order } = await outForDelivery();
    const fail = (body: Record<string, unknown>) => hero.post(`${API}/hero/tasks/orders/${order.id}/fail`).send({ reason: 'CUSTOMER_UNREACHABLE', ...body });

    expect((await fail({})).body.code).toBe('LOCATION_REQUIRED');
    const far = await fail(FAR);
    expect(far.status).toBe(422);
    expect(far.body.code).toBe('TOO_FAR_FROM_DESTINATION');
    expect(far.body.details).toMatchObject({ allowedMeters: 300 });
    expect(far.body.details.distanceMeters).toBeGreaterThan(800);

    expect((await fail(NEAR)).body).toMatchObject({ code: 'CALLS_REQUIRED', details: { made: 0, required: 2 } });
    await hero.post(`${API}/hero/tasks/orders/${order.id}/call`).send({});
    await hero.post(`${API}/hero/tasks/orders/${order.id}/call`).send({}); // seconds apart: counts once
    expect((await fail(NEAR)).body.details).toMatchObject({ made: 1, required: 2 });
    await backdateCalls(order.id, [6, 0]);
    const ok = await fail({ ...NEAR, note: 'Phone switched off' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('FAILED_ATTEMPT');

    const attempt = await failedAttempt(order.id);
    expect(attempt.callCount).toBe(2);
    expect(attempt.distanceMeters).toBeGreaterThan(50);
    expect(attempt.distanceMeters).toBeLessThan(300);
    const [verify] = await t.db.select().from(s.notifications).where(and(eq(s.notifications.orderId, order.id), eq(s.notifications.template, 'attempt_verify')));
    expect(verify.body).toContain('?a=');
    expect(verify.body).toContain('1');
    const view = (await (await t.as('ops')).get(`${API}/integrity/orders/${order.id}`)).body;
    expect(view.attempts.find((a: { success: boolean }) => !a.success)).toMatchObject({ withinGeofence: true, callCount: 2, disputeStatus: 'NONE' });
    expect(view.calls).toHaveLength(2);
  });

  it('parcels without a pin need at least one logged call for any failure', async () => {
    const { order } = await outForDelivery({ pin: false });
    const refused = await hero.post(`${API}/hero/tasks/orders/${order.id}/fail`).send({ reason: 'CUSTOMER_REFUSED', ...NEAR });
    expect(refused.body).toMatchObject({ code: 'CALLS_REQUIRED', details: { made: 0, required: 1 } });
    await hero.post(`${API}/hero/tasks/orders/${order.id}/call`).send({});
    const ok = await hero.post(`${API}/hero/tasks/orders/${order.id}/fail`).send({ reason: 'CUSTOMER_REFUSED', ...FAR });
    expect(ok.body.status).toBe('RETURN_PENDING'); // no pin: no geofence, the refusal returns the parcel
    expect((await failedAttempt(order.id)).distanceMeters).toBeNull();
  });

  it('customer disputes through the link → HIGH ticket; ops upholds with a penalty through the ledger', async () => {
    const { order } = await outForDelivery();
    await logSpacedCalls(t, order.id, heroId);
    await hero.post(`${API}/hero/tasks/orders/${order.id}/fail`).send({ reason: 'CUSTOMER_NOT_PRESENT', ...NEAR }).expect(200);
    const [verify] = await t.db.select().from(s.notifications).where(and(eq(s.notifications.orderId, order.id), eq(s.notifications.template, 'attempt_verify')));
    const token = /[?&]a=([A-Za-z0-9_.-]+)/.exec(verify.body)![1];

    const state = await t.http().get(`${API}/track/${order.trackingNumber}/integrity`).query({ a: token });
    expect(state.body.attempt).toMatchObject({ attemptNo: 1, canRespond: true, authorized: true, heroFirstName: 'Sherif', failureReason: 'CUSTOMER_NOT_PRESENT' });
    expect((await t.http().post(`${API}/track/${order.trackingNumber}/attempt-feedback`).send({ answer: 'DISPUTE', token: 'c1.xxxxxxxxxxxxxxxxxxxxxx' })).body.code).toBe('LINK_INVALID');

    const disputed = await t.http().post(`${API}/track/${order.trackingNumber}/attempt-feedback`).send({ answer: 'DISPUTE', token, note: 'I was home all day, nobody rang' });
    expect(disputed.status).toBe(200);
    expect(disputed.body).toMatchObject({ disputeStatus: 'DISPUTED', changed: true });
    expect(disputed.body.ticketCode).toMatch(/^TK-\d{6}$/);
    const again = await t.http().post(`${API}/track/${order.trackingNumber}/attempt-feedback`).send({ answer: 'DISPUTE', token });
    expect(again.body).toMatchObject({ changed: false, ticketCode: disputed.body.ticketCode });

    const [ticket] = await t.db.select().from(s.tickets).where(eq(s.tickets.code, disputed.body.ticketCode));
    expect(ticket).toMatchObject({ category: 'ATTEMPT_DISPUTE', priority: 'HIGH', orderId: order.id, status: 'OPEN' });
    const messages = await t.db.select().from(s.ticketMessages).where(eq(s.ticketMessages.ticketId, ticket.id));
    expect(messages.find((m) => !m.isInternal)!.body).toContain('nobody rang');
    expect(messages.find((m) => m.isInternal)!.body).toContain('HR-00009');
    const [opsUser] = await t.db.select().from(s.users).where(eq(s.users.phone, '+201000000001'));
    await waitFor(async () => (await t.db.select().from(s.notifications).where(and(eq(s.notifications.userId, opsUser.id), eq(s.notifications.template, 'attempt_disputed'), eq(s.notifications.orderId, order.id)))).length > 0);

    // evidence for the reviewer
    const ops = await t.as('ops');
    const list = await ops.get(`${API}/integrity/disputes`);
    const item = list.body.data.find((d: { order: { id: string } }) => d.order.id === order.id);
    expect(item).toMatchObject({ disputeStatus: 'DISPUTED', withinGeofence: true, callCount: 2, customerNote: 'I was home all day, nobody rang', hero: { code: 'HR-00009' } });
    expect(item.order.destination).toEqual(DEST);
    expect(item.calls).toHaveLength(2);
    expect(item.ticket.code).toBe(disputed.body.ticketCode);
    expect(list.body.geofenceMeters).toBe(300);

    // support may resolve but not fine; ops managers can
    const attemptId = item.attemptId;
    expect((await (await t.as('support')).post(`${API}/integrity/disputes/${attemptId}/resolve`).send({ decision: 'UPHELD', penaltyCents: 5000, note: 'Fake' })).body.code).toBe('PENALTY_NOT_ALLOWED');
    const payableBefore = await ledgerOf(t).balance({ courierPayable: heroId });
    const before = await orderRow(t, order.id);
    const resolved = await ops.post(`${API}/integrity/disputes/${attemptId}/resolve`).send({ decision: 'UPHELD', penaltyCents: 5000, note: 'GPS trail shows the hero never stopped' });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({ disputeStatus: 'UPHELD', penaltyCents: 5000, ticketsResolved: 1 });
    expect(resolved.body.adjustmentId).toBeTruthy();
    const [adj] = await t.db.select().from(s.courierAdjustments).where(eq(s.courierAdjustments.id, resolved.body.adjustmentId));
    expect(adj).toMatchObject({ type: 'PENALTY', amountCents: 5000, courierId: heroId, orderId: order.id });
    expect((await ledgerOf(t).balance({ courierPayable: heroId })) - payableBefore).toBe(-5000);
    expect((await ledgerOf(t).trialBalance()).balanced).toBe(true);
    const after = await orderRow(t, order.id);
    expect(after.maxAttempts).toBe(before.maxAttempts + 1);
    expect(after.priority).toBeGreaterThanOrEqual(10);
    expect(after.tags).toContain('REDELIVERY_PRIORITY');
    expect((await t.db.select().from(s.tickets).where(eq(s.tickets.id, ticket.id)))[0].status).toBe('RESOLVED');
    expect((await ops.post(`${API}/integrity/disputes/${attemptId}/resolve`).send({ decision: 'REJECTED', note: 'again' })).body.code).toBe('DISPUTE_NOT_OPEN');

    // the hero's integrity score reflects the upheld dispute
    const heroes = await ops.get(`${API}/integrity/heroes`).query({ days: 7 });
    const me = heroes.body.data.find((h: { courier: { code: string } }) => h.courier.code === 'HR-00009');
    expect(me.upheld).toBeGreaterThanOrEqual(1);
    expect(me.failedAttempts).toBeGreaterThanOrEqual(1);
    expect(me.integrityScore).toBeLessThan(100);
    expect(me.avgDistanceAtFailureMeters).toBeGreaterThan(0);
  });

  it('WhatsApp "1" confirms an attempt, "2" disputes it; disputes close after the window', async () => {
    const reply = async (waId: string, text: string) => {
      const body = waBody(waId, { type: 'text', text: { body: text } });
      const res = await t.http().post(`${API}/integrations/inbound/whatsapp`).set('Content-Type', 'application/json').set('X-Hub-Signature-256', waSignature(WA_SECRET, JSON.stringify(body))).send(JSON.stringify(body));
      expect(res.status).toBe(200);
      return res.body.results[0];
    };
    const a = await outForDelivery();
    await logSpacedCalls(t, a.order.id, heroId);
    await hero.post(`${API}/hero/tasks/orders/${a.order.id}/fail`).send({ reason: 'CUSTOMER_UNREACHABLE', ...NEAR }).expect(200);
    expect(await reply(a.phone.slice(1), '1')).toMatchObject({ intent: 'ATTEMPT_TRUE', applied: true, ack: 'attempt_ack' });
    expect((await failedAttempt(a.order.id)).disputeStatus).toBe('CONFIRMED_BY_CUSTOMER');

    const b = await outForDelivery();
    await logSpacedCalls(t, b.order.id, heroId);
    await hero.post(`${API}/hero/tasks/orders/${b.order.id}/fail`).send({ reason: 'CUSTOMER_UNREACHABLE', ...NEAR }).expect(200);
    const out = await reply(b.phone.slice(1), '٢ محدش اتصل');
    expect(out).toMatchObject({ intent: 'ATTEMPT_FALSE', applied: true, ack: 'dispute_ack' });
    expect((await failedAttempt(b.order.id)).disputeStatus).toBe('DISPUTED');
    const rejected = await (await t.as('ops')).post(`${API}/integrity/disputes/${(await failedAttempt(b.order.id)).id}/resolve`).send({ decision: 'REJECTED', note: 'Call logs and GPS confirm the visit' });
    expect(rejected.body).toMatchObject({ disputeStatus: 'REJECTED', penaltyCents: 0, adjustmentId: null });

    const c = await outForDelivery();
    await logSpacedCalls(t, c.order.id, heroId);
    await hero.post(`${API}/hero/tasks/orders/${c.order.id}/fail`).send({ reason: 'CUSTOMER_UNREACHABLE', ...NEAR }).expect(200);
    await t.db.update(s.deliveryAttempts).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(s.deliveryAttempts.orderId, c.order.id));
    const late = await t.http().post(`${API}/track/${c.order.trackingNumber}/attempt-feedback`).send({ answer: 'DISPUTE' });
    expect(late.body.code).toBe('DISPUTE_WINDOW_CLOSED');
  });

  it('masked calls through Twilio Proxy and the signed status webhook', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? '') });
      const json = url.endsWith('/Sessions') ? { sid: 'KC123' } : url.includes('/Participants') ? { sid: 'KP1', proxy_identifier: '+201555000111' } : {};
      return new Response(JSON.stringify(json), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });
    const attempts = t.app.get(AttemptsService);
    attempts.useCallProvider(new TwilioProxyProvider({ accountSid: 'AC1', authToken: 'twilio-token-test', serviceSid: 'KS1' }));
    try {
      const { order } = await outForDelivery();
      const call = await hero.post(`${API}/hero/tasks/orders/${order.id}/call`).send({});
      expect(call.body).toMatchObject({ provider: 'twilio_proxy', masked: true, dial: 'tel:+201555000111' });
      expect(calls[0].url).toBe('https://proxy.twilio.com/v1/Services/KS1/Sessions');
      expect(calls.filter((c) => c.url.includes('/Participants'))).toHaveLength(2);
      const [row] = await t.db.select().from(s.callLogs).where(eq(s.callLogs.id, call.body.callLogId));
      expect(row).toMatchObject({ provider: 'twilio_proxy', providerCallId: 'KC123', proxyNumber: '+201555000111', status: 'RINGING' });

      const params = { InteractionSessionSid: 'KC123', OutboundResourceStatus: 'no-answer', InteractionType: 'Voice' };
      const url = `${config.appUrl}/api/v1/integrations/calls/twilio/status`;
      const bad = await t.http().post(`${API}/integrations/calls/twilio/status`).type('form').set('X-Twilio-Signature', 'nope').send(params);
      expect(bad.status).toBe(401);
      const ok = await t.http().post(`${API}/integrations/calls/twilio/status`).type('form').set('X-Twilio-Signature', twilioSignature('twilio-token-test', url, params)).send(params);
      expect(ok.body).toMatchObject({ ok: true, updated: 1 });
      expect((await t.db.select().from(s.callLogs).where(eq(s.callLogs.id, call.body.callLogId)))[0].status).toBe('NO_ANSWER');
      // the provider's result wins over the hero's report
      await hero.post(`${API}/hero/tasks/calls/${call.body.callLogId}/result`).send({ status: 'ANSWERED' }).expect(200);
      expect((await t.db.select().from(s.callLogs).where(eq(s.callLogs.id, call.body.callLogId)))[0].status).toBe('NO_ANSWER');

      // provider down → the hero still gets a direct, logged call
      fetchSpy.mockImplementation(async () => new Response('{"message":"down"}', { status: 503 }));
      const fallback = await hero.post(`${API}/hero/tasks/orders/${order.id}/call`).send({});
      expect(fallback.body).toMatchObject({ provider: 'direct', masked: false });
    } finally {
      fetchSpy.mockRestore();
      attempts.useCallProvider(new DirectCallProvider());
    }
  });
});
