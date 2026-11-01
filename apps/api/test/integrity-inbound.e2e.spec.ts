import { and, desc, eq } from 'drizzle-orm';
import { normalizeEgyptPhone } from '@goturtle/shared';
import * as s from '../src/db/schema';
import { cairoToday } from '../src/db/helpers';
import { addDays } from '../src/modules/orders/ops-kit';
import { ConfirmationService } from '../src/modules/delivery-integrity/confirmation.service';
import type { TestContext } from './helpers';
import { bootTestApp, createTestBrand, orderBody, randomPhone } from './ops-factories';
import { orderRow, waBody, waSignature, waitFor } from './integrity-factories';

const API = '/api/v1';
const SECRET = 'wa-app-secret-test';
const VERIFY = 'wa-verify-token-test';
const SMS_KEY = 'sms-inbound-key-test';

/** WhatsApp Cloud API + generic SMS replies → confirmation / reschedule / decline / location. */
describe('Delivery integrity — inbound replies (e2e)', () => {
  let t: TestContext;
  let conf: ConfirmationService;
  const env = { ...process.env };

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY;
    process.env.SMS_INBOUND_SECRET = SMS_KEY;
    t = await bootTestApp();
    conf = t.app.get(ConfirmationService);
  });
  afterAll(async () => {
    process.env.WHATSAPP_APP_SECRET = env.WHATSAPP_APP_SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = env.WHATSAPP_VERIFY_TOKEN;
    process.env.SMS_INBOUND_SECRET = env.SMS_INBOUND_SECRET;
    await t.close();
  });

  /** An order that was asked to confirm (COD ≥ the confirmation amount). */
  async function pendingOrder(overrides: Record<string, unknown> = {}) {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const phone = randomPhone('010');
    const res = await b.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Mariam', phone }, codAmountCents: 200_000, ...overrides }));
    expect(res.status).toBe(201);
    expect(await conf.requestDue(new Date(), [res.body.id])).toBe(1);
    const e164 = normalizeEgyptPhone(phone)!;
    return { order: res.body as { id: string; trackingNumber: string }, e164, waId: e164.slice(1), brand };
  }

  function postWhatsApp(body: unknown, signature?: string) {
    const raw = JSON.stringify(body);
    const req = t.http().post(`${API}/integrations/inbound/whatsapp`).set('Content-Type', 'application/json');
    if (signature !== undefined) req.set('X-Hub-Signature-256', signature);
    return req.send(raw);
  }
  const signed = (body: unknown) => postWhatsApp(body, waSignature(SECRET, JSON.stringify(body)));

  const inboundFor = async (providerMessageId: string) => (await t.db.select().from(s.inboundMessages).where(eq(s.inboundMessages.providerMessageId, providerMessageId)))[0];
  const acks = (orderId: string, template: string) =>
    t.db.select().from(s.notifications).where(and(eq(s.notifications.orderId, orderId), eq(s.notifications.template, template))).orderBy(desc(s.notifications.createdAt));

  it('answers the Meta verification handshake only with the right token', async () => {
    const ok = await t.http().get(`${API}/integrations/inbound/whatsapp`).query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1158201444' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('1158201444');
    const bad = await t.http().get(`${API}/integrations/inbound/whatsapp`).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'x' });
    expect(bad.status).toBe(403);
  });

  it('rejects webhooks with a missing or wrong signature and stores nothing', async () => {
    const { waId } = await pendingOrder();
    const body = waBody(waId, { type: 'text', text: { body: '1' } }, 'wamid.bad-signature');
    expect((await postWhatsApp(body)).status).toBe(401);
    const wrong = await postWhatsApp(body, waSignature('another-secret', JSON.stringify(body)));
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_SIGNATURE');
    expect(await inboundFor('wamid.bad-signature')).toBeUndefined();
  });

  it('"1" on WhatsApp confirms, is acknowledged, and a re-delivered webhook is ignored', async () => {
    const { order, waId, e164 } = await pendingOrder();
    const body = waBody(waId, { type: 'text', text: { body: '1' } });
    const res = await signed(body);
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ orderId: order.id, intent: 'CONFIRM', applied: true, ack: 'confirmation_ack' });
    expect(await orderRow(t, order.id)).toMatchObject({ confirmationStatus: 'CONFIRMED', confirmationChannel: 'WHATSAPP' });
    const msgId = (body.entry[0].changes[0].value.messages[0] as { id: string }).id;
    const stored = await inboundFor(msgId);
    expect(stored).toMatchObject({ channel: 'WHATSAPP', fromPhone: e164, orderId: order.id, intent: 'CONFIRM', body: '1' });
    expect(stored.processedAt).toBeTruthy();
    const [ack] = await acks(order.id, 'confirmation_ack');
    expect(ack).toMatchObject({ channel: 'WHATSAPP', recipient: e164 });

    const again = await signed(body);
    expect(again.body.results[0]).toMatchObject({ duplicate: true, applied: false });
    expect(await acks(order.id, 'confirmation_ack')).toHaveLength(1);
  });

  it('"٢" (Arabic-Indic two) moves the delivery to tomorrow; "بعد بكره" to the day after', async () => {
    const { order, waId } = await pendingOrder();
    const res = await signed(waBody(waId, { type: 'text', text: { body: '٢' } }));
    expect(res.body.results[0]).toMatchObject({ intent: 'RESCHEDULE', applied: true, ack: 'reschedule_ack' });
    const row = await orderRow(t, order.id);
    expect(row.confirmationStatus).toBe('RESCHEDULED');
    expect(row.scheduledDate).toBe(addDays(cairoToday(), 1));
    const [ack] = await acks(order.id, 'reschedule_ack');
    expect(ack.body).toContain(addDays(cairoToday(), 1));
    expect(ack.body).toContain('?c=');

    await signed(waBody(waId, { type: 'text', text: { body: 'لا ممكن بعد بكره؟' } }));
    expect((await orderRow(t, order.id)).scheduledDate).toBe(addDays(cairoToday(), 2));
  });

  it('button replies and Franco/Arabic cancel words decline the delivery', async () => {
    const a = await pendingOrder();
    const res = await signed(waBody(a.waId, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'CANCEL', title: 'إلغاء' } } }));
    expect(res.body.results[0]).toMatchObject({ intent: 'CANCEL', applied: true, ack: 'decline_ack' });
    expect(await orderRow(t, a.order.id)).toMatchObject({ confirmationStatus: 'DECLINED', status: 'CANCELLED' });

    const b = await pendingOrder();
    await signed(waBody(b.waId, { type: 'text', text: { body: 'الغي الاوردر لو سمحت' } }));
    expect((await orderRow(t, b.order.id)).status).toBe('CANCELLED');

    const c = await pendingOrder();
    await signed(waBody(c.waId, { type: 'button', button: { text: 'Confirm', payload: 'CONFIRM' } }));
    expect((await orderRow(t, c.order.id)).confirmationStatus).toBe('CONFIRMED');
  });

  it('a WhatsApp location pins the order and verifies the address', async () => {
    const { order, waId } = await pendingOrder();
    const res = await signed(waBody(waId, { type: 'location', location: { latitude: 30.0601, longitude: 31.3402, name: 'Home' } }));
    expect(res.body.results[0]).toMatchObject({ intent: 'LOCATION', applied: true, ack: 'location_ack' });
    const row = await orderRow(t, order.id);
    expect(row).toMatchObject({ lat: 30.0601, lng: 31.3402 });
    const address = await waitFor(async () => {
      const [a] = await t.db.select().from(s.customerAddresses).where(eq(s.customerAddresses.customerId, row.customerId));
      return a?.isVerified ? a : null;
    });
    expect(address).toMatchObject({ source: 'WHATSAPP_LOCATION', lat: 30.0601, lng: 31.3402, isVerified: true });
    const [ev] = await t.db.select().from(s.orderEvents).where(and(eq(s.orderEvents.orderId, order.id), eq(s.orderEvents.reason, 'CUSTOMER_ADDRESS_UPDATE')));
    expect(ev.note).toContain('WhatsApp');

    // a pin in Alexandria is refused for a Nasr City order (stored, not applied)
    const far = await signed(waBody(waId, { type: 'location', location: { latitude: 31.2001, longitude: 29.9187 } }));
    expect(far.body.results[0]).toMatchObject({ applied: false, error: 'PIN_OUT_OF_ZONE' });
    expect((await orderRow(t, order.id)).lat).toBe(30.0601);
  });

  it('unknown text gets a help reply; unknown senders are stored unmatched', async () => {
    const { order, waId } = await pendingOrder();
    const res = await signed(waBody(waId, { type: 'text', text: { body: 'مين معايا؟' } }));
    expect(res.body.results[0]).toMatchObject({ orderId: order.id, intent: 'OTHER', applied: false, ack: 'inbound_help' });
    expect((await orderRow(t, order.id)).confirmationStatus).toBe('PENDING');

    const stranger = await signed(waBody('201099990000', { type: 'text', text: { body: '1' } }, 'wamid.stranger'));
    expect(stranger.body.results[0]).toMatchObject({ orderId: null, applied: false });
    expect(await inboundFor('wamid.stranger')).toMatchObject({ orderId: null, intent: 'OTHER' });
    const log = await (await t.as('support')).get(`${API}/integrity/inbound`).query({ limit: 20 });
    expect(log.status).toBe(200);
    expect(log.body.map((m: { providerMessageId: string }) => m.providerMessageId)).toContain('wamid.stranger');
  });

  it('SMS gateway replies (JSON and form) are authenticated with the shared key', async () => {
    const a = await pendingOrder();
    expect((await t.http().post(`${API}/integrations/inbound/sms`).query({ key: 'wrong' }).send({ from: a.e164, body: 'نعم' })).status).toBe(401);
    const ok = await t.http().post(`${API}/integrations/inbound/sms`).query({ key: SMS_KEY }).send({ from: `0${a.e164.slice(3)}`, body: 'نعم تمام', id: 'sms-1' });
    expect(ok.status).toBe(200);
    expect(ok.body.result).toMatchObject({ orderId: a.order.id, intent: 'CONFIRM', applied: true, ack: 'confirmation_ack' });
    expect(await orderRow(t, a.order.id)).toMatchObject({ confirmationStatus: 'CONFIRMED', confirmationChannel: 'SMS' });
    const [ack] = await acks(a.order.id, 'confirmation_ack');
    expect(ack.channel).toBe('SMS');

    const b = await pendingOrder();
    const form = await t.http().post(`${API}/integrations/inbound/sms`).query({ key: SMS_KEY }).type('form').send({ From: b.e164, Body: 'cancel please', MessageSid: 'SM123' });
    expect(form.body.result).toMatchObject({ intent: 'CANCEL', applied: true });
    expect((await orderRow(t, b.order.id)).status).toBe('CANCELLED');
    expect((await t.http().post(`${API}/integrations/inbound/sms`).query({ key: SMS_KEY }).send({ body: 'x' })).body.code).toBe('INVALID_PAYLOAD');
  });
});
