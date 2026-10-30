import { OrderStatus, ActorType } from './enums';

type S = OrderStatus;

/**
 * The order lifecycle. Every status change in the system MUST go through
 * `canTransition` — the API refuses anything not listed here.
 *
 *   CREATED ─► PICKUP_ASSIGNED ─► PICKED_UP ─► RECEIVED_AT_HUB ─► ASSIGNED ─► OUT_FOR_DELIVERY ─► DELIVERED
 *                                     │  (direct, no hub) ───────────────────────►│
 *                                                                                  ├─► FAILED_ATTEMPT ─► RESCHEDULED ─► …
 *                                                                                  └─► RETURN_PENDING ─► RETURN_OUT ─► RETURNED
 */
export const ORDER_TRANSITIONS: Readonly<Record<S, readonly S[]>> = {
  CREATED: ['PICKUP_ASSIGNED', 'PICKED_UP', 'RECEIVED_AT_HUB', 'ON_HOLD', 'CANCELLED'],
  PICKUP_ASSIGNED: ['PICKED_UP', 'CREATED', 'ON_HOLD', 'CANCELLED'],
  PICKED_UP: ['RECEIVED_AT_HUB', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'LOST', 'DAMAGED'],
  RECEIVED_AT_HUB: ['ASSIGNED', 'OUT_FOR_DELIVERY', 'ON_HOLD', 'RETURN_PENDING', 'LOST', 'DAMAGED'],
  ASSIGNED: ['OUT_FOR_DELIVERY', 'RECEIVED_AT_HUB', 'ASSIGNED', 'ON_HOLD'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED_ATTEMPT', 'RECEIVED_AT_HUB', 'LOST', 'DAMAGED'],
  FAILED_ATTEMPT: ['RESCHEDULED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'RECEIVED_AT_HUB', 'RETURN_PENDING', 'ON_HOLD'],
  RESCHEDULED: ['ASSIGNED', 'OUT_FOR_DELIVERY', 'RECEIVED_AT_HUB', 'RETURN_PENDING', 'ON_HOLD'],
  ON_HOLD: ['CREATED', 'RECEIVED_AT_HUB', 'ASSIGNED', 'RETURN_PENDING', 'CANCELLED'],
  RETURN_PENDING: ['RETURN_OUT', 'RETURNED', 'RECEIVED_AT_HUB'],
  RETURN_OUT: ['RETURNED', 'RETURN_PENDING'],
  DAMAGED: ['RETURN_PENDING', 'RETURNED'],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
  LOST: [],
};

export const TERMINAL_STATUSES: readonly S[] = ['DELIVERED', 'RETURNED', 'CANCELLED', 'LOST'];

/** Statuses during which the package is physically with a hero. */
export const WITH_COURIER_STATUSES: readonly S[] = ['PICKED_UP', 'OUT_FOR_DELIVERY', 'RETURN_OUT'];

/** Statuses a brand can still cancel without a return fee. */
export const BRAND_CANCELLABLE_STATUSES: readonly S[] = ['CREATED', 'PICKUP_ASSIGNED', 'ON_HOLD'];

/** Statuses that count as "active" work in dashboards. */
export const ACTIVE_STATUSES: readonly S[] = (Object.keys(ORDER_TRANSITIONS) as S[]).filter(
  (s) => !TERMINAL_STATUSES.includes(s),
);

export function canTransition(from: S, to: S): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: S): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Which actor types may push an order into a given status. Staff (ops) can do
 * anything the state machine allows; the others are restricted to their role.
 */
export const STATUS_ACTORS: Readonly<Record<S, readonly ActorType[]>> = {
  CREATED: ['STAFF', 'SYSTEM'],
  PICKUP_ASSIGNED: ['STAFF', 'SYSTEM'],
  PICKED_UP: ['STAFF', 'COURIER'],
  RECEIVED_AT_HUB: ['STAFF', 'SYSTEM'],
  ASSIGNED: ['STAFF', 'SYSTEM'],
  OUT_FOR_DELIVERY: ['STAFF', 'COURIER', 'SYSTEM'],
  DELIVERED: ['STAFF', 'COURIER'],
  FAILED_ATTEMPT: ['STAFF', 'COURIER'],
  RESCHEDULED: ['STAFF', 'CUSTOMER', 'BRAND', 'SYSTEM', 'COURIER'],
  ON_HOLD: ['STAFF', 'BRAND', 'API'],
  RETURN_PENDING: ['STAFF', 'SYSTEM', 'BRAND', 'API'],
  RETURN_OUT: ['STAFF', 'COURIER', 'SYSTEM'],
  RETURNED: ['STAFF', 'COURIER'],
  CANCELLED: ['STAFF', 'BRAND', 'API', 'INTEGRATION'],
  LOST: ['STAFF'],
  DAMAGED: ['STAFF', 'COURIER'],
};

export function actorCanSetStatus(actor: ActorType, to: S): boolean {
  return STATUS_ACTORS[to].includes(actor);
}

export const ORDER_STATUS_LABELS: Readonly<Record<S, { en: string; ar: string }>> = {
  CREATED: { en: 'Created', ar: 'تم الإنشاء' },
  PICKUP_ASSIGNED: { en: 'Pickup assigned', ar: 'تم تعيين مندوب الاستلام' },
  PICKED_UP: { en: 'Picked up', ar: 'تم الاستلام من التاجر' },
  RECEIVED_AT_HUB: { en: 'At hub', ar: 'في المخزن' },
  ASSIGNED: { en: 'Assigned to hero', ar: 'تم التعيين لمندوب' },
  OUT_FOR_DELIVERY: { en: 'Out for delivery', ar: 'خرج للتوصيل' },
  DELIVERED: { en: 'Delivered', ar: 'تم التوصيل' },
  FAILED_ATTEMPT: { en: 'Delivery attempt failed', ar: 'محاولة توصيل فاشلة' },
  RESCHEDULED: { en: 'Rescheduled', ar: 'تم تأجيل الموعد' },
  ON_HOLD: { en: 'On hold', ar: 'معلّق' },
  RETURN_PENDING: { en: 'Return pending', ar: 'في انتظار الإرجاع' },
  RETURN_OUT: { en: 'Returning to brand', ar: 'جاري الإرجاع للتاجر' },
  RETURNED: { en: 'Returned', ar: 'تم الإرجاع' },
  CANCELLED: { en: 'Cancelled', ar: 'ملغي' },
  LOST: { en: 'Lost', ar: 'مفقود' },
  DAMAGED: { en: 'Damaged', ar: 'تالف' },
};

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

export const ORDER_STATUS_TONE: Readonly<Record<S, StatusTone>> = {
  CREATED: 'neutral',
  PICKUP_ASSIGNED: 'info',
  PICKED_UP: 'info',
  RECEIVED_AT_HUB: 'info',
  ASSIGNED: 'progress',
  OUT_FOR_DELIVERY: 'progress',
  DELIVERED: 'success',
  FAILED_ATTEMPT: 'warning',
  RESCHEDULED: 'warning',
  ON_HOLD: 'warning',
  RETURN_PENDING: 'danger',
  RETURN_OUT: 'danger',
  RETURNED: 'neutral',
  CANCELLED: 'neutral',
  LOST: 'danger',
  DAMAGED: 'danger',
};

/** The 5-step progress bar shown to customers on the tracking page. */
export const CUSTOMER_STEPS = ['ORDER_PLACED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
export type CustomerStep = (typeof CUSTOMER_STEPS)[number];

export const CUSTOMER_STEP_LABELS: Readonly<Record<CustomerStep, { en: string; ar: string }>> = {
  ORDER_PLACED: { en: 'Order placed', ar: 'تم تسجيل الطلب' },
  PICKED_UP: { en: 'Picked up', ar: 'تم الاستلام' },
  IN_TRANSIT: { en: 'In transit', ar: 'في الطريق' },
  OUT_FOR_DELIVERY: { en: 'Out for delivery', ar: 'خرج للتوصيل' },
  DELIVERED: { en: 'Delivered', ar: 'تم التوصيل' },
};

/** Index into CUSTOMER_STEPS for the current status (-1 for cancelled). */
export function customerStepIndex(status: S): number {
  switch (status) {
    case 'CREATED':
    case 'PICKUP_ASSIGNED':
    case 'ON_HOLD':
      return 0;
    case 'PICKED_UP':
      return 1;
    case 'RECEIVED_AT_HUB':
    case 'ASSIGNED':
    case 'FAILED_ATTEMPT':
    case 'RESCHEDULED':
      return 2;
    case 'OUT_FOR_DELIVERY':
      return 3;
    case 'DELIVERED':
      return 4;
    default:
      return -1; // returns / cancelled / lost / damaged are shown as an exception banner
  }
}
