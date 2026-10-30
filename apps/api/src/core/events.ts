import type { ActorType, OrderStatus, OtpPurpose } from '@goturtle/shared';
import { DomainEvents } from '@goturtle/shared';

/**
 * Internal domain events (NestJS EventEmitter2). Emit AFTER the database
 * transaction commits so listeners (webhooks, notifications, gamification)
 * never act on rolled-back data.
 *
 *   this.events.emit(DomainEvents.OrderStatusChanged, payload satisfies OrderStatusChangedEvent)
 *   @OnEvent(DomainEvents.OrderStatusChanged, { async: true }) handle(e: OrderStatusChangedEvent) {}
 */
export { DomainEvents };

export const CoreEvents = {
  OtpRequested: 'otp.requested',
  UserInvited: 'user.invited',
} as const;

export interface OrderCreatedEvent {
  orderId: string;
  trackingNumber: string;
  brandId: string;
  source: string;
}

export interface OrderStatusChangedEvent {
  orderId: string;
  trackingNumber: string;
  brandId: string;
  courierId: string | null;
  from: OrderStatus | null;
  to: OrderStatus;
  reason?: string | null;
  note?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  at: Date;
}

export interface PickupCompletedEvent {
  pickupId: string;
  brandId: string;
  courierId: string | null;
  pickedCount: number;
}

export interface CourierLocationEvent {
  courierId: string;
  lat: number;
  lng: number;
  at: Date;
}

export interface CashHandoverConfirmedEvent {
  handoverId: string;
  courierId: string;
  receivedCents: number;
  varianceCents: number;
}

export interface SettlementPaidEvent {
  settlementId: string;
  brandId: string;
  netPayableCents: number;
}

export interface TicketEvent {
  ticketId: string;
  code: string;
  brandId: string | null;
  orderId: string | null;
}

export interface OtpRequestedEvent {
  phone: string;
  code: string;
  purpose: OtpPurpose;
  orderId?: string | null;
  locale?: 'ar' | 'en';
}

export interface UserInvitedEvent {
  userId: string;
  phone: string;
  email: string | null;
  name: string;
  temporaryPassword: string;
}
