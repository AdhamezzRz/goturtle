import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvents, type CashHandoverConfirmedEvent, type OrderStatusChangedEvent, type PickupCompletedEvent } from '../../core/events';
import { GamificationService } from './gamification.service';

/** Domain event → XP. Listeners never throw (errors are logged). */
@Injectable()
export class GamificationListener {
  constructor(private readonly gamification: GamificationService) {}

  @OnEvent(DomainEvents.OrderStatusChanged, { async: true })
  async onOrderStatusChanged(e: OrderStatusChangedEvent) {
    try {
      if (e.to === 'DELIVERED') await this.gamification.onOrderDelivered(e.orderId);
      else if (e.to === 'FAILED_ATTEMPT') await this.gamification.onFailedAttempt(e.orderId, e.courierId);
    } catch (err) {
      this.gamification.logError(`XP for order ${e.orderId} (${e.to})`, err);
    }
  }

  @OnEvent(DomainEvents.PickupCompleted, { async: true })
  async onPickupCompleted(e: PickupCompletedEvent) {
    try {
      await this.gamification.onPickupCompleted(e.pickupId);
    } catch (err) {
      this.gamification.logError(`XP for pickup ${e.pickupId}`, err);
    }
  }

  @OnEvent(DomainEvents.CashHandoverConfirmed, { async: true })
  async onHandoverConfirmed(e: CashHandoverConfirmedEvent) {
    try {
      await this.gamification.onHandoverConfirmed(e.handoverId);
    } catch (err) {
      this.gamification.logError(`XP for handover ${e.handoverId}`, err);
    }
  }
}
