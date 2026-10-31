import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchWithTimeout, requireEnv, snippet } from '../notifications/providers/http';

/**
 * Paymob (Accept) — Egypt.
 *
 * Payment links use the Intention API:
 *   POST {PAYMOB_BASE_URL}/v1/intention/   Authorization: Token <PAYMOB_SECRET_KEY>
 *   → { id, client_secret, … }; checkout = {base}/unifiedcheckout/?publicKey=<PAYMOB_PUBLIC_KEY>&clientSecret=<client_secret>
 *
 * Callbacks are authenticated with an HMAC-SHA512 (hex, key PAYMOB_HMAC_SECRET)
 * over the concatenated values of these transaction fields, in this exact
 * (lexicographic) order — booleans as "true"/"false", missing values as "":
 *
 *   amount_cents, created_at, currency, error_occured, has_parent_transaction, id,
 *   integration_id, is_3d_secure, is_auth, is_capture, is_refunded,
 *   is_standalone_payment, is_voided, order.id, owner, pending,
 *   source_data.pan, source_data.sub_type, source_data.type, success
 *
 * The processed callback (POST JSON { type: "TRANSACTION", obj }) sends the
 * HMAC as the `hmac` query parameter; the browser redirect (GET) sends the same
 * fields flattened as query parameters, with `order` instead of `order.id`.
 */
export const PAYMOB_HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure',
  'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
] as const;

const stringify = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));

function pick(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined), obj);
}

/** Concatenated string for a transaction object (POST callback). */
export function paymobConcatFromObject(obj: Record<string, unknown>): string {
  return PAYMOB_HMAC_FIELDS.map((f) => stringify(pick(obj, f))).join('');
}

/** Concatenated string for the redirect query parameters (GET callback). */
export function paymobConcatFromQuery(q: Record<string, unknown>): string {
  return PAYMOB_HMAC_FIELDS.map((f) => stringify(q[f === 'order.id' ? 'order' : f])).join('');
}

export const paymobHmac = (secret: string, concatenated: string) => createHmac('sha512', secret).update(concatenated).digest('hex');

export function verifyPaymobHmac(secret: string, concatenated: string, given: string | undefined | null): boolean {
  if (!given || !secret) return false;
  const expected = Buffer.from(paymobHmac(secret, concatenated), 'utf8');
  const received = Buffer.from(String(given).trim().toLowerCase(), 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export interface IntentionInput {
  amountCents: number;
  specialReference: string;
  description: string;
  customer: { firstName: string; lastName: string; phone: string; email?: string | null };
  address: { street: string; building?: string | null; floor?: string | null; apartment?: string | null; city?: string | null };
  notificationUrl: string;
  redirectionUrl: string;
  extras: Record<string, string>;
}

export interface IntentionResult {
  intentionId: string;
  clientSecret: string;
  checkoutUrl: string;
}

export class PaymobClient {
  get baseUrl() {
    return (process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com').replace(/\/$/, '');
  }

  async createIntention(input: IntentionInput): Promise<IntentionResult> {
    const integrationId = Number(requireEnv('PAYMOB_INTEGRATION_ID'));
    if (!Number.isInteger(integrationId)) throw new Error('PAYMOB_INTEGRATION_ID must be a number');
    const na = (v: string | null | undefined) => (v && v.trim() ? v.trim() : 'NA');
    const res = await fetchWithTimeout(`${this.baseUrl}/v1/intention/`, {
      method: 'POST',
      timeoutMs: 15_000,
      headers: { Authorization: `Token ${requireEnv('PAYMOB_SECRET_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: input.amountCents,
        currency: 'EGP',
        payment_methods: [integrationId],
        items: [{ name: input.description.slice(0, 50), amount: input.amountCents, description: input.description.slice(0, 255), quantity: 1 }],
        billing_data: {
          first_name: na(input.customer.firstName), last_name: na(input.customer.lastName), phone_number: input.customer.phone, email: na(input.customer.email),
          street: na(input.address.street).slice(0, 255), building: na(input.address.building), floor: na(input.address.floor), apartment: na(input.address.apartment),
          city: na(input.address.city), country: 'EG', state: 'NA',
        },
        customer: { first_name: na(input.customer.firstName), last_name: na(input.customer.lastName), email: na(input.customer.email) },
        special_reference: input.specialReference,
        notification_url: input.notificationUrl,
        redirection_url: input.redirectionUrl,
        extras: input.extras,
      }),
    });
    if (!res.ok) throw new Error(`Paymob intention failed (${res.status}): ${snippet(res.text, 300)}`);
    const body = (res.json ?? {}) as { id?: string | number; client_secret?: string };
    if (!body.client_secret || body.id === undefined) throw new Error('Paymob intention response is missing client_secret');
    const publicKey = requireEnv('PAYMOB_PUBLIC_KEY');
    return {
      intentionId: String(body.id),
      clientSecret: body.client_secret,
      checkoutUrl: `${this.baseUrl}/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(body.client_secret)}`,
    };
  }
}
