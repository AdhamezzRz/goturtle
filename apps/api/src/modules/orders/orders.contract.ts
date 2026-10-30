import type { FeesPayer, OrderSource, OrderType, PaymentMethod, ServiceLevel } from '@goturtle/shared';
import type { ActorContext } from '../../common/actor';

/**
 * Contract between the Orders module and other modules that create orders
 * (e-commerce integrations, bulk upload, seeds). OrdersModule provides
 * ORDER_INTAKE and exports it.
 */
export interface CreateOrderInput {
  brandId: string;
  brandReference?: string | null;
  type?: OrderType;
  serviceLevel?: ServiceLevel;
  source: OrderSource;
  recipient: { name: string; phone: string; altPhone?: string | null };
  address: {
    line: string;
    building?: string | null;
    floor?: string | null;
    apartment?: string | null;
    landmark?: string | null;
    /** Optional; detected from the address text / coordinates when missing. */
    zoneId?: string | null;
    lat?: number | null;
    lng?: number | null;
  };
  package?: {
    description?: string | null;
    itemsCount?: number;
    weightGrams?: number;
    isFragile?: boolean;
    allowOpening?: boolean;
    declaredValueCents?: number;
  };
  paymentMethod?: PaymentMethod;
  codAmountCents: number;
  feesPaidBy?: FeesPayer;
  pickupLocationId?: string | null;
  scheduledDate?: string | null; // YYYY-MM-DD
  notes?: string | null;
  deliveryOtpRequired?: boolean;
  externalId?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
}

export interface CreatedOrderRef {
  id: string;
  trackingNumber: string;
  status: string;
  totalFeesCents: number;
  collectCents: number;
  riskScore: number;
}

export interface OrderIntake {
  create(input: CreateOrderInput, actor: ActorContext): Promise<CreatedOrderRef>;
  /** Cancels an order that has not been picked up yet (e.g. Shopify order cancelled). */
  cancelByExternalId(brandId: string, externalId: string, actor: ActorContext, reason?: string): Promise<boolean>;
}

export const ORDER_INTAKE = Symbol('ORDER_INTAKE');
