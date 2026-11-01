import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import type { TestContext } from './helpers';

/**
 * Delivery-integrity test helpers. The failed-attempt rules need logged calls
 * spaced a few minutes apart; tests cannot wait, so calls are backdated.
 */
export async function logSpacedCalls(t: TestContext, orderId: string, courierId: string, n = 2, spacingMinutes = 5) {
  const now = Date.now();
  const rows = Array.from({ length: n }, (_, i) => {
    const at = new Date(now - (n - i) * spacingMinutes * 60_000);
    return { orderId, courierId, provider: 'direct', status: 'NO_ANSWER' as const, startedAt: at, endedAt: at, createdAt: at };
  });
  if (rows.length) await t.db.insert(s.callLogs).values(rows);
}

/** Polls until `fn` returns a truthy value (async event listeners run after the HTTP response). */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 4000, stepMs = 50): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export async function orderRow(t: TestContext, id: string) {
  const [o] = await t.db.select().from(s.orders).where(eq(s.orders.id, id)).limit(1);
  return o;
}

/** Meta X-Hub-Signature-256 for a raw JSON body. */
export const waSignature = (secret: string, raw: string) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

/** A WhatsApp Cloud API webhook body with one message. */
export function waBody(from: string, message: Record<string, unknown>, id = `wamid.${Math.random().toString(36).slice(2)}`) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1' }, contacts: [{ wa_id: from }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }],
  };
}
