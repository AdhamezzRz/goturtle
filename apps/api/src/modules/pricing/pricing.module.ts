import { Module } from '@nestjs/common';
import { NetworkModule } from '../network/network.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

/** Rate cards (plans + rules) and fee quotes. PricingService.rateCardForBrand() is used by orders. */
@Module({
  imports: [NetworkModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
