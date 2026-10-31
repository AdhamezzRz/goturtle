import { translate } from '@/i18n';
import { cairoToday } from '@/lib/format';

/** tel: link (E.164 works everywhere). */
export const telLink = (phone: string | null | undefined) => (phone ? `tel:${phone.replace(/\s+/g, '')}` : undefined);

/** Egyptian mobile → wa.me digits (2011…). */
export function waDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('20')) return d;
  if (d.startsWith('0')) return `2${d}`;
  return `20${d}`;
}

/** Cairo hour (0–23) right now. */
export function cairoHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(d));
}

/** Polite Arabic WhatsApp message to the recipient (customers are always addressed in Arabic). */
export function whatsappLink(phone: string, opts: { recipient: string; hero: string; brand: string; trackingNumber: string }) {
  const greeting = cairoHour() < 12 ? 'صباح الخير' : 'مساء الخير';
  const first = opts.recipient.split(/\s+/)[0] ?? opts.recipient;
  const text =
    `${greeting} أستاذ/ة ${first} 👋\n` +
    `معاك ${opts.hero} مندوب جو تيرتل 🐢\n` +
    `معايا شحنتك من ${opts.brand} (رقم ${opts.trackingNumber}) وأنا في الطريق ليك.\n` +
    'ياريت تبعتلي اللوكيشن أو تأكدلي العنوان علشان أوصلك بسرعة. شكراً لحضرتك 🙏';
  return `https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(text)}`;
}

/** Google Maps directions (coordinates) or search (address). */
export function directionsLink(lat: number | null | undefined, lng: number | null | undefined, address?: string | null) {
  if (lat != null && lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, Cairo`)}`;
  return undefined;
}

/** Coordinates embedded in a Google Maps "destination=lat,lng" link. */
export function coordsFromMapsUrl(url: string | null | undefined): [number, number] | null {
  const m = url?.match(/destination=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** "2h 15m" / "45m" / "3d 4h" in the current locale. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return translate('hero.dur.dh', { d, h });
  if (h > 0) return translate('hero.dur.hm', { h, m });
  return translate('hero.dur.m', { m });
}

export const minutesLabel = (min: number) => duration(min * 60_000);

/** Cairo day ± offset and handy ranges (YYYY-MM-DD). */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function periodRange(period: 'today' | 'week' | 'month'): { from: string; to: string } {
  const today = cairoToday();
  if (period === 'today') return { from: today, to: today };
  if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  // Egyptian work week starts on Saturday.
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  const back = (dow + 1) % 7;
  return { from: addDays(today, -back), to: today };
}

/** Age in hours → compact label. */
export function ageLabel(hours: number | null | undefined) {
  if (hours == null) return '—';
  return duration(hours * 3_600_000);
}
