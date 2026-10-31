import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PickupsController } from './pickups.controller';
import { PickupsService } from './pickups.service';

/** First-mile pickups (brand requests, ops assignment; the hero flow is exposed by hero-tasks). */
@Module({
  imports: [OrdersModule],
  controllers: [PickupsController],
  providers: [PickupsService],
  exports: [PickupsService],
})
export class PickupsModule {}
