import type { OrderStatus, OrderType, PaymentMethod, StatusTone } from '@goturtle/shared';

type Bilingual = { en: string; ar: string };

/** GET /track/:trackingNumber — public, with `details`/`can` once the phone is verified. */
export interface TrackingData {
  trackingNumber: string;
  status: OrderStatus;
  statusLabel: Bilingual;
  tone: StatusTone;
  step: number;
  steps: Array<{ key: string; label: Bilingual; done: boolean }>;
  exception: { status: OrderStatus; label: Bilingual } | null;
  type: OrderType;
  brand: { name: string; logoUrl: string | null };
  destination: { zone: Bilingual; city: Bilingual };
  promisedBy: string | null;
  eta: string | null;
  scheduledDate: string | null;
  deliveredAt: string | null;
  attempts: number;
  maxAttempts: number;
  paymentMethod: PaymentMethod;
  recipient: { firstName: string; phone: string };
  hero: { firstName: string; vehicleType: string; rating: number } | null;
  heroLocation: { lat: number; lng: number; lastSeenAt: string | null } | null;
  timeline: Array<{ status: OrderStatus; label: Bilingual; isStatusChange: boolean; reason: string | null; note: string | null; at: string }>;
  verified: boolean;
  details?: {
    recipientName: string;
    phone: string;
    address: { line: string; building: string | null; floor: string | null; apartment: string | null; landmark: string | null; lat: number | null; lng: number | null };
    amountToPayCents: number;
    itemsCount: number;
    allowOpening: boolean;
    deliveryOtpRequired: boolean;
    rating: number | null;
  };
  can?: { reschedule: boolean; editAddress: boolean; rate: boolean };
}

/** GET /track/me/orders */
export interface MyOrders {
  phone: string;
  orders: Array<{
    trackingNumber: string;
    status: OrderStatus;
    type: OrderType;
    createdAt: string;
    promisedBy: string | null;
    deliveredAt: string | null;
    collectCents: number;
    paymentMethod: PaymentMethod;
    rating: number | null;
    statusLabel: Bilingual;
    step: number;
    brand: { name: string; logoUrl: string | null };
    can: { reschedule: boolean; editAddress: boolean; rate: boolean };
  }>;
}
