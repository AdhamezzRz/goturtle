import { createHmac } from 'node:crypto';
import type { CallStatus } from '@goturtle/shared';
import { safeEqual } from '../../common/crypto';
import { fetchWithTimeout, snippet } from '../notifications/providers/http';

/**
 * Hero → recipient calling. `direct` hands the hero the recipient's number
 * (the call is logged, then the phone dialer opens). `twilio_proxy` creates a
 * Twilio Proxy session so both sides only ever see a masked proxy number and
 * Twilio reports the real call outcome to our status webhook.
 */
export interface CallSessionInput {
  /** Our call log id (used as the provider's unique name). */
  callLogId: string;
  heroPhone: string;
  recipientPhone: string;
  /** Session lifetime in seconds. */
  ttlSeconds: number;
}

export interface CallSession {
  /** What the hero dials. */
  dialNumber: string;
  providerCallId: string | null;
  proxyNumber: string | null;
}

export interface CallProvider {
  readonly name: 'direct' | 'twilio_proxy';
  readonly masked: boolean;
  start(input: CallSessionInput): Promise<CallSession>;
}

export class DirectCallProvider implements CallProvider {
  readonly name = 'direct' as const;
  readonly masked = false;
  async start(input: CallSessionInput): Promise<CallSession> {
    return { dialNumber: input.recipientPhone, providerCallId: null, proxyNumber: null };
  }
}

export interface TwilioProxyConfig {
  accountSid: string;
  authToken: string;
  serviceSid: string;
  /** Override for tests / regional edges. */
  baseUrl?: string;
}

export class CallProviderError extends Error {}

export class TwilioProxyProvider implements CallProvider {
  readonly name = 'twilio_proxy' as const;
  readonly masked = true;
  constructor(private readonly cfg: TwilioProxyConfig) {}

  private get base() {
    return (this.cfg.baseUrl ?? 'https://proxy.twilio.com/v1').replace(/\/$/, '');
  }

  private async post(path: string, form: Record<string, string>) {
    const res = await fetchWithTimeout(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form),
      timeoutMs: 8_000,
    });
    if (!res.ok) throw new CallProviderError(`Twilio Proxy ${path} failed (${res.status}): ${snippet(res.text)}`);
    return res.json as Record<string, unknown>;
  }

  async start(input: CallSessionInput): Promise<CallSession> {
    const session = await this.post(`/Services/${this.cfg.serviceSid}/Sessions`, {
      UniqueName: `gt-call-${input.callLogId}`,
      Ttl: String(input.ttlSeconds),
      Mode: 'voice-only',
    });
    const sessionSid = String(session.sid ?? '');
    if (!sessionSid) throw new CallProviderError('Twilio Proxy returned no session sid');
    const participants = `/Services/${this.cfg.serviceSid}/Sessions/${sessionSid}/Participants`;
    const hero = await this.post(participants, { Identifier: input.heroPhone, FriendlyName: 'hero' });
    await this.post(participants, { Identifier: input.recipientPhone, FriendlyName: 'recipient' });
    const proxy = String(hero.proxy_identifier ?? '');
    if (!proxy) throw new CallProviderError('Twilio Proxy returned no proxy number');
    return { dialNumber: proxy, providerCallId: sessionSid, proxyNumber: proxy };
  }
}

/** twilio_proxy when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PROXY_SERVICE_SID are set, else direct. */
export function callProviderFromEnv(env: NodeJS.ProcessEnv = process.env): CallProvider {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PROXY_SERVICE_SID } = env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PROXY_SERVICE_SID) {
    return new TwilioProxyProvider({ accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN, serviceSid: TWILIO_PROXY_SERVICE_SID, baseUrl: env.TWILIO_PROXY_BASE_URL });
  }
  return new DirectCallProvider();
}

/**
 * Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted(key + value)…)).
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export const verifyTwilioSignature = (authToken: string, url: string, params: Record<string, string>, header: string | undefined) =>
  !!header && safeEqual(twilioSignature(authToken, url, params), header);

/** Twilio call / interaction status → our CallStatus (null = still in progress). */
export function mapTwilioStatus(status: string | undefined | null): CallStatus | null {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
    case 'answered':
    case 'in-progress':
      return 'ANSWERED';
    case 'no-answer':
      return 'NO_ANSWER';
    case 'busy':
      return 'BUSY';
    case 'failed':
    case 'canceled':
    case 'cancelled':
      return 'FAILED';
    case 'ringing':
    case 'initiated':
    case 'queued':
      return 'RINGING';
    default:
      return null;
  }
}
