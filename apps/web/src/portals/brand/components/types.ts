/** API response shapes used by the brand portal (mirrors apps/api responses). */
import type {
  FailureReason, FeesPayer, OrderSource, OrderStatus, OrderType, PaymentMethod, PickupStatus, ServiceLevel, StatusTone,
  TicketCategory, TicketPriority, TicketStatus, UserRole,
} from '@goturtle/shared';

export type Bilingual = { en: string; ar: string };

export interface ZoneRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface OrderRow {
  id: string;
  trackingNumber: string;
  brandReference: string | null;
  type: OrderType;
  serviceLevel: ServiceLevel;
  status: OrderStatus;
  source: OrderSource;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  landmark: string | null;
  lat: number | null;
  lng: number | null;
  itemsCount: number;
  weightGrams: number;
  paymentMethod: PaymentMethod;
  codAmountCents: number;
  collectCents: number;
  collectedCents: number;
  feesPaidBy: FeesPayer;
  totalFeesCents: number;
  attempts: number;
  maxAttempts: number;
  scheduledDate: string | null;
  promisedBy: string | null;
  pickedUpAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  deliveryOtpRequired: boolean;
  createdAt: string;
  updatedAt: string;
  zone: ZoneRef | null;
  statusTone: StatusTone;
  slaBreached: boolean;
  courier: { id: string; code: string; name: string } | null;
}

export interface OrderCounts {
  total: number;
  byStatus: Record<OrderStatus, number>;
  groups: Record<'new' | 'inTransit' | 'delivered' | 'returns' | 'closed', number>;
  slaBreached: number;
}

export interface TimelineEvent {
  id: string;
  status: OrderStatus;
  fromStatus: OrderStatus | null;
  label: Bilingual;
  isStatusChange: boolean;
  reason: string | null;
  note: string | null;
  actorType: string;
  actorName: string | null;
  isPublic: boolean;
  createdAt: string;
}

export interface Attempt {
  id: string;
  attemptNo: number;
  success: boolean;
  failureReason: FailureReason | null;
  note: string | null;
  photoUrl: string | null;
  createdAt: string;
  courier: { id: string; code: string; name: string } | null;
}

export interface OrderDetail extends Omit<OrderRow, 'attempts' | 'zone' | 'courier'> {
  brandId: string;
  statusLabel: Bilingual;
  recipientAltPhone: string | null;
  building: string | null;
  floor: string | null;
  apartment: string | null;
  zoneId: string;
  pickupLocationId: string | null;
  packageDescription: string | null;
  isFragile: boolean;
  allowOpening: boolean;
  declaredValueCents: number;
  shippingFeeCents: number;
  codFeeCents: number;
  extraFeesCents: number;
  vatCents: number;
  attempts: Attempt[];
  notes: string | null;
  rating: number | null;
  ratingComment: string | null;
  podPhotoUrl: string | null;
  podReceivedBy: string | null;
  settlementId: string | null;
  canEdit: boolean;
  canCancel: boolean;
  zone: (ZoneRef & { tier: string; slaHours: number; centerLat: number; centerLng: number; city: ZoneRef | null; hub: { id: string; code: string; name: string } | null }) | null;
  hub: { id: string; code: string; name: string; nameAr: string | null; phone: string | null } | null;
  pickupLocation: { id: string; name: string; addressLine: string; contactName: string; phone: string } | null;
  pickup: { id: string; code: string; status: PickupStatus; scheduledDate: string } | null;
  courier: { id: string; code: string; name: string; vehicleType: string; rating: number; avatarUrl: string | null } | null;
  parentOrder: { id: string; trackingNumber: string } | null;
  childOrders: Array<{ id: string; trackingNumber: string; type: OrderType; status: OrderStatus }>;
  timeline: TimelineEvent[];
  fees: {
    shippingFeeCents: number;
    codFeeCents: number;
    extraFeesCents: number;
    vatCents: number;
    totalFeesCents: number;
    feesPaidBy: FeesPayer;
    breakdown: Array<{ key: string; cents: number }>;
    returnFee: number | null;
  };
}

export interface ServiceableZone extends ZoneRef {
  tier: string;
  slaHours: number;
  city: { code: string; nameEn: string; nameAr: string };
}

export interface ZoneSummary extends ZoneRef {
  tier: string;
  slaHours: number;
  centerLat: number;
  centerLng: number;
  city: ZoneRef;
  hub: { id: string; code: string; name: string } | null;
}

export interface DetectZoneResult {
  match: { zoneId: string; code: string; confidence: number; method: 'polygon' | 'keyword' | 'nearest'; matched?: string } | null;
  zone: ZoneSummary | null;
  hint?: string;
}

export interface QuoteResult {
  zone: ZoneSummary;
  detection: DetectZoneResult['match'];
  quote: {
    shippingFeeCents: number;
    weightFeeCents: number;
    codFeeCents: number;
    insuranceCents: number;
    exchangeFeeCents: number;
    extraFeesCents: number;
    subtotalCents: number;
    vatCents: number;
    totalFeesCents: number;
    collectFromRecipientCents: number;
    netToBrandCents: number;
    breakdown: Array<{ key: string; cents: number }>;
  };
}

export interface RateCard {
  plan: { id: string; name: string };
  codFeeBp: number;
  codFeeMinCents: number;
  includedWeightGrams: number;
  extraKgCents: number;
  vatBp: number;
  rules: Array<{ tier: string; serviceLevel: ServiceLevel; baseFeeCents: number }>;
}

export interface BrandLocation {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  addressLine: string;
  zoneId: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  isActive: boolean;
  zone?: ZoneRef | null;
}

export interface MyBrand {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  commercialRegNo: string | null;
  taxId: string | null;
  industry: string | null;
  logoUrl: string | null;
  website: string | null;
  email: string | null;
  phone: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  settlementCycle: string;
  payoutMethod: string | null;
  payoutDetails: Record<string, string> | null;
  allowOpenPackage: boolean;
  defaultFeesPaidBy: FeesPayer;
  plan: { id: string; name: string } | null;
  walletBalanceCents: number;
  locations: BrandLocation[];
  canCreateOrders: boolean;
}

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
  createdAt: string;
  location: { id: string; name: string; addressLine: string; contactName: string; phone: string; lat: number | null; lng: number | null } | null;
  zone: ZoneRef | null;
  courier: { id: string; code: string; name: string } | null;
  ordersCount: number;
  scannedCount: number;
}

export interface PickupDetail extends Pickup {
  orders: Array<{
    id: string; trackingNumber: string; brandReference: string | null; status: OrderStatus; recipientName: string;
    codAmountCents: number; collectCents: number; itemsCount: number; pickedUpAt: string | null; scanned: boolean;
  }>;
}

export interface FinanceSummary {
  walletBalanceCents: number;
  pendingCodCents: number;
  pendingOrders: number;
  inSettlementCents: number;
  feesThisMonthCents: number;
  settlementCycle: string;
  payoutMethod: string | null;
  nextSettlementDate: string | null;
  lastPaidSettlement: { id: string; code: string; netPayableCents: number; paidAt: string } | null;
}

export interface StatementLine {
  id: string;
  createdAt: string;
  debitCents: number;
  creditCents: number;
  kind: string;
  description: string | null;
  orderId: string | null;
  trackingNumber: string | null;
  amountCents: number;
  balanceCents: number;
}

export interface Statement {
  from: string;
  to: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  totals: { debitsCents: number; creditsCents: number };
  data: StatementLine[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Settlement {
  id: string;
  code: string;
  periodStart: string;
  periodEnd: string;
  ordersCount: number;
  codCollectedCents: number;
  feesCents: number;
  vatCents: number;
  adjustmentsCents: number;
  netPayableCents: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
  method: string | null;
  paymentReference: string | null;
  invoiceNumber: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface SettlementDetail extends Settlement {
  brand: { id: string; code: string; name: string; settlementCycle: string; payoutMethod: string | null; payoutDetails: Record<string, string> | null; legalName: string | null; taxId: string | null };
  lines: Array<{
    id: string; trackingNumber: string; brandReference: string | null; status: OrderStatus; recipientName: string; codAmountCents: number;
    collectedCents: number; deliveredAt: string | null; returnedAt: string | null; codCents: number; feesCents: number; netCents: number;
  }>;
}

export interface BrandOverview {
  range: { from: string; to: string };
  kpis: {
    ordersCreated: number; codBookedCents: number; delivered: number; returned: number; cancelled: number; successRate: number;
    firstAttemptSuccessRate: number; onTimeRate: number; avgHoursToDeliver: number | null; codCollectedCents: number;
    feesExVatCents: number; failedAttempts: number; feesCents: number; netCodCents: number; openTickets: number;
  };
  daily: Array<{ date: string; created: number; delivered: number; failedAttempts: number; returned: number; codCollectedCents: number }>;
  heatmap: { values: number[][] };
  byZone: Array<ZoneRef & { zoneId: string; created: number; delivered: number; returned: number; cancelled: number; inProgress: number; successRate: number; codCollectedCents: number }>;
  failureReasons: Array<{ reason: string; count: number; share: number }>;
}

export interface Ticket {
  id: string;
  code: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  openedByType: string;
  contactName: string | null;
  slaDueAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  breached: boolean;
  order: { id: string; trackingNumber: string; status?: OrderStatus; brandReference?: string | null } | null;
  assignee: { id: string; name: string } | null;
}

export interface TicketDetail extends Ticket {
  messages: Array<{ id: string; authorType: string; authorName: string; body: string; attachments: string[]; createdAt: string }>;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  role: UserRole;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  locale: 'ar' | 'en';
  avatarUrl: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  invitePending: boolean;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  active: boolean;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  description: string | null;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
  secretHint: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'DEAD';
  attempts: number;
  nextAttemptAt: string | null;
  lastResponseCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
  payload?: unknown;
  lastResponseBody?: string | null;
}

export interface Integration {
  id: string;
  provider: 'SHOPIFY' | 'WOOCOMMERCE';
  shopDomain: string;
  status: 'ACTIVE' | 'PAUSED' | 'ERROR';
  settings: { autoCreate: boolean; defaultServiceLevel: ServiceLevel; codGateways: string[]; defaultWeightGrams: number; pickupLocationId: string | null };
  credentialsSet: Record<string, boolean>;
  webhookUrl: string;
  inboundSecret?: string;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  template: string;
  title: string | null;
  body: string;
  data: Record<string, unknown> | null;
  orderId: string | null;
  readAt: string | null;
  createdAt: string;
}
