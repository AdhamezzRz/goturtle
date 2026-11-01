import type { OrderStatus } from '@goturtle/shared';

// ------------------------------------------------------------------ order links

export interface LinkItem {
  name: string;
  quantity: number;
  priceCents: number;
}

export type LinkService = 'STANDARD' | 'SAME_DAY' | 'EXPRESS';

export interface OrderLink {
  id: string;
  code: string;
  url: string;
  brandId: string;
  brandName?: string;
  title: string;
  description: string | null;
  items: LinkItem[];
  itemsTotalCents: number;
  paymentMethod: 'COD' | 'PREPAID';
  codAmountCents: number;
  serviceLevel: LinkService;
  weightGrams: number;
  allowOpening: boolean;
  notes: string | null;
  maxUses: number | null;
  usesCount: number;
  expiresAt: string | null;
  isActive: boolean;
  availability: 'OPEN' | 'INACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'BRAND_INACTIVE';
  stats: { orders: number; delivered: number; returned: number; active: number; deliveredCodCents: number; deliveryRate: number | null };
  createdAt: string;
}

export interface LinkOrder {
  id: string;
  trackingNumber: string;
  brandReference: string | null;
  status: OrderStatus;
  recipientName: string;
  recipientPhone: string;
  codAmountCents: number;
  createdAt: string;
}

export interface PublicLink {
  code: string;
  title: string;
  description: string | null;
  brand: { name: string; logoUrl: string | null };
  items: LinkItem[];
  itemsTotalCents: number;
  paymentMethod: 'COD' | 'PREPAID';
  codAmountCents: number;
  serviceLevel: LinkService;
  allowOpening: boolean;
  feesPaidBy: 'BRAND' | 'RECIPIENT';
  expiresAt: string | null;
}

export interface ZoneOption {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  city: { code: string; nameEn: string; nameAr: string };
}

export interface DetectResult {
  match: { zoneId: string; method: string; confidence: number } | null;
  zone: { id: string; code: string; nameEn: string; nameAr: string; city: { nameEn: string; nameAr: string } } | null;
  hint: string | null;
}

export interface LinkQuote {
  feesPaidBy: 'BRAND' | 'RECIPIENT';
  shippingCents: number;
  totalToPayCents: number;
  slaHours: number;
}

export interface PlacedOrder {
  trackingNumber: string;
  trackingUrl: string;
  reference: string;
  amountToPayCents: number;
  paymentMethod: 'COD' | 'PREPAID';
}

// ------------------------------------------------------------------ partners

export interface Partner {
  id: string;
  code: string;
  name: string;
  apiType: string;
  trackingUrlTemplate: string | null;
  governorateCodes: string[];
  isActive: boolean;
  feeCents: number | null;
  returnFeeCents: number | null;
  effectiveFeeCents: number;
  credentialsSet: Record<string, boolean>;
  courier: { id: string; code: string } | null;
  stats: { active: number; delivered: number; total: number };
  custodyCents: number;
  feesPayableCents: number;
  createdAt: string;
}

export interface QueueRow {
  id: string;
  trackingNumber: string;
  status: OrderStatus;
  brandName: string;
  recipientName: string;
  collectCents: number;
  weightGrams: number;
  createdAt: string;
  promisedBy: string | null;
  zone: { id: string; code: string; nameEn: string; nameAr: string };
  city: { nameEn: string; nameAr: string };
  governorate: { code: string; nameEn: string; nameAr: string };
  servedByHeroes: boolean;
  suggestedPartners: Array<{ id: string; code: string; name: string }>;
}

export interface Shipment {
  id: string;
  trackingNumber: string;
  partnerTrackingNumber: string | null;
  partnerTrackingUrl: string | null;
  status: OrderStatus;
  withPartner: boolean;
  recipientName: string;
  brandName: string;
  collectCents: number;
  collectedCents: number;
  attempts: number;
  remitted: boolean;
  handedToPartnerAt: string | null;
  deliveredAt: string | null;
  zone: { nameEn: string; nameAr: string };
  governorate: { code: string; nameEn: string; nameAr: string };
}

export interface Custody {
  partner: { id: string; code: string; name: string };
  courierId: string;
  courierCode: string;
  custodyCents: number;
  feesPayableCents: number;
  netOwedToUsCents: number;
  pendingHandovers: { count: number; declaredCents: number };
  unremittedOrders: { count: number; collectedCents: number };
  recentHandovers: Array<{ id: string; code: string; method: string; status: string; declaredCents: number; receivedCents: number; reference: string | null; createdAt: string; confirmedAt: string | null }>;
}

// ------------------------------------------------------------------ forecast

export interface ForecastEvent {
  name: string;
  from: string;
  to: string;
  multiplier: number;
}

export interface ForecastDay {
  date: string;
  weekday: number;
  actual: number | null;
  partial: boolean;
  forecast: number;
  lower: number;
  upper: number;
  multiplier: number;
  events: string[];
}

export interface StaffingRow {
  date: string;
  hubId: string | null;
  hubCode: string | null;
  hubName: string | null;
  templateId: string | null;
  templateName: string | null;
  startTime: string | null;
  endTime: string | null;
  forecastOrders: number;
  recommended: number;
  scheduled: number;
  gap: number;
}

export interface DemandForecast {
  from: string;
  to: string;
  asOf: string;
  by: 'hub' | 'zone';
  history: { from: string; to: string; weeks: number; weeksUsed: number; firstDay: string | null };
  model: { weeklyLevel: number; slopePerWeek: number; sigma: number; weekdayLevels: number[] };
  events: ForecastEvent[];
  days: ForecastDay[];
  totals: { forecast: number; actual: number };
  groups: Array<{ id: string | null; code: string | null; name: string | null; nameAr: string | null; historyTotal: number; days: Array<{ date: string; actual: number | null; forecast: number; lower: number; upper: number }> }>;
  staffing: { ordersPerHeroPerShift: number; rows: StaffingRow[]; summary: { recommended: number; scheduled: number; gap: number; understaffedDays: number } } | null;
}

export interface ForecastAccuracy {
  weeks: number;
  from: string;
  to: string;
  mape: number | null;
  wape: number | null;
  accuracy: number | null;
  intervalCoverage: number | null;
  perWeek: Array<{ weekStart: string; mape: number | null; wape: number | null }>;
  days: Array<{ date: string; actual: number; forecast: number; lower: number; upper: number }>;
}

export interface PlatformSettings {
  ordersPerHeroPerShift: number;
  forecastEvents: ForecastEvent[];
  partnerFeeCents: number;
  routingProvider: 'haversine' | 'osrm' | 'google';
}
