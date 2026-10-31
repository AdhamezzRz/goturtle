import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PricingModule } from '../pricing/pricing.module';
import { PaymentsModule } from '../payments/payments.module';
import { TicketsModule } from '../tickets/tickets.module';
import { CollectionsService } from './collections.service';
import { AdvancesService } from './advances.service';
import { WeightService } from './weight.service';
import {
  AdvancesController, BrandAdvancesController, CollectionsController, HeroCollectionsController, QualityController,
} from './money-programs.controller';

/**
 * Money programs & quality (v1.1):
 *  - digital payment at the door (workflow guard + effect, finance confirmation queue),
 *  - brand early payouts & COD advances (recovered at settlement generation, see finance/settlement-netting),
 *  - hub weighing with re-pricing and weight disputes.
 */
@Module({
  imports: [OrdersModule, PricingModule, PaymentsModule, TicketsModule],
  controllers: [CollectionsController, HeroCollectionsController, BrandAdvancesController, AdvancesController, QualityController],
  providers: [CollectionsService, AdvancesService, WeightService],
  exports: [CollectionsService, AdvancesService, WeightService],
})
export class MoneyProgramsModule {}
