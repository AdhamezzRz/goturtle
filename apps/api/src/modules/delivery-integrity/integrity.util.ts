import { createHash, createHmac } from 'node:crypto';
import { haversineKm, toLatinDigits, type OrderStatus } from '@goturtle/shared';
import { config } from '../../config';
import { safeEqual } from '../../common/crypto';
import { addDays } from '../orders/ops-kit';

/**
 * Pure helpers for delivery integrity: signed customer links, reply intent
 * parsing and the call-spacing rule. No DI, fully unit-testable.
 */

// ---------------------------------------------------------------------------
//  Hold reasons & status groups
// ---------------------------------------------------------------------------

/** Machine codes stored in orders.holdReason by this module. */
export const HoldReason = {
  UNCONFIRMED: 'UNCONFIRMED',
  PREPAY_REQUIRED: 'PREPAY_REQUIRED',
  HIGH_RISK: 'HIGH_RISK',
  CUSTOMER_BLOCKED: 'CUSTOMER_BLOCKED',
} as const;
export type HoldReason = (typeof HoldReason)[keyof typeof HoldReason];

/** Holds that block dispatch until released by the integrity rules (or a manager override). */
export const INTEGRITY_HOLD_REASONS: readonly string[] = Object.values(HoldReason);

/** Before the parcel leaves the network for the customer: confirmation still matters. */
export const PRE_DISPATCH: readonly OrderStatus[] = ['CREATED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'RECEIVED_AT_HUB'];
/** Statuses the state machine lets us put ON_HOLD from (and that are pre-dispatch). */
export const HOLDABLE: readonly OrderStatus[] = ['CREATED', 'PICKUP_ASSIGNED', 'RECEIVED_AT_HUB'];
/** Not yet with a hero for pickup: a decline simply cancels. */
export const BEFORE_PICKUP: readonly OrderStatus[] = ['CREATED', 'PICKUP_ASSIGNED'];
/** Address / pin can still be fixed by the customer. */
export const PIN_EDITABLE: readonly OrderStatus[] = [
  'CREATED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'ON_HOLD', 'FAILED_ATTEMPT', 'RESCHEDULED', 'OUT_FOR_DELIVERY',
];
/** Failure reasons that claim the customer could not be reached at the door. */
export const UNREACHABLE_REASONS: readonly string[] = ['CUSTOMER_UNREACHABLE', 'CUSTOMER_NOT_PRESENT'];
/** Calls older than this do not count towards an attempt. */
export const CALL_WINDOW_MS = 2 * 3_600_000;
/** Customer pins further than this from the zone centre are refused. */
export const PIN_MAX_KM = 15;

// ---------------------------------------------------------------------------
//  Signed customer links
// ---------------------------------------------------------------------------

/** What a signed link lets the customer do without logging in. */
export type LinkScope = 'confirm' | 'attempt' | 'pin';
const SCOPE_CODE: Record<LinkScope, string> = { confirm: 'c', attempt: 'a', pin: 'p' };

/** Secret derived from the JWT access secret (rotating the JWT secret invalidates every link). */
const linkSecret = () => createHash('sha256').update(`goturtle:integrity-links:${config.jwt.accessSecret}`).digest();

const sign = (payload: string) => createHmac('sha256', linkSecret()).update(payload).digest('base64url').slice(0, 22);

/**
 * Token = "<scope><expiry base36>.<hmac>" where hmac = HMAC-SHA256(secret, tn|scope|subject|expiry).
 * `subject` binds the token to e.g. one delivery attempt id.
 */
export function signLink(tn: string, scope: LinkScope, ttlMs: number, subject = '', now = Date.now()): string {
  const exp = Math.floor((now + ttlMs) / 1000).toString(36);
  return `${SCOPE_CODE[scope]}${exp}.${sign(`${tn}|${scope}|${subject}|${exp}`)}`;
}

export type LinkCheck = { ok: true; expiresAt: Date } | { ok: false; reason: 'MALFORMED' | 'EXPIRED' | 'INVALID' };

export function verifyLink(token: string | null | undefined, tn: string, scope: LinkScope, subject = '', now = Date.now()): LinkCheck {
  if (!token || typeof token !== 'string' || token.length > 80) return { ok: false, reason: 'MALFORMED' };
  const m = /^([cap])([0-9a-z]{1,10})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m || m[1] !== SCOPE_CODE[scope]) return { ok: false, reason: 'MALFORMED' };
  const expected = sign(`${tn}|${scope}|${subject}|${m[2]}`);
  if (!safeEqual(expected, m[3])) return { ok: false, reason: 'INVALID' };
  const expiresAt = new Date(parseInt(m[2], 36) * 1000);
  if (expiresAt.getTime() < now) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, expiresAt };
}

export const trackingLink = (tn: string, query: Record<string, string> = {}) => {
  const qs = new URLSearchParams(query).toString();
  return `${config.appUrl}/t/${tn}${qs ? `?${qs}` : ''}`;
};

// ---------------------------------------------------------------------------
//  Reply intent parsing (WhatsApp / SMS)
// ---------------------------------------------------------------------------

export type ReplyKind = 'YES' | 'NO' | 'CHANGE' | 'CANCEL' | 'UNKNOWN';
export interface ParsedReply {
  kind: ReplyKind;
  /** Requested delivery day for CHANGE when the customer named one (YYYY-MM-DD, Cairo). */
  date?: string;
  /** The option number the customer typed (1/2/3), when any. */
  option?: number;
}

/** Arabic letter variants folded, digits latinised, punctuation and emoji stripped. */
export function normalizeReply(text: string): string {
  return toLatinDigits(text)
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/(\p{L})\1+/gu, '$1') // "اييييوه" → "ايوه", "laaa" → "la"
    .replace(/[^\p{L}\p{N}\s/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const YES = ['نعم', 'ايوه', 'ايوا', 'ايوة', 'اه', 'اة', 'ااه', 'تمام', 'اكيد', 'اكد', 'اكدت', 'موافق', 'مظبوط', 'صح', 'صحيح', 'حاضر', 'ماشي', 'تم', 'اوكي', 'اوك',
  'yes', 'yeah', 'yep', 'ok', 'okay', 'confirm', 'confirmed', 'sure', 'correct', 'true', 'aywa', 'aiwa', 'aywah', 'aah', 'tmam', 'tamam', 'akid', 'akeed', 'mashy', 'mashi', 'sah', 'y'];
const NO = ['لا', 'لأ', 'لاء', 'مش صحيح', 'مش صح', 'غلط', 'كدب', 'كذب', 'محدش جه', 'محدش اتصل', 'ماجاش', 'محصلش', 'محصلتش',
  'no', 'nope', 'not true', 'false', 'wrong', 'la', 'laa', 'la2', 'ghalat', 'mesh sah', 'msh sah', 'n'];
const CANCEL = ['الغي', 'الغاء', 'الغيه', 'الغى', 'كنسل', 'مش عايز', 'مش عاوز', 'مش عايزه', 'مش عاوزه', 'مش هستلم', 'ارفض', 'رفض', 'مش محتاج',
  'cancel', 'cancelled', 'decline', 'refuse', 'dont want', 'do not want', 'elghi', 'el8y', 'el8i', 'cancell', 'mesh 3ayez', 'msh 3ayez', 'msh 3awz', 'mesh 3awez'];
const CHANGE = ['غير', 'تغيير', 'غيرو', 'غيروا', 'اجل', 'تاجيل', 'اجلو', 'اجلوا', 'يوم تاني', 'ميعاد تاني', 'موعد تاني', 'بعدين', 'مش النهارده', 'بكره', 'بكرة', 'بعد بكره',
  'change', 'reschedule', 'later', 'another day', 'postpone', 'tomorrow', 'bokra', 'bukra', 'ba3d bokra', 'ghayar', 'a2agel'];

const hasPhrase = (text: string, list: readonly string[]) => {
  const padded = ` ${text} `;
  return list.some((w) => {
    const n = normalizeReply(w);
    return n.length > 0 && (padded.includes(` ${n} `) || (n.length >= 5 && text.includes(n)));
  });
};

const WEEKDAYS: Array<{ day: number; words: string[] }> = [
  { day: 0, words: ['الاحد', 'احد', 'sunday', 'sun', 'el7ad'] },
  { day: 1, words: ['الاتنين', 'الاثنين', 'اتنين', 'monday', 'mon', 'etneen'] },
  { day: 2, words: ['الثلاثاء', 'التلات', 'تلات', 'tuesday', 'tue', 'talat'] },
  { day: 3, words: ['الاربع', 'الاربعاء', 'اربع', 'wednesday', 'wed', 'arba3'] },
  { day: 4, words: ['الخميس', 'خميس', 'thursday', 'thu', 'khamis'] },
  { day: 5, words: ['الجمعه', 'جمعه', 'friday', 'fri', 'gom3a'] },
  { day: 6, words: ['السبت', 'سبت', 'saturday', 'sat', 'sabt'] },
];

/** Picks a delivery day out of a free-text reply ("بكره", "بعد بكره", "السبت", "5/11", "2026-11-05"). */
export function parseDay(text: string, today: string): string | undefined {
  const t = normalizeReply(text);
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dm = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/.exec(t);
  if (dm) {
    const [y, m] = today.split('-').map(Number);
    const month = Number(dm[2]);
    const year = month < m ? y + 1 : y;
    return `${year}-${String(month).padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  }
  if (hasPhrase(t, ['بعد بكره', 'بعد بكرة', 'day after tomorrow', 'ba3d bokra'])) return addDays(today, 2);
  if (hasPhrase(t, ['بكره', 'بكرة', 'tomorrow', 'bokra', 'bukra'])) return addDays(today, 1);
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  for (const w of WEEKDAYS) {
    if (hasPhrase(t, w.words)) {
      const diff = (w.day - todayDow + 7) % 7 || 7;
      return addDays(today, diff);
    }
  }
  return undefined;
}

/**
 * Understands short customer replies in Arabic, Franco-Arabic and English:
 * option digits (1/2/3, also Arabic-Indic ١/٢/٣), yes/no words, cancel and
 * change-day phrases. Button payloads like "CONFIRM" / "DISPUTE" are accepted too.
 */
export function parseReply(raw: string | null | undefined, today: string): ParsedReply {
  if (!raw) return { kind: 'UNKNOWN' };
  const text = normalizeReply(raw);
  if (!text) return { kind: 'UNKNOWN' };
  const upper = raw.trim().toUpperCase();
  if (['CONFIRM', 'ATTEMPT_TRUE', 'YES'].includes(upper)) return { kind: 'YES' };
  if (['DISPUTE', 'ATTEMPT_FALSE', 'NO'].includes(upper)) return { kind: 'NO' };
  if (['CANCEL', 'DECLINE'].includes(upper)) return { kind: 'CANCEL' };
  if (['RESCHEDULE', 'CHANGE'].includes(upper)) return { kind: 'CHANGE' };

  const digit = /^([123])(\s|$)/.exec(text) ?? (/^\D{0,12}\b([123])\b\D{0,12}$/.exec(text) as RegExpExecArray | null);
  if (digit) {
    const option = Number(digit[1]);
    const kind: ReplyKind = option === 1 ? 'YES' : option === 2 ? 'CHANGE' : 'CANCEL';
    return { kind, option, ...(option === 2 ? { date: parseDay(text.slice(1), today) } : {}) };
  }
  // Order matters: "مش عايز" (cancel) before "لا" (no), change-day before yes ("تمام بكره").
  if (hasPhrase(text, CANCEL)) return { kind: 'CANCEL' };
  if (hasPhrase(text, CHANGE)) return { kind: 'CHANGE', date: parseDay(text, today) };
  if (hasPhrase(text, NO)) return { kind: 'NO' };
  if (hasPhrase(text, YES)) return { kind: 'YES' };
  return { kind: 'UNKNOWN' };
}

// ---------------------------------------------------------------------------
//  Geofence & calls
// ---------------------------------------------------------------------------

export const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.round(haversineKm(a, b) * 1000);

/**
 * Number of calls that count: inside the window, each at least `spacingMinutes`
 * after the previous counted one (so three taps in ten seconds count once).
 */
export function spacedCallCount(startedAt: Date[], spacingMinutes: number, now = Date.now(), windowMs = CALL_WINDOW_MS): number {
  const times = startedAt.map((d) => d.getTime()).filter((t) => t >= now - windowMs && t <= now + 60_000).sort((a, b) => a - b);
  let counted = 0;
  let last = -Infinity;
  for (const t of times) {
    if (t - last >= spacingMinutes * 60_000) {
      counted++;
      last = t;
    }
  }
  return counted;
}

/** Calls the attempt rules require for this failure (0 = none). */
export function requiredCalls(reason: string, hasDestinationPin: boolean, minCalls: number): number {
  const byReason = UNREACHABLE_REASONS.includes(reason) ? minCalls : 0;
  return Math.max(byReason, hasDestinationPin ? 0 : 1);
}

/** Next instant a call would count again, or null when one could count now. */
export function nextCountedCallAt(startedAt: Date[], spacingMinutes: number, now = Date.now()): Date | null {
  const times = startedAt.map((d) => d.getTime()).filter((t) => t >= now - CALL_WINDOW_MS && t <= now + 60_000).sort((a, b) => a - b);
  let last = -Infinity;
  for (const t of times) if (t - last >= spacingMinutes * 60_000) last = t;
  if (!Number.isFinite(last)) return null;
  const at = last + spacingMinutes * 60_000;
  return at > now ? new Date(at) : null;
}
