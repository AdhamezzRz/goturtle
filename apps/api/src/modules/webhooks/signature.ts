import { hmacSha256, randomToken, safeEqual } from '../../common/crypto';

/**
 * Webhook signatures
 * ==================
 *
 * Every delivery carries
 *
 *   X-GoTurtle-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *   X-GoTurtle-Event:     order.delivered
 *   X-GoTurtle-Delivery:  <delivery id — stable across retries>
 *
 * How a receiver verifies it (Node.js):
 *
 *   const header = req.get('X-GoTurtle-Signature');              // "t=1730000000,v1=5f2b…"
 *   const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
 *   const expected = crypto.createHmac('sha256', process.env.GOTURTLE_WEBHOOK_SECRET)
 *     .update(`${parts.t}.${rawBody}`)                            // the exact bytes received, before JSON.parse
 *     .digest('hex');
 *   const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))
 *     && Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;    // reject replays older than 5 minutes
 *
 * PHP: hash_hmac('sha256', $t . '.' . $rawBody, $secret) and hash_equals().
 * Respond with any 2xx within 10 seconds; anything else is retried with
 * backoff (1m, 5m, 15m, 1h, 3h, 6h, 12h, 24h) and then marked DEAD. Use the
 * payload `id` (event id) to de-duplicate — a retried or re-delivered event keeps it.
 */
export const SIGNATURE_HEADER = 'X-GoTurtle-Signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const newWebhookSecret = () => `whsec_${randomToken(24)}`;

export function signPayload(secret: string, body: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

/** Reference verifier (used by tests and handy for SDKs). */
export function verifySignature(secret: string, body: string, header: string | null | undefined, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(now / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  return safeEqual(hmacSha256(secret, `${t}.${body}`), parts.v1);
}
