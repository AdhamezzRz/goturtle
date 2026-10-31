import type { CourierAvailability, FailureReason, OrderStatus, RunsheetStatus, VehicleType } from '@goturtle/shared';

// ------------------------------------------------------------------ control tower (/dispatch/live)

export interface LiveHero {
  id: string;
  code: string;
  name: string;
  phone: string;
  availability: CourierAvailability;
  vehicleType: VehicleType;
  lat: number | null;
  lng: number | null;
  lastSeenAt: string | null;
  cashOnHandCents: number;
  cashLimitCents: number;
  homeHubId: string | null;
  online: boolean;
  stale: boolean;
  cashUsage: number;
  runsheet: { id: string; code: string; status: RunsheetStatus; expectedCodCents: number; collectedCents: number; progress: { total: number; delivered: number; failed: number; pending: number } } | null;
}

export interface LiveOrder {
  id: string;
  trackingNumber: string;
  status: OrderStatus;
  courierId: string | null;
  lat: number;
  lng: number;
  approximate: boolean;
  zoneCode: string;
  promisedBy: string | null;
  collectCents: number;
  routeSequence: number | null;
}

export interface SlaRiskOrder {
  id: string;
  trackingNumber: string;
  status: OrderStatus;
  promisedBy: string | null;
  courierId: string | null;
  zoneCode: string;
  brandCode: string;
  courierCode: string | null;
  overdue: boolean;
  minutesLeft: number | null;
}

export interface LiveSnapshot {
  serverTime: string;
  date: string;
  counters: { heroesOnline: number; atHub: number; assigned: number; outForDelivery: number; deliveredToday: number; collectedTodayCents: number; failedToday: number; slaAtRisk: number };
  heroes: LiveHero[];
  orders: LiveOrder[];
  slaAtRisk: SlaRiskOrder[];
}

// ------------------------------------------------------------------ analytics (/analytics/ops/overview, /analytics/heroes)

export interface OpsOverview {
  range: { from: string; to: string; timezone: string };
  kpis: {
    ordersCreated: number; codBookedCents: number; delivered: number; returned: number; cancelled: number; successRate: number | null;
    firstAttemptSuccessRate: number | null; onTimeRate: number | null; avgHoursToDeliver: number | null; codCollectedCents: number; feesCents: number;
    feesExVatCents: number; failedAttempts: number; revenueCents: number; revenueSource: string; heroPayCents: number; cashInCustodyCents: number;
    activeHeroes: number; openTickets: number;
  };
  daily: Array<{ date: string; created: number; delivered: number; failedAttempts: number; returned: number; codCollectedCents: number }>;
  heatmap: { metric: string; values: number[][] };
  byZone: Array<{ zoneId: string; code: string; nameEn: string; nameAr: string; created: number; delivered: number; returned: number; cancelled: number; inProgress: number; successRate: number | null; codCollectedCents: number }>;
  topBrands: Array<{ brandId: string; code: string; name: string; created: number; delivered: number; returned: number; successRate: number | null; codCollectedCents: number; feesCents: number }>;
  failureReasons: Array<{ reason: FailureReason; count: number; share: number }>;
}

export interface HeroesReport {
  range: { from: string; to: string };
  heroes: Array<{
    courierId: string; code: string; name: string; employmentType: string; homeHubId: string | null; rating: number; attempts: number; delivered: number;
    failedAttempts: number; successRate: number | null; codCollectedCents: number; activeDays: number; deliveriesPerActiveDay: number; earningsCents: number; cashOnHandCents: number;
  }>;
}
