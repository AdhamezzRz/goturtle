export type HeroZone = { zoneId: string; code: string; nameEn: string; nameAr: string; isPrimary: boolean }

export type HeroRow = {
  id: string;
  code: string;
  name: string;
  phone: string;
  avatarUrl: string | null;
  employmentType: string;
  status: string;
  availability: string;
  vehicleType: string;
  homeHubId: string | null;
  rating: number;
  ratingCount: number;
  xp: number;
  streakDays: number;
  cashOnHandCents: number;
  cashLimitCents: number;
  lastSeenAt: string | null;
  joinedAt: string;
  hub: { id: string; code: string; name: string } | null;
  level: number;
  cashUsedPct: number;
  cashWarning: string;
  activeOrders: number;
  zones: HeroZone[];
}

export type KpiWindow = { deliveries: number; failedAttempts: number; successRate: number; avgDeliveryMinutes: number | null; codCollectedCents: number; earningsCents: number }

export type HeroDetail = {
  id: string;
  code: string;
  userId: string;
  name: string;
  phone: string;
  email: string | null;
  locale: 'ar' | 'en';
  avatarUrl: string | null;
  userStatus: string;
  lastLoginAt: string | null;
  employmentType: string;
  status: string;
  availability: string;
  nationalId: string | null;
  dateOfBirth: string | null;
  vehicleType: string;
  vehiclePlate: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  homeHub: { id: string; code: string; name: string; lat: number | null; lng: number | null } | null;
  zones: HeroZone[];
  rates: { perDeliveryRateCents: number; perPickupRateCents: number; failedAttemptRateCents: number; hourlyRateCents: number; monthlySalaryCents: number };
  cash: { onHandCents: number; limitCents: number; availableCents: number; usedPct: number; warning: string };
  payableCents: number;
  maxActiveOrders: number;
  activeOrders: number;
  rating: number;
  ratingCount: number;
  xp: number;
  level: { level: number; en: string; ar: string; emoji: string; progress: number; next: { level: number; minXp: number; en: string; ar: string } | null };
  streakDays: number;
  lastLat: number | null;
  lastLng: number | null;
  lastSeenAt: string | null;
  walletPhone: string | null;
  bankDetails: { bankName?: string; iban?: string; accountName?: string; accountNumber?: string; instapayAddress?: string } | null;
  emergencyContact: { name: string; phone: string; relation?: string } | null;
  documents: { total: number; pending: number; approved: number; rejected: number; expiringSoon: number; missingRequired: string[] };
  kpis: { today: KpiWindow; last7d: KpiWindow; last30d: KpiWindow };
  joinedAt: string;
  updatedAt: string;
}

export type HeroDocument = {
  id: string;
  courierId: string;
  type: string;
  url: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  expiresAt: string | null;
  reviewedById: string | null;
  reviewNote: string | null;
  createdAt: string;
}

export type TrackPoint = { lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null; battery: number | null; recordedAt: string }
export type TrackResponse = { courierId: string; code: string; date: string; points: TrackPoint[] }

export type LeaderboardRow = { rank: number; courierId: string; code: string; name: string; deliveries: number; successRate: number; periodXp: number }
export type Leaderboard = { period: string; data: LeaderboardRow[] }

export type OnboardResult = HeroDetail & { temporaryPassword: string };
