import type { AdvanceStatus, AdvanceType, ClaimStatus, ClaimType, CollectionMethod, CollectionStatus, OrderStatus, WeightDisputeStatus } from '@goturtle/shared';
import type { Paginated } from '@/lib/api';

// ------------------------------------------------------------------ digital collections

export type CollectionRow = {
  id: string;
  trackingNumber: string;
  status: OrderStatus;
  brandId: string;
  brand: { id: string; code: string; name: string };
  courier: { id: string; code: string | null; name: string | null } | null;
  recipientName: string;
  collectedCents: number;
  collectionMethod: CollectionMethod | null;
  collectionStatus: CollectionStatus;
  collectionReference: string | null;
  deliveredAt: string | null;
  decision: { status?: string; note?: string; at?: string; by?: string; bankReference?: string | null } | null;
};
type Bucket = { n: number; cents: number };
export type CollectionList = Paginated<CollectionRow> & {
  summary: { pending: Bucket; confirmed: Bucket; rejected: Bucket; pendingByMethod?: Partial<Record<CollectionMethod, Bucket>> };
};
export type BulkConfirmResult = {
  confirmed: Array<{ orderId: string; trackingNumber: string; reference: string }>;
  alreadyProcessed: Array<{ trackingNumber: string; reference: string; status: CollectionStatus }>;
  notFound: string[];
};
export type HeroCollectionOptions = { methods: CollectionMethod[]; instapayAddress: string | null; walletNumber: string | null; paymentLinkEnabled: boolean };
export type DoorPaymentStatus = { orderId: string; enabled: boolean; payment: { status: 'PENDING' | 'PAID' | 'PAID_LATE' | 'FAILED'; amountCents: number; checkoutUrl: string; paidAt: string | null } | null };

// ------------------------------------------------------------------ advances

export type Advance = {
  id: string;
  code: string;
  brandId: string;
  type: AdvanceType;
  status: AdvanceStatus;
  amountCents: number;
  feeCents: number;
  totalCents: number;
  recoveredCents: number;
  outstandingCents: number;
  method: string | null;
  paymentReference: string | null;
  notes: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  recoveredAt: string | null;
  createdAt: string;
  brand: { id: string; code: string; name: string; payoutMethod: string; payoutDetails: Record<string, string> | null } | null;
};
type Preview = { amountCents: number; feeCents: number; totalCents: number } | null;
export type Eligibility = {
  brandId: string;
  minAmountCents: number;
  earlyPayout: {
    walletCents: number; openSettlementsCents: number; pendingRequestsCents: number; inTransitWalletCents: number;
    availableCents: number; maxAmountCents: number; feeBp: number; eligible: boolean; preview: Preview;
  };
  codAdvance: {
    inTransitOrders: number; inTransitCodCents: number; maxRateBp: number; capCents: number; outstandingCents: number;
    availableCents: number; maxAmountCents: number; feeBp: number; eligible: boolean; preview: Preview;
  };
};
export type AdvancesOverview = {
  queue: Array<{ status: AdvanceStatus; type: AdvanceType; n: number; cents: number }>;
  outstandingByBrand: Array<{ brand: { id: string; code: string; name: string }; advances: number; outstandingCents: number }>;
  outstandingTotalCents: number;
  feeRevenueCents: number;
  feeRevenueMonthCents: number;
};

// ------------------------------------------------------------------ claims

export type Claim = {
  id: string;
  code: string;
  orderId: string;
  brandId: string;
  type: ClaimType;
  status: ClaimStatus;
  claimedCents: number;
  approvedCents: number;
  liabilityCapCents: number;
  description: string;
  evidence: string[] | null;
  decisionNote: string | null;
  decidedAt: string | null;
  paidAt: string | null;
  courierId: string | null;
  createdAt: string;
  order: {
    id: string; trackingNumber: string; status: OrderStatus; recipientName: string; declaredValueCents: number; codAmountCents: number;
    deliveredAt: string | null; returnedAt: string | null; promisedBy: string | null; packageDescription: string | null;
  } | null;
  brand: { id: string; code: string; name: string } | null;
  courier: { id: string; code: string; name: string } | null;
};
export type ClaimDetail = Claim & {
  timeline: Array<{ action: string; status: ClaimStatus; at: string; actor: string; note: string | null; approvedCents: number | null; chargeHeroCents: number | null }>;
  defaultCapCents: number;
  capBasis: 'DECLARED_VALUE' | 'DEFAULT_CAP';
};
export type ClaimList = Paginated<Claim> & { counts: Partial<Record<ClaimStatus, { n: number; claimedCents: number; approvedCents: number }>> };

// ------------------------------------------------------------------ weight

export type WeightPanel = {
  orderId: string;
  trackingNumber: string;
  brandId: string;
  status: WeightDisputeStatus;
  declaredGrams: number;
  actualGrams: number | null;
  dimensionsCm: { l: number; w: number; h: number } | null;
  volumetricGrams: number | null;
  billableGrams: number | null;
  toleranceGrams: number;
  adjustmentCents: number;
  feeCents: number;
  vatCents: number;
  weighedAt: string | null;
  weighedBy: string | null;
  adjustedAt: string | null;
  disputeDeadline: string | null;
  canDispute: boolean;
  dispute: {
    note: string; evidence: string[]; at: string; ticketId: string | null; decision?: string; decisionNote?: string; decidedAt?: string;
    ticket: { id: string; code: string; status: string } | null;
  } | null;
  alreadyWeighed?: boolean;
};
export type WeightRow = {
  id: string; trackingNumber: string; status: OrderStatus; brandId: string; brandName: string; weightGrams: number; actualWeightGrams: number | null;
  weightStatus: WeightDisputeStatus; weightAdjustmentCents: number; billableGrams: number | null; dispute: { note: string; at: string } | null; updatedAt: string;
};
export type WeightList = Paginated<WeightRow> & { counts: Partial<Record<WeightDisputeStatus, number>> };

// ------------------------------------------------------------------ settings

export type FinanceSettings = {
  instapayAddress: string;
  walletNumber: string;
  acceptedCollectionMethods: CollectionMethod[];
  earlyPayoutFeeBp: number;
  codAdvanceFeeBp: number;
  codAdvanceMaxRateBp: number;
  advanceMinCents: number;
  claimDefaultCapCents: number;
  claimWindowHours: number;
  weightToleranceGrams: number;
  weightTolerancePct: number;
  volumetricDivisor: number;
  weightDisputeWindowHours: number;
};
