/**
 * COD risk scoring. Refused COD orders are the #1 cost driver for Egyptian
 * e-commerce couriers, so every new order gets a 0–100 score (higher = riskier)
 * and ops can require a confirmation call or prepayment above a threshold.
 */
export interface RiskInput {
  codAmountCents: number;
  customerTotalOrders: number;
  customerDelivered: number;
  customerRefused: number;
  isBlocked?: boolean;
  isFirstOrder?: boolean;
  addressLength: number;
  hasCoordinates: boolean;
  zoneTier: 'A' | 'B' | 'C' | 'D';
  createdHour?: number; // 0..23 Africa/Cairo
}

export interface RiskResult {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  factors: Array<{ key: string; points: number }>;
}

export function scoreCodRisk(input: RiskInput): RiskResult {
  const factors: Array<{ key: string; points: number }> = [];
  const add = (key: string, points: number) => points !== 0 && factors.push({ key, points });

  if (input.isBlocked) add('customer_blocked', 60);

  const completed = input.customerDelivered + input.customerRefused;
  if (completed === 0) add('new_customer', 15);
  else {
    const refusalRate = input.customerRefused / completed;
    add('refusal_history', Math.round(refusalRate * 55));
    if (input.customerDelivered >= 3 && refusalRate < 0.1) add('loyal_customer', -15);
  }

  const egp = input.codAmountCents / 100;
  if (egp >= 5000) add('very_high_cod', 20);
  else if (egp >= 2000) add('high_cod', 12);
  else if (egp >= 1000) add('medium_cod', 5);

  if (input.addressLength < 15) add('vague_address', 10);
  if (!input.hasCoordinates) add('no_pin', 3);
  if (input.zoneTier === 'C' || input.zoneTier === 'D') add('far_zone', 5);
  if (input.createdHour !== undefined && input.createdHour >= 1 && input.createdHour <= 5) add('late_night_order', 5);

  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));
  return { score, level: score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW', factors };
}

/** Customer reliability (0–100, higher = better) stored on the customer record. */
export function reliabilityScore(delivered: number, refused: number): number {
  const total = delivered + refused;
  if (total === 0) return 80;
  // Bayesian average with a prior of 4 successful deliveries out of 5.
  return Math.round(((delivered + 4) / (total + 5)) * 100);
}
