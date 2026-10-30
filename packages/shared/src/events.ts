/**
 * Public webhook events (what brands can subscribe to) and internal domain
 * event names (NestJS EventEmitter). Payloads for webhooks are documented in
 * docs/INTEGRATIONS.md.
 */
export const WEBHOOK_EVENTS = [
  'order.created',
  'order.status_changed',
  'order.picked_up',
  'order.out_for_delivery',
  'order.delivered',
  'order.failed_attempt',
  'order.returned',
  'order.cancelled',
  'pickup.completed',
  'settlement.paid',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Internal domain events emitted inside the API. */
export const DomainEvents = {
  OrderCreated: 'order.created',
  OrderStatusChanged: 'order.status_changed',
  PickupCompleted: 'pickup.completed',
  RunsheetDispatched: 'runsheet.dispatched',
  CourierLocation: 'courier.location',
  CourierAvailability: 'courier.availability',
  CashHandoverConfirmed: 'cash.handover_confirmed',
  SettlementPaid: 'settlement.paid',
  TicketCreated: 'ticket.created',
  TicketUpdated: 'ticket.updated',
} as const;
export type DomainEventName = (typeof DomainEvents)[keyof typeof DomainEvents];

/** Socket.IO rooms used by the realtime gateway. */
export const Rooms = {
  ops: 'ops', // all staff dashboards
  brand: (brandId: string) => `brand:${brandId}`,
  courier: (courierId: string) => `courier:${courierId}`,
  order: (trackingNumber: string) => `order:${trackingNumber}`,
} as const;

/** Socket.IO events pushed to clients. */
export const SocketEvents = {
  OrderUpdated: 'order:updated',
  CourierMoved: 'courier:moved',
  CourierStatus: 'courier:status',
  TaskAssigned: 'task:assigned',
  Notification: 'notification',
  Stats: 'stats',
} as const;
