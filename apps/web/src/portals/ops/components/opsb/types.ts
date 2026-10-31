/** API response shapes shared by several workforce / finance screens. */

export type ShiftRow = {
  id: string;
  courierId: string;
  templateId: string | null;
  hubId: string | null;
  zoneId: string | null;
  startAt: string;
  endAt: string;
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
  clockInAt: string | null;
  clockOutAt: string | null;
  clockInLat: number | null;
  clockInLng: number | null;
  clockOutLat: number | null;
  clockOutLng: number | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  hourlyRateCents: number;
  payoutId: string | null;
  notes: string | null;
  day: string;
  scheduledMinutes: number;
  expectedEarningsCents: number;
  earnedCents: number;
  geofenceWarning: boolean;
  autoClockOut: boolean;
  courier: { id: string; code: string; name: string; employmentType: string };
  template: { id: string; name: string; startTime: string; endTime: string } | null;
  hub: { id: string; code: string; name: string } | null;
}

export type ShiftList = {
  from: string;
  to: string;
  total: number;
  summary: { byStatus: Record<string, number>; scheduledMinutes: number; workedMinutes: number; earnedCents: number };
  data: ShiftRow[];
}

export type HandoverRow = {
  id: string;
  code: string;
  courierId: string;
  hubId: string | null;
  method: string;
  declaredCents: number;
  receivedCents: number;
  varianceCents: number;
  reference: string | null;
  proofUrl: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  notes: string | null;
  confirmedAt: string | null;
  createdAt: string;
  courier: { id: string; code: string; name: string; phone: string };
  hub: { id: string; code: string; name: string } | null;
  receivedBy: { id: string; name: string } | null;
}

export type PayoutRow = {
  id: string;
  code: string;
  courierId: string;
  periodStart: string;
  periodEnd: string;
  deliveriesCount: number;
  pickupsCount: number;
  failedAttemptsCount: number;
  workedMinutes: number;
  deliveryEarningsCents: number;
  hourlyEarningsCents: number;
  salaryCents: number;
  bonusesCents: number;
  deductionsCents: number;
  netCents: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
  method: string | null;
  paymentReference: string | null;
  paidAt: string | null;
  createdAt: string;
  periodNetCents: number;
  carryOverCents: number;
  courier: { id: string; code: string; name: string; employmentType: string; walletPhone: string | null };
}

export type AdjustmentRow = {
  id: string;
  courierId: string;
  type: string;
  amountCents: number;
  reason: string;
  orderId: string | null;
  payoutId: string | null;
  createdAt: string;
  isReversal: boolean;
  reversesId: string | null;
  signedAmountCents: number;
  courier: { id: string; code: string; name: string };
  order: { id: string; trackingNumber: string } | null;
}

export type CustodyRow = {
  courierId: string;
  code: string;
  name: string;
  phone: string;
  status: string;
  availability: string;
  employmentType: string;
  homeHubId: string | null;
  cashOnHandCents: number;
  cashLimitCents: number;
  hub: { id: string; code: string; name: string } | null;
  usedPct: number;
  warning: string;
  unhandedOrders: number;
  unhandedCents: number;
  oldestUnhandedAt: string | null;
  oldestUnhandedHours: number | null;
  pendingHandovers: number;
  pendingDeclaredCents: number;
  outstandingShortageCents: number;
}

export type CustodyList = {
  data: CustodyRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  totals: { heroes: number; custodyCents: number; overLimit: number; nearLimit: number; pendingHandovers: number; pendingDeclaredCents: number; outstandingShortageCents: number };
}
