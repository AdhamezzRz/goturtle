import type { AttemptDisputeStatus, CallStatus, ConfirmationStatus, FailureReason, OrderStatus } from '@goturtle/shared';
import type { BadgeTone } from '@/components/ui';

/** API shapes of the delivery-integrity endpoints (apps/api/src/modules/delivery-integrity). */

export interface IntegritySettings {
  confirmationEnabled: boolean;
  confirmAboveRisk: number;
  confirmCodAboveCents: number;
  holdUnconfirmedAboveRisk: number;
  noResponseAfterHours: number;
  prepayAboveRisk: number;
  failedAttemptGeofenceMeters: number;
  unreachableMinCalls: number;
  unreachableMinSpacingMinutes: number;
  attemptDisputeWindowHours: number;
  requestPinWhenMissing: boolean;
  confirmationChannel: 'WHATSAPP' | 'SMS';
}

export interface Overview {
  settings: IntegritySettings;
  confirmations: {
    pending: number; noResponse: number; blockedForDispatch: number; confirmationRate: number | null;
    last30: { requested: number; confirmed: number; rescheduled: number; declined: number; noResponse: number; pending: number };
  };
  holds: { total: number; byReason: Array<{ reason: string; count: number }> };
  disputes: { open: number; upheld30: number; rejected30: number; confirmedByCustomer30: number };
  rto: { last30: { delivered: number; returned: number; rate: number | null }; previous30: { delivered: number; returned: number; rate: number | null }; change: number | null };
  customers: { blocklisted: number; prepayOnly: number };
}

export interface IntegrityOrderRow {
  id: string;
  trackingNumber: string;
  status: OrderStatus;
  holdReason: string | null;
  confirmationStatus: ConfirmationStatus;
  confirmationRequestedAt: string | null;
  confirmationRespondedAt: string | null;
  confirmationChannel: string | null;
  riskScore: number;
  paymentMethod: 'COD' | 'PREPAID';
  codAmountCents: number;
  collectCents: number;
  recipientName: string;
  recipientPhone: string;
  scheduledDate: string | null;
  createdAt: string;
  updatedAt: string;
  brand: { id: string; name: string; code: string };
  zone: { id: string; code: string; nameEn: string; nameAr: string };
  customer: { id: string; isBlocked: boolean; requirePrepayment: boolean; reliabilityScore: number };
  heldAt: string | null;
  holdFrom: OrderStatus | null;
  override: { reason: string; byName: string; at: string } | null;
  blocksDispatch?: boolean;
}

export interface CallView { id: string; status: CallStatus; provider: string; durationSeconds: number; startedAt: string; endedAt?: string | null }

export interface DisputeRow {
  attemptId: string;
  attemptNo: number;
  failureReason: FailureReason | null;
  note: string | null;
  photoUrl: string | null;
  at: string;
  heroPosition: { lat: number; lng: number } | null;
  distanceMeters: number | null;
  withinGeofence: boolean | null;
  callCount: number;
  disputeStatus: AttemptDisputeStatus;
  disputedAt: string | null;
  customerNote: string | null;
  order: { id: string; trackingNumber: string; status: OrderStatus; addressLine: string; recipientName: string; recipientPhone: string; brandName: string; destination: { lat: number; lng: number } | null };
  hero: { id: string; code: string; name: string };
  calls: CallView[];
  ticket: { id: string; code: string; status: string } | null;
}

export interface HeroIntegrityRow {
  courier: { id: string; code: string; name: string; status: string; rating: number };
  deliveries: number;
  failedAttempts: number;
  failureRate: number | null;
  avgDistanceAtFailureMeters: number | null;
  farFailures: number;
  callsPerFailure: number | null;
  failuresWithoutCalls: number;
  disputes: number;
  openDisputes: number;
  upheld: number;
  upheldRate: number | null;
  confirmedByCustomer: number;
  integrityScore: number;
}

export interface NetworkCustomer {
  id: string; name: string; phone: string; altPhone: string | null; isBlocked: boolean; blockedReason: string | null; blockedAt: string | null; requirePrepayment: boolean;
  reliabilityScore: number; totalOrders: number; deliveredOrders: number; refusedOrders: number;
}
export interface NetworkRiskRow { customer: NetworkCustomer; refusalBrands: number | null; refusals: number | null; declines: number | null }

export interface OrderIntegrity {
  orderId: string;
  trackingNumber: string;
  status: OrderStatus;
  riskScore: number;
  confirmation: { status: ConfirmationStatus; requestedAt: string | null; respondedAt: string | null; channel: string | null };
  hold: { reason: string | null; since: string | null; from: OrderStatus | null } | null;
  dispatchBlocked: { code: string; message: string; holdReason: string | null; confirmationStatus: string; riskScore: number; threshold: number } | null;
  override: { at: string; reason: string; byName: string } | null;
  paymentMethod: 'COD' | 'PREPAID';
  hasPin: boolean;
  history: Array<{ reason: string | null; note: string | null; status: OrderStatus; actorType: string; actorName?: string | null; createdAt: string }>;
  // staff only
  geofenceMeters?: number;
  destination?: { lat: number; lng: number } | null;
  address?: { id: string; isVerified: boolean; source: string; deliveredCount: number; usageCount: number } | null;
  attempts: Array<{
    id?: string; attemptNo: number; success?: boolean; failureReason: FailureReason | null; note?: string | null; at: string;
    hero?: { id: string; code: string | null; name: string | null };
    position?: { lat: number; lng: number } | null;
    distanceMeters?: number | null; withinGeofence?: boolean | null; callCount?: number;
    disputeStatus: AttemptDisputeStatus; disputedAt?: string | null; disputeNote?: string | null;
  }>;
  calls?: Array<CallView & { hero: { id: string; name: string; code: string } }>;
}

export interface CustomerAddress {
  id: string; label: string | null; addressLine: string; building: string | null; floor: string | null; apartment: string | null; landmark: string | null;
  lat: number | null; lng: number | null; isVerified: boolean; source: string; usageCount: number; deliveredCount: number; lastUsedAt: string | null;
  zone: { id: string; code: string; nameEn: string; nameAr: string } | null; ordersCount: number; brandsCount: number; hasPin: boolean;
}

export interface RecipientRisk { level: 'LOW' | 'MEDIUM' | 'HIGH'; score: number; flags: string[]; requiresPrepayment: boolean; verifiedPinAvailable: boolean }
export interface AddressSuggestion {
  id: string; addressLine: string; building: string | null; floor: string | null; apartment: string | null; landmark: string | null;
  zone: { id: string; code: string; nameEn: string; nameAr: string } | null; verifiedPin: boolean; ordersCount: number; lastUsedAt: string | null;
}

export interface HeroIntegrity {
  orderId: string;
  geofenceMeters: number;
  destination: { lat: number; lng: number } | null;
  unreachableReasons: string[];
  callProvider: string;
  calls: { made: number; logged: number; requiredForUnreachable: number; requiredForOther: number; spacingMinutes: number; nextCountedAt: string | null; list: CallView[] };
}

export interface TrackIntegrity {
  trackingNumber: string;
  status: OrderStatus;
  verified: boolean;
  confirmation: { status: ConfirmationStatus; requestedAt: string | null; respondedAt: string | null; scheduledDate: string | null; canRespond: boolean; authorized: boolean; link: string | null; rescheduleRange: { min: string; max: string }; held: string | null };
  attempt: { id: string; attemptNo: number; at: string; failureReason: FailureReason | null; heroFirstName: string | null; disputeStatus: AttemptDisputeStatus; windowEndsAt: string; canRespond: boolean; authorized: boolean; link: string | null } | null;
  pin: { hasPin: boolean; canDrop: boolean; authorized: boolean; link: string | null; center: { lat: number; lng: number } | null };
}

export const CONFIRMATION_TONE: Record<ConfirmationStatus, BadgeTone> = {
  NOT_REQUIRED: 'neutral', PENDING: 'warning', CONFIRMED: 'success', RESCHEDULED: 'info', DECLINED: 'danger', NO_RESPONSE: 'danger',
};
export const DISPUTE_TONE: Record<AttemptDisputeStatus, BadgeTone> = {
  NONE: 'neutral', CONFIRMED_BY_CUSTOMER: 'success', DISPUTED: 'warning', UPHELD: 'danger', REJECTED: 'info',
};
export const HOLD_REASONS = ['UNCONFIRMED', 'PREPAY_REQUIRED', 'HIGH_RISK', 'CUSTOMER_BLOCKED'] as const;
export const holdKey = (r: string | null | undefined) => (r && ['UNCONFIRMED', 'PREPAY_REQUIRED', 'HIGH_RISK', 'CUSTOMER_BLOCKED', 'MANUAL'].includes(r) ? `integrity.hold.${r}` : 'integrity.hold.other');
