/**
 * GoTurtle Logistics ERP — data model (MySQL 8 / MariaDB 10.6+).
 *
 * Conventions
 *  - Money: INT piasters (1 EGP = 100), columns suffixed `Cents`. Never floats.
 *  - Weight in grams, distance in km, durations in minutes.
 *  - Timestamps: DATETIME(3) in UTC. Business days use Africa/Cairo.
 *  - Enums come straight from @goturtle/shared, so web, API and DB share one source of truth.
 *  - Table names snake_case; column names are the camelCase property names.
 */
import {
  AdjustmentType, ActorType, BrandStatus, CourierAvailability, CourierStatus, DeliveryStatus,
  DocumentStatus, DocumentType, EmploymentType, FailureReason, FeesPayer, HandoverMethod,
  HandoverStatus, IntegrationProvider, IntegrationStatus, LedgerAccountType, LedgerTxKind, Locale,
  NotificationChannel, NotificationStatus, OrderSource, OrderStatus, OrderType, OtpPurpose,
  PaymentMethod, PayoutMethod, PayoutStatus, PickupStatus, PricingTier, RunsheetStatus,
  ServiceLevel, SettlementCycle, SettlementStatus, ShiftStatus, TicketCategory, TicketPriority,
  TicketStatus, UserRole, UserStatus, VehicleType,
} from '@goturtle/shared';
import {
  boolean, date, double, index, int, mysqlEnum, mysqlTable, primaryKey, text, uniqueIndex, varchar,
  type AnyMySqlColumn,
} from 'drizzle-orm/mysql-core';
import { cents, createdAt, id, jsonOf, ref, ts, updatedAt } from './columns';

// ---------------------------------------------------------------------------
//  Identity & access
// ---------------------------------------------------------------------------

export const users = mysqlTable(
  'users',
  {
    id: id(),
    name: varchar({ length: 120 }).notNull(),
    email: varchar({ length: 191 }).unique(),
    phone: varchar({ length: 20 }).notNull().unique(), // E.164 +201XXXXXXXXX
    passwordHash: varchar({ length: 100 }).notNull(),
    role: mysqlEnum(UserRole).notNull(),
    status: mysqlEnum(UserStatus).notNull().default('ACTIVE'),
    locale: mysqlEnum(Locale).notNull().default('ar'),
    avatarUrl: varchar({ length: 500 }),
    brandId: ref().references((): AnyMySqlColumn => brands.id),
    hubId: ref().references((): AnyMySqlColumn => hubs.id),
    lastLoginAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('users_role_idx').on(t.role), index('users_brand_idx').on(t.brandId)],
);

export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    id: id(),
    userId: ref().notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar({ length: 64 }).notNull().unique(),
    family: varchar({ length: 32 }).notNull(), // reuse of a rotated token revokes the whole family
    expiresAt: ts().notNull(),
    revokedAt: ts(),
    userAgent: varchar({ length: 300 }),
    ip: varchar({ length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('rt_user_idx').on(t.userId), index('rt_family_idx').on(t.family)],
);

export const apiKeys = mysqlTable(
  'api_keys',
  {
    id: id(),
    brandId: ref().notNull().references((): AnyMySqlColumn => brands.id, { onDelete: 'cascade' }),
    name: varchar({ length: 120 }).notNull(),
    prefix: varchar({ length: 24 }).notNull().unique(), // shown in UI, e.g. gt_live_ab12cd
    keyHash: varchar({ length: 64 }).notNull().unique(), // sha256 of the full key
    scopes: jsonOf<string[]>().notNull(),
    lastUsedAt: ts(),
    revokedAt: ts(),
    createdById: ref(),
    createdAt: createdAt(),
  },
  (t) => [index('apikey_brand_idx').on(t.brandId)],
);

export const otpCodes = mysqlTable(
  'otp_codes',
  {
    id: id(),
    phone: varchar({ length: 20 }).notNull(),
    purpose: mysqlEnum(OtpPurpose).notNull(),
    codeHash: varchar({ length: 64 }).notNull(),
    orderId: ref(),
    attempts: int().notNull().default(0),
    expiresAt: ts().notNull(),
    consumedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index('otp_phone_idx').on(t.phone, t.purpose), index('otp_order_idx').on(t.orderId)],
);

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: id(),
    actorId: ref().references(() => users.id, { onDelete: 'set null' }),
    actorType: mysqlEnum(ActorType).notNull(),
    action: varchar({ length: 100 }).notNull(), // order.cancel, payout.approve …
    entity: varchar({ length: 60 }).notNull(),
    entityId: varchar({ length: 64 }),
    before: jsonOf<unknown>(),
    after: jsonOf<unknown>(),
    ip: varchar({ length: 64 }),
    userAgent: varchar({ length: 300 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entity, t.entityId),
    index('audit_actor_idx').on(t.actorId),
    index('audit_created_idx').on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
//  Geography & network
// ---------------------------------------------------------------------------

export const governorates = mysqlTable('governorates', {
  id: id(),
  code: varchar({ length: 10 }).notNull().unique(), // CAI, GIZ, QAL
  nameEn: varchar({ length: 100 }).notNull(),
  nameAr: varchar({ length: 100 }).notNull(),
});

export const cities = mysqlTable('cities', {
  id: id(),
  governorateId: ref().notNull().references(() => governorates.id),
  code: varchar({ length: 20 }).notNull().unique(),
  nameEn: varchar({ length: 100 }).notNull(),
  nameAr: varchar({ length: 100 }).notNull(),
});

export type GeoPolygon = { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };

export const hubs = mysqlTable('hubs', {
  id: id(),
  code: varchar({ length: 20 }).notNull().unique(),
  name: varchar({ length: 120 }).notNull(),
  nameAr: varchar({ length: 120 }),
  address: varchar({ length: 300 }).notNull(),
  lat: double().notNull(),
  lng: double().notNull(),
  phone: varchar({ length: 20 }),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const zones = mysqlTable(
  'zones',
  {
    id: id(),
    code: varchar({ length: 30 }).notNull().unique(), // CAI-NASR
    nameEn: varchar({ length: 100 }).notNull(),
    nameAr: varchar({ length: 100 }).notNull(),
    cityId: ref().notNull().references(() => cities.id),
    hubId: ref().references(() => hubs.id),
    tier: mysqlEnum(PricingTier).notNull().default('A'),
    keywords: jsonOf<string[]>().notNull(), // en / ar / franco aliases for the address parser
    polygon: jsonOf<GeoPolygon | null>(),
    centerLat: double().notNull(),
    centerLng: double().notNull(),
    isActive: boolean().notNull().default(true),
    slaHours: int().notNull().default(24),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('zones_city_idx').on(t.cityId), index('zones_hub_idx').on(t.hubId)],
);

// ---------------------------------------------------------------------------
//  Brands (merchants) & pricing
// ---------------------------------------------------------------------------

export const pricingPlans = mysqlTable('pricing_plans', {
  id: id(),
  name: varchar({ length: 120 }).notNull(),
  description: varchar({ length: 500 }),
  isDefault: boolean().notNull().default(false),
  codFeeBp: int().notNull().default(100), // basis points of COD (100 = 1%)
  codFeeMinCents: cents(),
  includedWeightGrams: int().notNull().default(3000),
  extraKgCents: int().notNull().default(500),
  returnFeeBp: int().notNull().default(5000), // % of shipping fee on RTO
  exchangeFeeCents: cents(),
  insuranceBp: int().notNull().default(0),
  vatBp: int().notNull().default(1400), // Egypt VAT 14%
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const pricingRules = mysqlTable(
  'pricing_rules',
  {
    id: id(),
    planId: ref().notNull().references(() => pricingPlans.id, { onDelete: 'cascade' }),
    tier: mysqlEnum(PricingTier).notNull(),
    serviceLevel: mysqlEnum(ServiceLevel).notNull(),
    baseFeeCents: int().notNull(),
  },
  (t) => [uniqueIndex('pricing_rule_uq').on(t.planId, t.tier, t.serviceLevel)],
);

export type PayoutDetails = {
  bankName?: string;
  iban?: string;
  accountName?: string;
  accountNumber?: string;
  instapayAddress?: string;
  walletPhone?: string;
};

export const brands = mysqlTable(
  'brands',
  {
    id: id(),
    code: varchar({ length: 12 }).notNull().unique(), // printed on labels
    name: varchar({ length: 150 }).notNull(),
    legalName: varchar({ length: 200 }),
    commercialRegNo: varchar({ length: 50 }),
    taxId: varchar({ length: 50 }),
    industry: varchar({ length: 80 }),
    logoUrl: varchar({ length: 500 }),
    website: varchar({ length: 300 }),
    email: varchar({ length: 191 }),
    phone: varchar({ length: 20 }).notNull(),
    status: mysqlEnum(BrandStatus).notNull().default('PENDING'),
    pricingPlanId: ref().references(() => pricingPlans.id),
    settlementCycle: mysqlEnum(SettlementCycle).notNull().default('WEEKLY'),
    payoutMethod: mysqlEnum(PayoutMethod).notNull().default('BANK_TRANSFER'),
    payoutDetails: jsonOf<PayoutDetails | null>(),
    allowOpenPackage: boolean().notNull().default(false),
    defaultFeesPaidBy: mysqlEnum(FeesPayer).notNull().default('BRAND'),
    accountManagerId: ref().references((): AnyMySqlColumn => users.id),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('brands_status_idx').on(t.status)],
);

export const brandLocations = mysqlTable(
  'brand_locations',
  {
    id: id(),
    brandId: ref().notNull().references(() => brands.id, { onDelete: 'cascade' }),
    name: varchar({ length: 120 }).notNull(),
    contactName: varchar({ length: 120 }).notNull(),
    phone: varchar({ length: 20 }).notNull(),
    addressLine: varchar({ length: 500 }).notNull(),
    zoneId: ref().notNull().references(() => zones.id),
    lat: double(),
    lng: double(),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('bl_brand_idx').on(t.brandId)],
);

// ---------------------------------------------------------------------------
//  Customers (consignees)
// ---------------------------------------------------------------------------

export const customers = mysqlTable('customers', {
  id: id(),
  phone: varchar({ length: 20 }).notNull().unique(),
  name: varchar({ length: 150 }).notNull(),
  email: varchar({ length: 191 }),
  altPhone: varchar({ length: 20 }),
  totalOrders: int().notNull().default(0),
  deliveredOrders: int().notNull().default(0),
  refusedOrders: int().notNull().default(0),
  reliabilityScore: int().notNull().default(80), // 0..100
  isBlocked: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
//  Delivery heroes (couriers)
// ---------------------------------------------------------------------------

export const couriers = mysqlTable(
  'couriers',
  {
    id: id(),
    userId: ref().notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
    code: varchar({ length: 20 }).notNull().unique(), // HR-00042
    employmentType: mysqlEnum(EmploymentType).notNull().default('FREELANCE'),
    status: mysqlEnum(CourierStatus).notNull().default('PENDING_ONBOARDING'),
    availability: mysqlEnum(CourierAvailability).notNull().default('OFFLINE'),
    nationalId: varchar({ length: 14 }).unique(), // Egyptian national ID = 14 digits
    dateOfBirth: date({ mode: 'string' }),
    vehicleType: mysqlEnum(VehicleType).notNull().default('MOTORCYCLE'),
    vehiclePlate: varchar({ length: 20 }),
    licenseNumber: varchar({ length: 40 }),
    licenseExpiry: date({ mode: 'string' }),
    homeHubId: ref().references(() => hubs.id),

    perDeliveryRateCents: int().notNull().default(2000),
    perPickupRateCents: int().notNull().default(500),
    failedAttemptRateCents: int().notNull().default(500),
    hourlyRateCents: cents(),
    monthlySalaryCents: cents(),

    cashLimitCents: int().notNull().default(500000), // 5,000 EGP custody cap
    cashOnHandCents: cents(), // cached custody balance (ledger is the source of truth)
    maxActiveOrders: int().notNull().default(30),

    rating: double().notNull().default(5),
    ratingCount: int().notNull().default(0),
    xp: int().notNull().default(0),
    streakDays: int().notNull().default(0),

    lastLat: double(),
    lastLng: double(),
    lastSeenAt: ts(),
    walletPhone: varchar({ length: 20 }),
    bankDetails: jsonOf<PayoutDetails | null>(),
    emergencyContact: jsonOf<{ name: string; phone: string; relation?: string } | null>(),
    joinedAt: createdAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('couriers_status_idx').on(t.status, t.availability)],
);

export const courierZones = mysqlTable(
  'courier_zones',
  {
    courierId: ref().notNull().references(() => couriers.id, { onDelete: 'cascade' }),
    zoneId: ref().notNull().references(() => zones.id, { onDelete: 'cascade' }),
    isPrimary: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.courierId, t.zoneId] })],
);

export const courierDocuments = mysqlTable(
  'courier_documents',
  {
    id: id(),
    courierId: ref().notNull().references(() => couriers.id, { onDelete: 'cascade' }),
    type: mysqlEnum(DocumentType).notNull(),
    url: varchar({ length: 500 }).notNull(),
    status: mysqlEnum(DocumentStatus).notNull().default('PENDING'),
    expiresAt: ts(),
    reviewedById: ref(),
    reviewNote: varchar({ length: 500 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cdoc_courier_idx').on(t.courierId)],
);

export const courierLocations = mysqlTable(
  'courier_locations',
  {
    id: id(),
    courierId: ref().notNull().references(() => couriers.id, { onDelete: 'cascade' }),
    lat: double().notNull(),
    lng: double().notNull(),
    accuracy: double(),
    speed: double(),
    heading: double(),
    battery: int(),
    recordedAt: createdAt(),
  },
  (t) => [index('cloc_courier_time_idx').on(t.courierId, t.recordedAt)],
);

// ---------------------------------------------------------------------------
//  First mile: pickups
// ---------------------------------------------------------------------------

export const pickups = mysqlTable(
  'pickups',
  {
    id: id(),
    code: varchar({ length: 24 }).notNull().unique(),
    brandId: ref().notNull().references(() => brands.id),
    locationId: ref().notNull().references(() => brandLocations.id),
    courierId: ref().references(() => couriers.id),
    status: mysqlEnum(PickupStatus).notNull().default('REQUESTED'),
    scheduledDate: date({ mode: 'string' }).notNull(), // YYYY-MM-DD (Cairo)
    timeWindow: varchar({ length: 20 }), // "10:00-14:00"
    expectedCount: int().notNull().default(0),
    pickedCount: int().notNull().default(0),
    notes: varchar({ length: 1000 }),
    failureNote: varchar({ length: 1000 }),
    startedAt: ts(),
    completedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('pickups_status_date_idx').on(t.status, t.scheduledDate), index('pickups_courier_idx').on(t.courierId)],
);

// ---------------------------------------------------------------------------
//  Last mile: runsheets (daily manifests)
// ---------------------------------------------------------------------------

export type RouteStopJson = { orderId: string; seq: number; lat: number; lng: number; etaMinutes: number; legKm: number };

export const runsheets = mysqlTable(
  'runsheets',
  {
    id: id(),
    code: varchar({ length: 24 }).notNull().unique(),
    courierId: ref().notNull().references(() => couriers.id),
    hubId: ref().references(() => hubs.id),
    date: date({ mode: 'string' }).notNull(),
    status: mysqlEnum(RunsheetStatus).notNull().default('DRAFT'),
    route: jsonOf<RouteStopJson[] | null>(),
    totalDistanceKm: double(),
    totalMinutes: int(),
    expectedCodCents: cents(),
    collectedCents: cents(),
    dispatchedAt: ts(),
    startedAt: ts(),
    completedAt: ts(),
    closedAt: ts(),
    createdById: ref(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('rs_courier_date_idx').on(t.courierId, t.date), index('rs_status_idx').on(t.status)],
);

// ---------------------------------------------------------------------------
//  Cash custody (COD handed back by heroes)
// ---------------------------------------------------------------------------

export const cashHandovers = mysqlTable(
  'cash_handovers',
  {
    id: id(),
    code: varchar({ length: 24 }).notNull().unique(),
    courierId: ref().notNull().references(() => couriers.id),
    hubId: ref().references(() => hubs.id),
    method: mysqlEnum(HandoverMethod).notNull(),
    declaredCents: int().notNull(), // what the hero says they handed over
    receivedCents: cents(), // what finance confirmed
    varianceCents: int().notNull().default(0), // received - declared (negative = shortage)
    reference: varchar({ length: 120 }),
    proofUrl: varchar({ length: 500 }),
    status: mysqlEnum(HandoverStatus).notNull().default('PENDING'),
    notes: varchar({ length: 1000 }),
    receivedById: ref(),
    confirmedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ch_courier_status_idx').on(t.courierId, t.status)],
);

// ---------------------------------------------------------------------------
//  Brand settlements & hero payroll
// ---------------------------------------------------------------------------

export const settlements = mysqlTable(
  'settlements',
  {
    id: id(),
    code: varchar({ length: 24 }).notNull().unique(),
    brandId: ref().notNull().references(() => brands.id),
    periodStart: ts().notNull(),
    periodEnd: ts().notNull(),
    ordersCount: int().notNull().default(0),
    codCollectedCents: cents(),
    feesCents: cents(), // incl. VAT
    vatCents: cents(),
    adjustmentsCents: cents(),
    netPayableCents: cents(), // cod - fees + adjustments (negative = brand owes us)
    status: mysqlEnum(SettlementStatus).notNull().default('DRAFT'),
    method: mysqlEnum(PayoutMethod),
    paymentReference: varchar({ length: 120 }),
    invoiceNumber: varchar({ length: 40 }).unique(),
    etaInvoiceUuid: varchar({ length: 100 }), // Egyptian Tax Authority e-invoice (integration hook)
    approvedById: ref(),
    approvedAt: ts(),
    paidAt: ts(),
    notes: varchar({ length: 1000 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('settle_brand_status_idx').on(t.brandId, t.status)],
);

export const courierPayouts = mysqlTable(
  'courier_payouts',
  {
    id: id(),
    code: varchar({ length: 24 }).notNull().unique(),
    courierId: ref().notNull().references(() => couriers.id),
    periodStart: ts().notNull(),
    periodEnd: ts().notNull(),
    deliveriesCount: int().notNull().default(0),
    pickupsCount: int().notNull().default(0),
    failedAttemptsCount: int().notNull().default(0),
    workedMinutes: int().notNull().default(0),
    deliveryEarningsCents: cents(),
    hourlyEarningsCents: cents(),
    salaryCents: cents(),
    bonusesCents: cents(),
    deductionsCents: cents(), // penalties + shortages + advances
    netCents: cents(),
    status: mysqlEnum(PayoutStatus).notNull().default('DRAFT'),
    method: mysqlEnum(PayoutMethod),
    paymentReference: varchar({ length: 120 }),
    approvedById: ref(),
    paidAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cpay_courier_status_idx').on(t.courierId, t.status)],
);

// ---------------------------------------------------------------------------
//  Orders (shipments)
// ---------------------------------------------------------------------------

export const orders = mysqlTable(
  'orders',
  {
    id: id(),
    trackingNumber: varchar({ length: 16 }).notNull().unique(),
    brandId: ref().notNull().references(() => brands.id),
    brandReference: varchar({ length: 100 }), // merchant's own order number
    type: mysqlEnum(OrderType).notNull().default('DELIVERY'),
    serviceLevel: mysqlEnum(ServiceLevel).notNull().default('STANDARD'),
    status: mysqlEnum(OrderStatus).notNull().default('CREATED'),
    source: mysqlEnum(OrderSource).notNull().default('PORTAL'),

    customerId: ref().notNull().references(() => customers.id),
    recipientName: varchar({ length: 150 }).notNull(),
    recipientPhone: varchar({ length: 20 }).notNull(),
    recipientAltPhone: varchar({ length: 20 }),
    addressLine: varchar({ length: 500 }).notNull(),
    building: varchar({ length: 50 }),
    floor: varchar({ length: 20 }),
    apartment: varchar({ length: 20 }),
    landmark: varchar({ length: 200 }),
    zoneId: ref().notNull().references(() => zones.id),
    lat: double(),
    lng: double(),

    pickupLocationId: ref().references(() => brandLocations.id),
    hubId: ref().references(() => hubs.id),
    pickupId: ref().references(() => pickups.id),
    runsheetId: ref().references(() => runsheets.id),
    routeSequence: int(),
    courierId: ref().references(() => couriers.id),

    packageDescription: varchar({ length: 500 }),
    itemsCount: int().notNull().default(1),
    weightGrams: int().notNull().default(1000),
    isFragile: boolean().notNull().default(false),
    allowOpening: boolean().notNull().default(false),
    declaredValueCents: cents(),

    paymentMethod: mysqlEnum(PaymentMethod).notNull().default('COD'),
    codAmountCents: cents(), // the brand's COD amount
    collectCents: cents(), // what the hero must collect (COD + fees if recipient pays)
    collectedCents: cents(), // what the hero actually collected
    feesPaidBy: mysqlEnum(FeesPayer).notNull().default('BRAND'),
    shippingFeeCents: cents(),
    codFeeCents: cents(),
    extraFeesCents: cents(), // weight, insurance, exchange, return
    vatCents: cents(),
    totalFeesCents: cents(),

    attempts: int().notNull().default(0),
    maxAttempts: int().notNull().default(3),
    riskScore: int().notNull().default(0), // 0..100 (higher = riskier COD)
    priority: int().notNull().default(0),

    scheduledDate: date({ mode: 'string' }),
    promisedBy: ts(),
    pickedUpAt: ts(),
    outForDeliveryAt: ts(),
    deliveredAt: ts(),
    returnedAt: ts(),
    cancelledAt: ts(),

    deliveryOtpRequired: boolean().notNull().default(false),
    podPhotoUrl: varchar({ length: 500 }),
    podSignatureUrl: varchar({ length: 500 }),
    podReceivedBy: varchar({ length: 150 }),

    rating: int(),
    ratingComment: varchar({ length: 1000 }),

    notes: varchar({ length: 1000 }), // visible to the hero
    internalNotes: varchar({ length: 2000 }),
    tags: jsonOf<string[]>(),

    settlementId: ref().references(() => settlements.id),
    cashHandoverId: ref().references(() => cashHandovers.id),
    parentOrderId: ref().references((): AnyMySqlColumn => orders.id),
    externalId: varchar({ length: 100 }), // id in Shopify / WooCommerce
    metadata: jsonOf<Record<string, unknown> | null>(),

    createdById: ref(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_brand_ref_uq').on(t.brandId, t.brandReference),
    index('orders_status_idx').on(t.status),
    index('orders_brand_created_idx').on(t.brandId, t.createdAt),
    index('orders_courier_status_idx').on(t.courierId, t.status),
    index('orders_zone_status_idx').on(t.zoneId, t.status),
    index('orders_phone_idx').on(t.recipientPhone),
    index('orders_runsheet_idx').on(t.runsheetId),
    index('orders_pickup_idx').on(t.pickupId),
    index('orders_settlement_idx').on(t.settlementId),
    index('orders_created_idx').on(t.createdAt),
  ],
);

export const orderEvents = mysqlTable(
  'order_events',
  {
    id: id(),
    orderId: ref().notNull().references(() => orders.id, { onDelete: 'cascade' }),
    status: mysqlEnum(OrderStatus).notNull(),
    fromStatus: mysqlEnum(OrderStatus),
    reason: varchar({ length: 60 }),
    note: varchar({ length: 1000 }),
    actorId: ref(),
    actorType: mysqlEnum(ActorType).notNull(),
    actorName: varchar({ length: 150 }),
    hubId: ref().references(() => hubs.id),
    lat: double(),
    lng: double(),
    isPublic: boolean().notNull().default(true), // shown on the customer tracking timeline
    metadata: jsonOf<Record<string, unknown> | null>(),
    createdAt: createdAt(),
  },
  (t) => [index('oe_order_time_idx').on(t.orderId, t.createdAt)],
);

export const deliveryAttempts = mysqlTable(
  'delivery_attempts',
  {
    id: id(),
    orderId: ref().notNull().references(() => orders.id, { onDelete: 'cascade' }),
    courierId: ref().notNull().references(() => couriers.id),
    attemptNo: int().notNull(),
    success: boolean().notNull(),
    failureReason: mysqlEnum(FailureReason),
    note: varchar({ length: 1000 }),
    lat: double(),
    lng: double(),
    photoUrl: varchar({ length: 500 }),
    createdAt: createdAt(),
  },
  (t) => [index('da_order_idx').on(t.orderId), index('da_courier_time_idx').on(t.courierId, t.createdAt)],
);

// ---------------------------------------------------------------------------
//  Shifts & attendance (hourly heroes)
// ---------------------------------------------------------------------------

export const shiftTemplates = mysqlTable('shift_templates', {
  id: id(),
  name: varchar({ length: 120 }).notNull(),
  startTime: varchar({ length: 5 }).notNull(), // "09:00" Africa/Cairo
  endTime: varchar({ length: 5 }).notNull(), // "17:00" (may be < start for overnight)
  daysOfWeek: jsonOf<number[]>().notNull(), // 0=Sunday … 6=Saturday
  hubId: ref().references(() => hubs.id),
  zoneId: ref().references(() => zones.id),
  requiredCouriers: int().notNull().default(1),
  hourlyRateCents: int(), // overrides the hero's own hourly rate
  breakMinutes: int().notNull().default(30),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const shifts = mysqlTable(
  'shifts',
  {
    id: id(),
    courierId: ref().notNull().references(() => couriers.id, { onDelete: 'cascade' }),
    templateId: ref().references(() => shiftTemplates.id),
    hubId: ref().references(() => hubs.id),
    zoneId: ref().references(() => zones.id),
    startAt: ts().notNull(),
    endAt: ts().notNull(),
    status: mysqlEnum(ShiftStatus).notNull().default('SCHEDULED'),
    clockInAt: ts(),
    clockOutAt: ts(),
    clockInLat: double(),
    clockInLng: double(),
    clockOutLat: double(),
    clockOutLng: double(),
    workedMinutes: int().notNull().default(0),
    breakMinutes: int().notNull().default(0),
    lateMinutes: int().notNull().default(0),
    overtimeMinutes: int().notNull().default(0),
    hourlyRateCents: cents(), // frozen when booked
    payoutId: ref().references(() => courierPayouts.id),
    notes: varchar({ length: 1000 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('shifts_courier_start_idx').on(t.courierId, t.startAt), index('shifts_status_start_idx').on(t.status, t.startAt)],
);

export const courierAdjustments = mysqlTable(
  'courier_adjustments',
  {
    id: id(),
    courierId: ref().notNull().references(() => couriers.id),
    type: mysqlEnum(AdjustmentType).notNull(),
    amountCents: int().notNull(), // always positive; the type gives the sign
    reason: varchar({ length: 500 }).notNull(),
    orderId: ref().references(() => orders.id),
    payoutId: ref().references(() => courierPayouts.id),
    createdById: ref(),
    createdAt: createdAt(),
  },
  (t) => [index('cadj_courier_time_idx').on(t.courierId, t.createdAt)],
);

// ---------------------------------------------------------------------------
//  Double-entry ledger
// ---------------------------------------------------------------------------

export const ledgerAccounts = mysqlTable(
  'ledger_accounts',
  {
    id: id(),
    code: varchar({ length: 80 }).notNull().unique(), // 1100, 2100:BRAND:<id> …
    name: varchar({ length: 150 }).notNull(),
    type: mysqlEnum(LedgerAccountType).notNull(),
    brandId: ref().references(() => brands.id),
    courierId: ref().references(() => couriers.id),
    balanceCents: int().notNull().default(0), // signed in the account's normal direction
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('la_brand_idx').on(t.brandId), index('la_courier_idx').on(t.courierId)],
);

export const ledgerTransactions = mysqlTable(
  'ledger_transactions',
  {
    id: id(),
    kind: mysqlEnum(LedgerTxKind).notNull(),
    reference: varchar({ length: 120 }).notNull().unique(), // idempotency key, e.g. order:<id>:cod
    description: varchar({ length: 300 }).notNull(),
    orderId: ref().references(() => orders.id),
    createdById: ref(),
    metadata: jsonOf<Record<string, unknown> | null>(),
    createdAt: createdAt(),
  },
  (t) => [index('lt_order_idx').on(t.orderId), index('lt_kind_time_idx').on(t.kind, t.createdAt)],
);

export const ledgerEntries = mysqlTable(
  'ledger_entries',
  {
    id: id(),
    transactionId: ref().notNull().references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
    accountId: ref().notNull().references(() => ledgerAccounts.id),
    debitCents: cents(),
    creditCents: cents(),
    createdAt: createdAt(),
  },
  (t) => [index('le_account_idx').on(t.accountId, t.createdAt), index('le_tx_idx').on(t.transactionId)],
);

// ---------------------------------------------------------------------------
//  Integrations: webhooks, e-commerce connectors, notifications
// ---------------------------------------------------------------------------

export const webhookEndpoints = mysqlTable(
  'webhook_endpoints',
  {
    id: id(),
    brandId: ref().notNull().references(() => brands.id, { onDelete: 'cascade' }),
    url: varchar({ length: 500 }).notNull(),
    secret: varchar({ length: 100 }).notNull(), // HMAC-SHA256 signing secret
    events: jsonOf<string[]>().notNull(), // ["order.delivered"] or ["*"]
    isActive: boolean().notNull().default(true),
    description: varchar({ length: 300 }),
    failureCount: int().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('wh_brand_idx').on(t.brandId)],
);

export const webhookDeliveries = mysqlTable(
  'webhook_deliveries',
  {
    id: id(),
    endpointId: ref().notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    event: varchar({ length: 60 }).notNull(),
    payload: jsonOf<unknown>().notNull(),
    status: mysqlEnum(DeliveryStatus).notNull().default('PENDING'),
    attempts: int().notNull().default(0),
    nextAttemptAt: createdAt(),
    lastResponseCode: int(),
    lastResponseBody: text(),
    lastError: varchar({ length: 1000 }),
    deliveredAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index('whd_status_next_idx').on(t.status, t.nextAttemptAt), index('whd_endpoint_idx').on(t.endpointId, t.createdAt)],
);

export const integrationConnections = mysqlTable(
  'integration_connections',
  {
    id: id(),
    brandId: ref().notNull().references(() => brands.id, { onDelete: 'cascade' }),
    provider: mysqlEnum(IntegrationProvider).notNull(),
    shopDomain: varchar({ length: 191 }).notNull().default(''),
    credentials: text(), // AES-256-GCM encrypted JSON
    settings: jsonOf<Record<string, unknown> | null>(),
    inboundSecret: varchar({ length: 100 }).notNull(),
    status: mysqlEnum(IntegrationStatus).notNull().default('ACTIVE'),
    lastSyncAt: ts(),
    lastError: varchar({ length: 1000 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('integ_uq').on(t.brandId, t.provider, t.shopDomain)],
);

export const notifications = mysqlTable(
  'notifications',
  {
    id: id(),
    channel: mysqlEnum(NotificationChannel).notNull(),
    recipient: varchar({ length: 191 }).notNull(), // phone / email / userId
    userId: ref().references(() => users.id, { onDelete: 'set null' }),
    orderId: ref(),
    template: varchar({ length: 60 }).notNull(),
    locale: mysqlEnum(Locale).notNull().default('ar'),
    title: varchar({ length: 200 }),
    body: text().notNull(),
    data: jsonOf<Record<string, unknown> | null>(),
    status: mysqlEnum(NotificationStatus).notNull().default('QUEUED'),
    provider: varchar({ length: 40 }),
    providerMessageId: varchar({ length: 120 }),
    error: varchar({ length: 1000 }),
    attempts: int().notNull().default(0),
    sentAt: ts(),
    readAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('notif_user_status_idx').on(t.userId, t.status),
    index('notif_status_time_idx').on(t.status, t.createdAt),
    index('notif_order_idx').on(t.orderId),
  ],
);

// ---------------------------------------------------------------------------
//  Customer support
// ---------------------------------------------------------------------------

export const tickets = mysqlTable(
  'tickets',
  {
    id: id(),
    code: varchar({ length: 24 }).notNull().unique(),
    subject: varchar({ length: 200 }).notNull(),
    category: mysqlEnum(TicketCategory).notNull(),
    priority: mysqlEnum(TicketPriority).notNull().default('MEDIUM'),
    status: mysqlEnum(TicketStatus).notNull().default('OPEN'),
    orderId: ref().references(() => orders.id),
    brandId: ref().references(() => brands.id),
    customerId: ref().references(() => customers.id),
    openedById: ref(),
    openedByType: mysqlEnum(ActorType).notNull(),
    contactName: varchar({ length: 150 }),
    contactPhone: varchar({ length: 20 }),
    assigneeId: ref().references(() => users.id),
    slaDueAt: ts(),
    resolvedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tickets_status_prio_idx').on(t.status, t.priority),
    index('tickets_brand_idx').on(t.brandId),
    index('tickets_order_idx').on(t.orderId),
  ],
);

export const ticketMessages = mysqlTable(
  'ticket_messages',
  {
    id: id(),
    ticketId: ref().notNull().references(() => tickets.id, { onDelete: 'cascade' }),
    authorId: ref(),
    authorType: mysqlEnum(ActorType).notNull(),
    authorName: varchar({ length: 150 }).notNull(),
    body: text().notNull(),
    isInternal: boolean().notNull().default(false),
    attachments: jsonOf<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [index('tm_ticket_time_idx').on(t.ticketId, t.createdAt)],
);

// ---------------------------------------------------------------------------
//  Platform
// ---------------------------------------------------------------------------

/** Atomic counters for human codes (runsheets, tickets, pickups, invoices …). */
export const sequences = mysqlTable('sequences', {
  key: varchar({ length: 80 }).primaryKey(),
  value: int().notNull().default(0),
});

export const systemSettings = mysqlTable('system_settings', {
  key: varchar({ length: 80 }).primaryKey(),
  value: jsonOf<unknown>().notNull(),
  description: varchar({ length: 300 }),
  updatedById: ref(),
  updatedAt: updatedAt(),
});

export const files = mysqlTable('files', {
  id: id(),
  key: varchar({ length: 300 }).notNull().unique(),
  url: varchar({ length: 500 }).notNull(),
  mimeType: varchar({ length: 100 }).notNull(),
  sizeBytes: int().notNull(),
  purpose: varchar({ length: 40 }).notNull(), // pod_photo, signature, courier_document, handover_proof, logo
  uploadedById: ref(),
  createdAt: createdAt(),
});

/** Background job lock / heartbeat so overlapping cron ticks never double-process. */
export const jobLocks = mysqlTable('job_locks', {
  name: varchar({ length: 60 }).primaryKey(),
  lockedUntil: ts().notNull(),
  lastRunAt: ts(),
  lastResult: varchar({ length: 1000 }),
});
