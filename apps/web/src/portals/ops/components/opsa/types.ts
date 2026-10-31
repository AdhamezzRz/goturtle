import type {
  CourierAvailability, FailureReason, OrderStatus, OrderType, PaymentMethod, PickupStatus, PricingTier, RunsheetStatus,
  ServiceLevel, StatusTone, TicketCategory, TicketPriority, TicketStatus, VehicleType,
} from '@goturtle/shared';

/** Response shapes of the Ops operations endpoints (verified against the live API). */

export interface Bilingual { en: string; ar: string }
export interface ZoneRef { id: string; code: string; nameEn: string; nameAr: string }
export interface HubRef { id: string; code: string; name?: string }
export interface CourierRef { id: string; code: string; name: string; phone?: string }
export interface BrandRef { id: string; code: string; name: string; phone?: string }

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface OrderRow {
  id: string;
  trackingNumber: string;
  brandReference: string | null;
  type: OrderType;
  serviceLevel: ServiceLevel;
  status: OrderStatus;
  source: string;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  landmark: string | null;
  lat: number | null;
  lng: number | null;
  hubId: string | null;
  pickupId: string | null;
  runsheetId: string | null;
  routeSequence: number | null;
  courierId: string | null;
  itemsCount: number;
  weightGrams: number;
  paymentMethod: PaymentMethod;
  codAmountCents: number;
  collectCents: number;
  collectedCents: number;
  totalFeesCents: number;
  attempts: number;
  maxAttempts: number;
  riskScore: number;
  riskLevel: RiskLevel;
  priority: number;
  scheduledDate: string | null;
  promisedBy: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  slaBreached: boolean;
  statusTone: StatusTone;
  brand: BrandRef | null;
  zone: ZoneRef | null;
  courier: CourierRef | null;
  hub: HubRef | null;
}

export interface OrderCounts {
  total: number;
  byStatus: Record<OrderStatus, number>;
  groups: { new: number; inTransit: number; delivered: number; returns: number; closed: number };
  slaBreached: number;
}

export interface TimelineEvent {
  id: string;
  status: OrderStatus | null;
  fromStatus: OrderStatus | null;
  label: Bilingual | null;
  isStatusChange: boolean;
  reason: string | null;
  note: string | null;
  actorType: string;
  actorName: string | null;
  hubId: string | null;
  lat: number | null;
  lng: number | null;
  isPublic: boolean;
  createdAt: string;
}

export interface Attempt {
  id: string;
  attemptNo: number;
  success: boolean;
  failureReason: FailureReason | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  createdAt: string;
  courier: CourierRef | null;
}

export interface LedgerTx {
  id: string;
  kind: string;
  reference: string;
  description: string | null;
  createdAt: string;
  entries: Array<{ debitCents: number; creditCents: number; code: string; name: string; type: string }>;
}

export interface OrderDetail extends Omit<OrderRow, 'zone' | 'hub' | 'courier' | 'brand' | 'attempts'> {
  brandId: string;
  customerId: string | null;
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
  feesPaidBy: 'BRAND' | 'RECIPIENT';
  shippingFeeCents: number;
  codFeeCents: number;
  extraFeesCents: number;
  vatCents: number;
  pickedUpAt: string | null;
  outForDeliveryAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  deliveryOtpRequired: boolean;
  podPhotoUrl: string | null;
  podSignatureUrl: string | null;
  podReceivedBy: string | null;
  rating: number | null;
  ratingComment: string | null;
  notes: string | null;
  internalNotes: string | null;
  tags: string[] | null;
  parentOrderId: string | null;
  attempts: Attempt[];
  allowedTransitions: OrderStatus[];
  canEdit: boolean;
  canCancel: boolean;
  brand: BrandRef & { logoUrl: string | null };
  zone: ZoneRef & { tier: PricingTier; slaHours: number; centerLat: number; centerLng: number; city: ZoneRef; hub: HubRef | null };
  hub: (HubRef & { nameAr: string | null; phone: string | null }) | null;
  pickupLocation: { id: string; name: string; addressLine: string; contactName: string | null; phone: string | null; lat: number | null; lng: number | null } | null;
  pickup: { id: string; code: string; status: PickupStatus } | null;
  runsheet: { id: string; code: string; status: RunsheetStatus } | null;
  courier: (CourierRef & { vehicleType: VehicleType; rating: number; avatarUrl: string | null }) | null;
  parentOrder: { id: string; trackingNumber: string; status: OrderStatus } | null;
  childOrders: Array<{ id: string; trackingNumber: string; status: OrderStatus; type: OrderType }>;
  timeline: TimelineEvent[];
  fees: {
    shippingFeeCents: number; codFeeCents: number; extraFeesCents: number; vatCents: number; totalFeesCents: number; feesPaidBy: string;
    breakdown: Array<{ key: string; cents: number }>;
    returnFee: { feeCents: number; vatCents: number; totalCents: number; codFeeWaived: boolean } | null;
  };
  risk: { level: RiskLevel; factors: Array<{ key: string; points: number }> } | null;
  customer: { id: string; name: string; phone: string; totalOrders: number; deliveredOrders: number; refusedOrders: number; reliabilityScore: number; isBlocked: boolean } | null;
  ledger?: LedgerTx[];
}

export interface HubRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  isActive: boolean;
  zonesCount: number;
}

export interface ZoneRow extends ZoneRef {
  tier: PricingTier;
  slaHours: number;
  isActive: boolean;
  centerLat: number;
  centerLng: number;
  city: ZoneRef;
  hub: HubRef | null;
  keywords: string[];
  polygon: unknown;
}

export interface CityRow extends ZoneRef { governorateId: string; governorate: ZoneRef; zonesCount: number }
export interface GovernorateRow extends ZoneRef { citiesCount: number }

export interface BrandRow { id: string; code: string; name: string; status: string; phone: string | null; defaultFeesPaidBy: 'BRAND' | 'RECIPIENT'; allowOpenPackage: boolean; plan: { id: string; name: string } | null }

export interface CourierRow {
  id: string;
  code: string;
  name: string;
  phone: string;
  avatarUrl: string | null;
  employmentType: string;
  status: string;
  availability: CourierAvailability;
  vehicleType: VehicleType;
  homeHubId: string | null;
  rating: number;
  cashOnHandCents: number;
  cashLimitCents: number;
  lastSeenAt: string | null;
  lastLat: number | null;
  lastLng: number | null;
  hub: HubRef | null;
  level: number;
  cashUsedPct: number;
  cashWarning: string;
  activeOrders: number;
  zones: Array<ZoneRef & { zoneId: string; isPrimary: boolean }>;
}

export interface RunsheetProgress { total: number; delivered: number; failed: number; returns: number; pending: number; other: number; done: number; percent: number }

export interface RunsheetRow {
  id: string;
  code: string;
  courierId: string;
  hubId: string;
  date: string;
  status: RunsheetStatus;
  totalDistanceKm: number | null;
  totalMinutes: number | null;
  expectedCodCents: number;
  collectedCents: number;
  dispatchedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  stopsCount: number;
  courier: CourierRef;
  hub: HubRef;
  progress: RunsheetProgress;
}

export interface PickupRow {
  id: string;
  code: string;
  brandId: string;
  courierId: string | null;
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
  brand: BrandRef;
  location: { id: string; name: string; addressLine: string; contactName: string | null; phone: string | null; lat: number | null; lng: number | null; zoneId: string | null } | null;
  zone: (ZoneRef & { hubId: string | null }) | null;
  courier: CourierRef | null;
  ordersCount: number;
  scannedCount: number;
}

export interface TicketRow {
  id: string;
  code: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  orderId: string | null;
  brandId: string | null;
  customerId: string | null;
  openedByType: string;
  contactName: string | null;
  contactPhone: string | null;
  assigneeId: string | null;
  slaDueAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  breached: boolean;
  brand: { id: string; name: string; code?: string } | null;
  assignee: { id: string; name: string } | null;
  order: { id: string; trackingNumber: string; status?: OrderStatus; brandReference?: string | null } | null;
}

export interface TicketMessage {
  id: string;
  authorType: string;
  authorName: string | null;
  authorId: string | null;
  body: string;
  attachments: string[];
  isInternal: boolean;
  createdAt: string;
}

export interface CustomerRow {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  altPhone: string | null;
  totalOrders: number;
  deliveredOrders: number;
  refusedOrders: number;
  reliabilityScore: number;
  reliabilityLevel: 'GOOD' | 'FAIR' | 'POOR';
  isBlocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StaffUser { id: string; name: string; role: string; status: string; phone: string }
