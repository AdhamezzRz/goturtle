/**
 * Tracking numbers: "GT" + 9 random digits + 1 Luhn check digit, e.g. GT4829150376.
 * The check digit catches single-digit typos and most transpositions when a
 * customer or hero types a number by hand.
 */
export const TRACKING_PREFIX = 'GT';

export function luhnCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function generateTrackingNumber(random: () => number = Math.random): string {
  let body = String(1 + Math.floor(random() * 9));
  for (let i = 0; i < 8; i++) body += String(Math.floor(random() * 10));
  return `${TRACKING_PREFIX}${body}${luhnCheckDigit(body)}`;
}

export function normalizeTrackingNumber(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function isValidTrackingNumber(input: string): boolean {
  const tn = normalizeTrackingNumber(input);
  if (!/^GT\d{10}$/.test(tn)) return false;
  const body = tn.slice(2, 11);
  return luhnCheckDigit(body) === Number(tn[11]);
}

/** Human code with a prefix and zero padding, e.g. formatCode('RS', 42, 5) -> RS-00042 */
export function formatCode(prefix: string, n: number, pad = 6): string {
  return `${prefix}-${String(n).padStart(pad, '0')}`;
}
