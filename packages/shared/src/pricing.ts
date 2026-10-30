import { applyBp } from './money';
import type { OrderType, PricingTier, ServiceLevel, FeesPayer, PaymentMethod } from './enums';

export interface RateCard {
  codFeeBp: number;
  codFeeMinCents: number;
  includedWeightGrams: number;
  extraKgCents: number;
  returnFeeBp: number;
  exchangeFeeCents: number;
  insuranceBp: number;
  vatBp: number;
  rules: Array<{ tier: PricingTier; serviceLevel: ServiceLevel; baseFeeCents: number }>;
}

export interface QuoteInput {
  tier: PricingTier;
  serviceLevel: ServiceLevel;
  type: OrderType;
  weightGrams: number;
  paymentMethod: PaymentMethod;
  codAmountCents: number;
  declaredValueCents?: number;
  feesPaidBy?: FeesPayer;
}

export interface Quote {
  shippingFeeCents: number;
  weightFeeCents: number;
  codFeeCents: number;
  insuranceCents: number;
  exchangeFeeCents: number;
  extraFeesCents: number; // weight + insurance + exchange
  subtotalCents: number;
  vatCents: number;
  totalFeesCents: number;
  /** What the hero must collect from the recipient. */
  collectFromRecipientCents: number;
  /** What the brand receives after fees (negative = brand owes GoTurtle). */
  netToBrandCents: number;
  breakdown: Array<{ key: string; cents: number }>;
}

export class PricingError extends Error {}

/** Service level fallback order when a plan has no explicit rule. */
const SERVICE_FALLBACK: Record<ServiceLevel, ServiceLevel[]> = {
  STANDARD: ['STANDARD'],
  SCHEDULED: ['SCHEDULED', 'STANDARD'],
  SAME_DAY: ['SAME_DAY'],
  EXPRESS: ['EXPRESS', 'SAME_DAY'],
};

export function findBaseFee(card: RateCard, tier: PricingTier, level: ServiceLevel): number {
  for (const candidate of SERVICE_FALLBACK[level]) {
    const rule = card.rules.find((r) => r.tier === tier && r.serviceLevel === candidate);
    if (rule) return rule.baseFeeCents;
  }
  throw new PricingError(`No rate for tier ${tier} / ${level}`);
}

/**
 * Deterministic fee calculation. Pure function — the API stores its result on
 * the order so later rate-card changes never rewrite history.
 */
export function quote(card: RateCard, input: QuoteInput): Quote {
  if (input.weightGrams < 0) throw new PricingError('weightGrams must be >= 0');
  if (input.codAmountCents < 0) throw new PricingError('codAmountCents must be >= 0');

  const shippingFeeCents = findBaseFee(card, input.tier, input.serviceLevel);
  const extraGrams = Math.max(0, input.weightGrams - card.includedWeightGrams);
  const weightFeeCents = Math.ceil(extraGrams / 1000) * card.extraKgCents;
  const isCod = input.paymentMethod === 'COD' && input.codAmountCents > 0;
  const codFeeCents = isCod ? Math.max(card.codFeeMinCents, applyBp(input.codAmountCents, card.codFeeBp)) : 0;
  const insuranceCents = applyBp(input.declaredValueCents ?? 0, card.insuranceBp);
  const exchangeFeeCents = input.type === 'EXCHANGE' ? card.exchangeFeeCents : 0;

  const extraFeesCents = weightFeeCents + insuranceCents + exchangeFeeCents;
  const subtotalCents = shippingFeeCents + codFeeCents + extraFeesCents;
  const vatCents = applyBp(subtotalCents, card.vatBp);
  const totalFeesCents = subtotalCents + vatCents;

  const feesOnRecipient = input.feesPaidBy === 'RECIPIENT';
  const collectFromRecipientCents = (isCod ? input.codAmountCents : 0) + (feesOnRecipient ? totalFeesCents : 0);
  const netToBrandCents = (isCod ? input.codAmountCents : 0) - (feesOnRecipient ? 0 : totalFeesCents);

  return {
    shippingFeeCents,
    weightFeeCents,
    codFeeCents,
    insuranceCents,
    exchangeFeeCents,
    extraFeesCents,
    subtotalCents,
    vatCents,
    totalFeesCents,
    collectFromRecipientCents,
    netToBrandCents,
    breakdown: [
      { key: 'shipping', cents: shippingFeeCents },
      { key: 'weight', cents: weightFeeCents },
      { key: 'cod', cents: codFeeCents },
      { key: 'insurance', cents: insuranceCents },
      { key: 'exchange', cents: exchangeFeeCents },
      { key: 'vat', cents: vatCents },
    ].filter((l) => l.cents > 0),
  };
}

/** Fee charged when an order is returned to origin (RTO): a % of the shipping fee, plus VAT. */
export function returnFee(card: Pick<RateCard, 'returnFeeBp' | 'vatBp'>, shippingFeeCents: number): number {
  const fee = applyBp(shippingFeeCents, card.returnFeeBp);
  return fee + applyBp(fee, card.vatBp);
}
