import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvents, type OrderStatusChangedEvent } from '../../core/events';
import { IntegrationsService } from './integrations.service';

/** Pushes delivery back to the store (Shopify fulfillment with the tracking link). */
@Injectable()
export class IntegrationsListener {
  private readonly log = new Logger('IntegrationsListener');

  constructor(private readonly integrations: IntegrationsService) {}

  @OnEvent(DomainEvents.OrderStatusChanged, { async: true })
  async onStatusChanged(e: OrderStatusChangedEvent) {
    if (e.to !== 'DELIVERED') return;
    try {
      await this.integrations.syncShopifyFulfillment(e.orderId);
    } catch (err) {
      this.log.error(`fulfillment sync for ${e.trackingNumber} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
