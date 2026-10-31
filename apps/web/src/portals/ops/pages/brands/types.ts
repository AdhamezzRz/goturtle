export type PayoutDetails = { bankName?: string; iban?: string; accountName?: string; accountNumber?: string; instapayAddress?: string; walletPhone?: string };

export type BrandRow = {
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
  pricingPlanId: string | null;
  settlementCycle: string;
  payoutMethod: string;
  payoutDetails: PayoutDetails | null;
  allowOpenPackage: boolean;
  defaultFeesPaidBy: string;
  accountManagerId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  plan: { id: string; name: string } | null;
  accountManager: { id: string; name: string; phone?: string; email?: string | null } | null;
  orders30d?: number;
  walletBalanceCents?: number;
};

export type BrandLocation = {
  id: string;
  brandId: string;
  name: string;
  contactName: string;
  phone: string;
  addressLine: string;
  zoneId: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  isActive: boolean;
  zone: { id: string; code: string; nameEn: string; nameAr: string } | null;
};

export type TeamMember = { id: string; name: string; email: string | null; phone: string; role: string; status: string; lastLoginAt: string | null; invitePending: boolean; avatarUrl: string | null };

export type BrandDetail = BrandRow & {
  stats: {
    totalOrders: number;
    ordersByStatus: Record<string, number>;
    last30Days: { orders: number; delivered: number; returned: number; codCollectedCents: number; feesCents: number };
    walletBalanceCents: number;
  };
  locations: BrandLocation[];
  team: TeamMember[];
};

export type PricingPlan = { id: string; name: string; isDefault: boolean };

export type ApiKeyRow = { id: string; brandId: string; brandName: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string; createdByName: string | null; active: boolean };
export type WebhookEndpoint = { id: string; brandId: string; brandName: string; url: string; events: string[]; isActive: boolean; description: string | null; failureCount: number; createdAt: string; secretHint: string };
export type Connection = { id: string; brandId: string; brandName: string; provider: string; shopDomain: string | null; status: string; lastSyncAt: string | null; lastError: string | null; createdAt: string; webhookUrl: string | null };
