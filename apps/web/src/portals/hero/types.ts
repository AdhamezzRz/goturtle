/** Response shapes of the hero endpoints (/api/v1/hero/tasks/* and /api/v1/hero/me/*). */
import type { FailureReason, HandoverMethod, OrderStatus } from '@goturtle/shared';

export type Bilingual = { en: string; ar: string };
export type Availability = 'ONLINE' | 'OFFLINE' | 'ON_BREAK' | 'BUSY';
export type CashWarning = 'OK' | 'NEAR_LIMIT' | 'OVER_LIMIT' | string;

export type ZoneRef = { code: string; nameEn: string; nameAr: string };

// ---------------------------------------------------------------- today

export interface TodayStop {
  orderId: string;
  seq: number | null;
  trackingNumber: string;
  status: OrderStatus;
  statusLabel: Bilingual;
  isOpen: boolean;
  recipientName: string;
  address: string;
  landmark: string | null;
  zone: ZoneRef;
  collectCents: number;
  paymentMethod: 'COD' | 'PREPAID';
  attempts: number;
  etaMinutes: number | null;
  eta: string | null;
  legKm: number | null;
  deliveryOtpRequired: boolean;
  mapsUrl: string | null;
  brand: { id: string; code: string; name: string };
}

export interface TodayRunsheet {
  id: string;
  code: string;
  date: string;
  status: 'DRAFT' | 'DISPATCHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED';
  dispatchedAt: string | null;
  startedAt: string | null;
  totalDistanceKm: number | null;
  totalMinutes: number | null;
  expectedCodCents: number;
  collectedCents: number;
  canStart: boolean;
  stops: TodayStop[];
}

export interface PickupLocation {
  id: string;
  name: string;
  addressLine: string;
  contactName: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  zoneId: string | null;
}

export type PickupStatus = 'REQUESTED' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface Pickup {
  id: string;
  code: string;
  status: PickupStatus;
  scheduledDate: string;
  timeWindow: string | null;
  expectedCount: number | null;
  pickedCount: number;
  notes: string | null;
  failureNote: string | null;
  startedAt: string | null;
  completedAt: string | null;
  brand: { id: string; code: string; name: string; phone: string | null };
  location: PickupLocation | null;
  zone: (ZoneRef & { id: string; hubId: string }) | null;
  ordersCount: number;
  scannedCount: number;
}

export interface PickupOrder {
  id: string;
  trackingNumber: string;
  brandReference: string | null;
  status: OrderStatus;
  recipientName: string;
  codAmountCents: number;
  collectCents: number;
  itemsCount: number;
  pickedUpAt: string | null;
  scanned: boolean;
}

export interface PickupDetail extends Pickup {
  orders: PickupOrder[];
  rejected?: Array<{ trackingNumber: string; code: string; message: string }>;
}

export interface ScanResult {
  trackingNumber: string;
  orderId: string;
  status: OrderStatus;
  alreadyScanned: boolean;
  scannedCount: number;
}

export interface CarriedParcel {
  orderId: string;
  trackingNumber: string;
  status: OrderStatus;
  statusLabel: Bilingual;
  type: 'DELIVERY' | 'RETURN' | 'EXCHANGE' | string;
  recipientName: string;
  address: string;
  brand: { code: string; name: string };
  destination: 'HUB' | 'BRAND';
  brandLocation: { name: string | null; address: string | null; phone: string | null } | null;
  canStartReturn: boolean;
  canMarkReturned: boolean;
}

export interface Today {
  date: string;
  courier: { id: string; code: string; cashOnHandCents: number; cashLimitCents: number; availability: Availability };
  summary: {
    stops: number;
    remaining: number;
    delivered: number;
    failed: number;
    codToCollectCents: number;
    collectedTodayCents: number;
    deliveredToday: number;
    pickups: number;
    returnsToHub: number;
    returnsToBrand: number;
  };
  pickups: Pickup[];
  runsheets: TodayRunsheet[];
  returns: CarriedParcel[];
}

export interface RunsheetDetail {
  id: string;
  code: string;
  status: TodayRunsheet['status'];
  route: Array<{ orderId: string; seq: number; lat: number; lng: number; etaMinutes: number; legKm: number }> | null;
  hub: { id: string; code: string; name: string; lat: number | null; lng: number | null } | null;
  progress: { total: number; delivered: number; failed: number; pending: number; done: number; percent: number };
  stops: Array<{
    id: string;
    trackingNumber: string;
    status: OrderStatus;
    routeSequence: number | null;
    recipientName: string;
    addressLine: string;
    lat: number | null;
    lng: number | null;
    collectCents: number;
    isOpen: boolean;
    zone: ZoneRef & { centerLat: number | null; centerLng: number | null };
  }>;
}

// ---------------------------------------------------------------- stop

export interface StopDetail {
  id: string;
  trackingNumber: string;
  status: OrderStatus;
  statusLabel: Bilingual;
  type: string;
  recipient: { name: string; phone: string; phoneDisplay: string; altPhone: string | null };
  address: { line: string; building: string | null; floor: string | null; apartment: string | null; landmark: string | null; lat: number | null; lng: number | null };
  zone: ZoneRef;
  brand: { name: string; code: string; phone: string | null };
  notes: string | null;
  paymentMethod: 'COD' | 'PREPAID';
  collectCents: number;
  itemsCount: number;
  packageDescription: string | null;
  isFragile: boolean;
  allowOpening: boolean;
  otpRequired: boolean;
  attempts: number;
  maxAttempts: number;
  scheduledDate: string | null;
  promisedBy: string | null;
  eta: string | null;
  mapsUrl: string | null;
  approximateMapsUrl: string | null;
  actions: {
    outForDelivery: boolean;
    deliver: boolean;
    fail: boolean;
    resendOtp: boolean;
    returnToHub: boolean;
    startReturn: boolean;
    returned: boolean;
  };
}

export interface DeliverBody {
  collectedCents: number;
  otp?: string;
  podPhotoUrl?: string;
  signatureUrl?: string;
  receivedBy?: string;
  note?: string;
  lat?: number;
  lng?: number;
}

export interface FailBody {
  reason: FailureReason;
  note?: string;
  photoUrl?: string;
  rescheduleDate?: string;
  lat?: number;
  lng?: number;
}

// ---------------------------------------------------------------- me

export interface LevelInfo {
  level: number;
  en: string;
  ar: string;
  emoji: string;
  minXp?: number;
  progress: number;
  next: { level: number; minXp: number; en: string; ar: string; emoji: string } | null;
  xpToNext?: number;
}

export interface Shift {
  id: string;
  startAt: string;
  endAt: string;
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
  clockInAt: string | null;
  clockOutAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  hourlyRateCents: number;
  notes: string | null;
  day: string;
  scheduledMinutes: number;
  expectedEarningsCents: number;
  earnedCents: number;
  geofenceWarning: boolean;
  autoClockOut: boolean;
  template: { id: string; name: string } | null;
  hub: { id: string; code: string; name: string } | null;
  warnings?: string[];
}

export interface Dashboard {
  hero: { id: string; code: string; name: string; avatarUrl: string | null; employmentType: 'FREELANCE' | 'SHIFT' | 'FULL_TIME'; status: string; availability: Availability; rating: number };
  today: { deliveries: number; failedAttempts: number; successRate: number; earningsCents: number; codCollectedCents: number; activeOrders: number };
  cash: { onHandCents: number; limitCents: number; usedPct: number; warning: CashWarning; pendingDeclaredCents: number; unhandedOrders: number; oldestUnhandedHours: number | null };
  payableCents: number;
  gamification: { xp: number; level: LevelInfo | null; streakDays: number; badgesEarned: number; badges: Array<{ key: string; en: string; ar: string }> };
  shifts: { current: Shift | null; next: Shift | null };
}

export interface Profile {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  locale: 'ar' | 'en';
  avatarUrl: string | null;
  employmentType: 'FREELANCE' | 'SHIFT' | 'FULL_TIME';
  status: string;
  availability: Availability;
  vehicleType: string;
  vehiclePlate: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  homeHub: { id: string; code: string; name: string; lat: number | null; lng: number | null } | null;
  zones: Array<ZoneRef & { zoneId: string; isPrimary: boolean }>;
  rates: { perDeliveryRateCents: number; perPickupRateCents: number; failedAttemptRateCents: number; hourlyRateCents: number; monthlySalaryCents: number };
  cash: { onHandCents: number; limitCents: number; availableCents: number; usedPct: number; warning: CashWarning };
  payableCents: number;
  maxActiveOrders: number;
  activeOrders: number;
  rating: number;
  ratingCount: number;
  xp: number;
  level: LevelInfo;
  streakDays: number;
  walletPhone: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastSeenAt: string | null;
  documents: { total: number; pending: number; approved: number; rejected: number; expiringSoon: number; missingRequired: string[] };
  kpis: Record<'today' | 'last7d' | 'last30d', { deliveries: number; failedAttempts: number; successRate: number; avgDeliveryMinutes: number; codCollectedCents: number; earningsCents: number }>;
  joinedAt: string;
}

export interface HeroDocument {
  id: string;
  type: string;
  url: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  expiresAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- cash

export interface Wallet {
  cashOnHandCents: number;
  cashLimitCents: number;
  usedPct: number;
  warning: CashWarning;
  pendingDeclaredCents: number;
  availableToDeclareCents: number;
  outstandingShortageCents: number;
  unhandedOrders: number;
  unhandedCents: number;
  oldestUnhandedHours: number | null;
  orders: Array<{ id: string; trackingNumber: string; brandName: string | null; recipientName: string; collectedCents: number; deliveredAt: string | null; ageHours: number | null }>;
}

export interface Handover {
  id: string;
  code: string;
  method: HandoverMethod;
  declaredCents: number;
  receivedCents: number;
  varianceCents: number;
  reference: string | null;
  proofUrl: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  notes: string | null;
  confirmedAt: string | null;
  createdAt: string;
  hub: { id: string; code: string; name: string } | null;
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

// ---------------------------------------------------------------- earnings

export type EarningCategory =
  | 'delivery' | 'attempt' | 'pickup' | 'shift' | 'salary' | 'other_earning' | 'bonus' | 'reimbursement'
  | 'penalty' | 'cash_shortage' | 'advance' | 'payout' | 'other';

export interface LedgerLine {
  id: string;
  createdAt: string;
  debitCents: number;
  creditCents: number;
  kind: string;
  reference: string | null;
  description: string | null;
  orderId: string | null;
  trackingNumber: string | null;
  category: EarningCategory;
  amountCents: number;
}

export interface Earnings extends Paged<LedgerLine> {
  from: string;
  to: string;
  payableCents: number;
  totals: {
    byCategory: Record<EarningCategory, { count: number; creditsCents: number; debitsCents: number; netCents: number }>;
    earnedCents: number;
    paidOutCents: number;
  };
}

export interface Payout {
  id: string;
  code: string;
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
}

export interface ShiftList {
  from: string;
  to: string;
  total: number;
  summary: { byStatus: Record<string, number>; scheduledMinutes: number; workedMinutes: number; earnedCents: number };
  data: Shift[];
}

// ---------------------------------------------------------------- gamification

export interface Achievements {
  xp: number;
  level: LevelInfo;
  streakDays: number;
  rating: number;
  ratingCount: number;
  stats: { totalDelivered: number; fiveStarRatings: number; earlyClockIns: number };
  badges: Array<{ key: string; en: string; ar: string; current: number; target: number; earned: boolean }>;
  badgesEarned: number;
  xpBreakdown: Record<string, { count: number; xp: number }>;
  rules: Record<string, number>;
}

export interface LeaderRow {
  rank: number;
  courierId: string;
  code: string;
  name: string;
  avatarUrl: string | null;
  rating: number;
  xp: number;
  streakDays: number;
  deliveries: number;
  onTime: number;
  failedAttempts: number;
  successRate: number;
  periodXp: number;
  level: number;
  levelName: Bilingual;
}

export interface Leaderboard {
  period: 'day' | 'week' | 'month';
  since: string;
  data: LeaderRow[];
  me: LeaderRow | null;
}
