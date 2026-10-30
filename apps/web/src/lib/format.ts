import { centsToEgp, formatEgyptPhone, ORDER_STATUS_LABELS, type OrderStatus } from '@goturtle/shared';
import { formatDistanceToNowStrict } from 'date-fns';
import { ar, enGB } from 'date-fns/locale';
import { getLocale } from '@/i18n';

const nf = () => new Intl.NumberFormat(getLocale() === 'ar' ? 'ar-EG' : 'en-EG');

export function money(cents: number | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const v = centsToEgp(cents ?? 0);
  const locale = getLocale() === 'ar' ? 'ar-EG' : 'en-EG';
  const s = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EGP',
    notation: opts.compact ? 'compact' : 'standard',
    minimumFractionDigits: 0,
    maximumFractionDigits: opts.compact ? 1 : 2,
    signDisplay: opts.sign ? 'exceptZero' : 'auto',
  }).format(v);
  return s;
}

export const num = (n: number | null | undefined) => nf().format(n ?? 0);

export const pct = (ratio: number | null | undefined, digits = 1) =>
  new Intl.NumberFormat(getLocale() === 'ar' ? 'ar-EG' : 'en-EG', { style: 'percent', maximumFractionDigits: digits }).format(ratio ?? 0);

export function dateTime(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!d) return '—';
  return new Intl.DateTimeFormat(getLocale() === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', ...opts }).format(new Date(d));
}

export const dateOnly = (d: string | Date | null | undefined) => dateTime(d, { dateStyle: 'medium' });
export const timeOnly = (d: string | Date | null | undefined) => dateTime(d, { timeStyle: 'short' });

export function ago(d: string | Date | null | undefined) {
  if (!d) return '—';
  return formatDistanceToNowStrict(new Date(d), { addSuffix: true, locale: getLocale() === 'ar' ? ar : enGB });
}

export const phone = (p: string | null | undefined) => (p ? formatEgyptPhone(p) : '—');

export const statusLabel = (s: OrderStatus) => ORDER_STATUS_LABELS[s]?.[getLocale()] ?? s;

/** Business day in Cairo, YYYY-MM-DD. */
export function cairoToday(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** "1500" or "1,500.50" EGP text → piasters. */
export function parseEgp(input: string): number | null {
  const cleaned = input.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
