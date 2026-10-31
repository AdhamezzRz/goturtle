import { Module } from '@nestjs/common';
import { NetworkModule } from '../network/network.module';
import { PricingModule } from '../pricing/pricing.module';
import { OrdersModule } from '../orders/orders.module';
import { OrderLinksController, PublicOrderLinksController } from './order-links.controller';
import { OrderLinksService } from './order-links.service';

/** Shareable order forms for social sellers (/o/:code) → ORDER_INTAKE. */
@Module({
  imports: [NetworkModule, PricingModule, OrdersModule],
  controllers: [PublicOrderLinksController, OrderLinksController],
  providers: [OrderLinksService],
  exports: [OrderLinksService],
})
export class OrderLinksModule {}
