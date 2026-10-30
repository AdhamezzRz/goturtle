/**
 * Enum mirrors of apps/api/prisma/schema.prisma.
 * They are plain `as const` objects so the web app can use them without Prisma.
 * apps/api/test/enums-sync.spec.ts fails if these drift from the Prisma schema.
 */
const e = <T extends string>(...values: T[]) =>
  Object.freeze(Object.fromEntries(values.map((v) => [v, v])) as { [K in T]: K });

export const UserRole = e(
  'SUPER_ADMIN', 'OPS_MANAGER', 'DISPATCHER', 'HUB_OPERATOR', 'FINANCE', 'SUPPORT',
  'BRAND_OWNER', 'BRAND_STAFF', 'COURIER',
);
export type UserRole = keyof typeof UserRole;

export const UserStatus = e('ACTIVE', 'INVITED', 'SUSPENDED');
export type UserStatus = keyof typeof UserStatus;

export const Locale = e('en', 'ar');
export type Locale = keyof typeof Locale;

export const OtpPurpose = e('LOGIN', 'DELIVERY', 'TRACKING', 'PASSWORD_RESET');
export type OtpPurpose = keyof typeof OtpPurpose;

export const ActorType = e('SYSTEM', 'STAFF', 'BRAND', 'COURIER', 'CUSTOMER', 'API', 'INTEGRATION');
export type ActorType = keyof typeof ActorType;

export const PricingTier = e('A', 'B', 'C', 'D');
export type PricingTier = keyof typeof PricingTier;

export const BrandStatus = e('PENDING', 'ACTIVE', 'SUSPENDED');
export type BrandStatus = keyof typeof BrandStatus;

export const SettlementCycle = e('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');
export type SettlementCycle = keyof typeof SettlementCycle;

export const PayoutMethod = e('BANK_TRANSFER', 'INSTAPAY', 'VODAFONE_CASH', 'CASH', 'FAWRY', 'OTHER');
export type PayoutMethod = keyof typeof PayoutMethod;

export const ServiceLevel = e('STANDARD', 'SAME_DAY', 'EXPRESS', 'SCHEDULED');
export type ServiceLevel = keyof typeof ServiceLevel;

export const OrderType = e('DELIVERY', 'EXCHANGE', 'RETURN', 'CASH_COLLECTION');
export type OrderType = keyof typeof OrderType;

export const OrderStatus = e(
  'CREATED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'OUT_FOR_DELIVERY',
  'DELIVERED', 'FAILED_ATTEMPT', 'RESCHEDULED', 'ON_HOLD', 'RETURN_PENDING', 'RETURN_OUT',
  'RETURNED', 'CANCELLED', 'LOST', 'DAMAGED',
);
export type OrderStatus = keyof typeof OrderStatus;

export const PaymentMethod = e('COD', 'PREPAID');
export type PaymentMethod = keyof typeof PaymentMethod;

export const FeesPayer = e('BRAND', 'RECIPIENT');
export type FeesPayer = keyof typeof FeesPayer;

export const OrderSource = e('PORTAL', 'API', 'BULK_UPLOAD', 'SHOPIFY', 'WOOCOMMERCE', 'ADMIN');
export type OrderSource = keyof typeof OrderSource;

export const FailureReason = e(
  'CUSTOMER_UNREACHABLE', 'CUSTOMER_REFUSED', 'CUSTOMER_RESCHEDULED', 'WRONG_ADDRESS',
  'INCOMPLETE_ADDRESS', 'NO_CASH', 'CUSTOMER_NOT_PRESENT', 'OUT_OF_ZONE', 'PACKAGE_DAMAGED',
  'SECURITY_ACCESS', 'OTHER',
);
export type FailureReason = keyof typeof FailureReason;

export const PickupStatus = e('REQUESTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');
export type PickupStatus = keyof typeof PickupStatus;

export const RunsheetStatus = e('DRAFT', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED');
export type RunsheetStatus = keyof typeof RunsheetStatus;

export const EmploymentType = e('FREELANCE', 'SHIFT', 'FULL_TIME');
export type EmploymentType = keyof typeof EmploymentType;

export const CourierStatus = e('PENDING_ONBOARDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED');
export type CourierStatus = keyof typeof CourierStatus;

export const CourierAvailability = e('OFFLINE', 'ONLINE', 'ON_BREAK', 'BUSY');
export type CourierAvailability = keyof typeof CourierAvailability;

export const VehicleType = e('MOTORCYCLE', 'SCOOTER', 'BICYCLE', 'CAR', 'VAN', 'ON_FOOT');
export type VehicleType = keyof typeof VehicleType;

export const DocumentType = e(
  'NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'DRIVING_LICENSE', 'VEHICLE_LICENSE',
  'CRIMINAL_RECORD', 'PERSONAL_PHOTO', 'CONTRACT', 'OTHER',
);
export type DocumentType = keyof typeof DocumentType;

export const DocumentStatus = e('PENDING', 'APPROVED', 'REJECTED');
export type DocumentStatus = keyof typeof DocumentStatus;

export const ShiftStatus = e('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'CANCELLED');
export type ShiftStatus = keyof typeof ShiftStatus;

export const HandoverMethod = e('CASH_AT_HUB', 'INSTAPAY', 'VODAFONE_CASH', 'BANK_TRANSFER', 'FAWRY');
export type HandoverMethod = keyof typeof HandoverMethod;

export const HandoverStatus = e('PENDING', 'CONFIRMED', 'REJECTED');
export type HandoverStatus = keyof typeof HandoverStatus;

export const LedgerAccountType = e('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
export type LedgerAccountType = keyof typeof LedgerAccountType;

export const LedgerTxKind = e(
  'COD_COLLECTED', 'ORDER_FEES', 'FEE_REVERSAL', 'COURIER_EARNING', 'CASH_HANDOVER', 'CASH_VARIANCE',
  'BRAND_PAYOUT', 'COURIER_PAYOUT', 'COURIER_ADJUSTMENT', 'MANUAL_ADJUSTMENT',
);
export type LedgerTxKind = keyof typeof LedgerTxKind;

export const SettlementStatus = e('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');
export type SettlementStatus = keyof typeof SettlementStatus;

export const PayoutStatus = e('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');
export type PayoutStatus = keyof typeof PayoutStatus;

export const AdjustmentType = e('BONUS', 'PENALTY', 'CASH_SHORTAGE', 'ADVANCE', 'REIMBURSEMENT');
export type AdjustmentType = keyof typeof AdjustmentType;

export const DeliveryStatus = e('PENDING', 'SUCCESS', 'FAILED', 'DEAD');
export type DeliveryStatus = keyof typeof DeliveryStatus;

export const IntegrationProvider = e('SHOPIFY', 'WOOCOMMERCE', 'ZID', 'SALLA', 'EASYORDERS', 'CUSTOM');
export type IntegrationProvider = keyof typeof IntegrationProvider;

export const IntegrationStatus = e('ACTIVE', 'PAUSED', 'ERROR');
export type IntegrationStatus = keyof typeof IntegrationStatus;

export const NotificationChannel = e('SMS', 'WHATSAPP', 'EMAIL', 'PUSH', 'IN_APP');
export type NotificationChannel = keyof typeof NotificationChannel;

export const NotificationStatus = e('QUEUED', 'SENT', 'FAILED', 'READ');
export type NotificationStatus = keyof typeof NotificationStatus;

export const TicketCategory = e(
  'DELAY', 'DAMAGED', 'LOST', 'COD_ISSUE', 'ADDRESS_CHANGE', 'RESCHEDULE', 'COMPLAINT',
  'COURIER_BEHAVIOR', 'INQUIRY', 'OTHER',
);
export type TicketCategory = keyof typeof TicketCategory;

export const TicketPriority = e('LOW', 'MEDIUM', 'HIGH', 'URGENT');
export type TicketPriority = keyof typeof TicketPriority;

export const TicketStatus = e('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');
export type TicketStatus = keyof typeof TicketStatus;
