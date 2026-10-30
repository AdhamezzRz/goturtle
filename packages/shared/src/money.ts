/** All money in GoTurtle is an integer number of piasters (1 EGP = 100 piasters). */

export const PIASTERS_PER_EGP = 100;

/** 12.5 EGP -> 1250. Rounds half away from zero to avoid float artefacts (0.1 + 0.2). */
export function egpToCents(egp: number): number {
  if (!Number.isFinite(egp)) throw new RangeError(`Invalid EGP amount: ${egp}`);
  // toPrecision(15) removes binary noise first: 1.005 * 100 = 100.49999999999999 -> 100.5 -> 101
  return Math.sign(egp) * Math.round(Number((Math.abs(egp) * PIASTERS_PER_EGP).toPrecision(15)));
}

export function centsToEgp(cents: number): number {
  return cents / PIASTERS_PER_EGP;
}

/** Applies basis points (1 bp = 0.01%) and rounds to the nearest piaster. */
export function applyBp(amountCents: number, bp: number): number {
  return Math.round((amountCents * bp) / 10_000);
}

export function formatEgp(cents: number, locale: 'en' | 'ar' = 'en', opts: { compact?: boolean } = {}): string {
  const value = centsToEgp(cents);
  const fmt = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    style: 'currency',
    currency: 'EGP',
    notation: opts.compact ? 'compact' : 'standard',
    minimumFractionDigits: opts.compact || Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return fmt.format(value);
}

export function sumCents(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}
