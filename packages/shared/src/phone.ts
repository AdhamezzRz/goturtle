/**
 * Egyptian phone numbers.
 * Mobile: 01[0125]XXXXXXXX (11 digits local) -> +201[0125]XXXXXXXX
 * Operators: 010 Vodafone, 011 Etisalat (e&), 012 Orange, 015 WE.
 */
const ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d);
}

export type EgyptOperator = 'VODAFONE' | 'ETISALAT' | 'ORANGE' | 'WE';

const OPERATORS: Record<string, EgyptOperator> = { '0': 'VODAFONE', '1': 'ETISALAT', '2': 'ORANGE', '5': 'WE' };

/** Returns E.164 (+201XXXXXXXXX) or null if the number is not a valid Egyptian mobile. */
export function normalizeEgyptPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = toLatinDigits(String(raw)).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('20') && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`;
  if (!/^01[0125]\d{8}$/.test(digits)) return null;
  return `+20${digits.slice(1)}`;
}

export function isValidEgyptPhone(raw: string | null | undefined): boolean {
  return normalizeEgyptPhone(raw) !== null;
}

export function egyptOperator(raw: string): EgyptOperator | null {
  const e164 = normalizeEgyptPhone(raw);
  if (!e164) return null;
  return OPERATORS[e164.charAt(4)] ?? null;
}

/** +201001234567 -> 0100 123 4567 */
export function formatEgyptPhone(raw: string): string {
  const e164 = normalizeEgyptPhone(raw);
  if (!e164) return raw;
  const local = `0${e164.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** +201001234567 -> 0100****567 (for public tracking pages) */
export function maskPhone(raw: string): string {
  const e164 = normalizeEgyptPhone(raw);
  const local = e164 ? `0${e164.slice(3)}` : raw;
  if (local.length < 7) return '****';
  return `${local.slice(0, 4)}****${local.slice(-3)}`;
}
