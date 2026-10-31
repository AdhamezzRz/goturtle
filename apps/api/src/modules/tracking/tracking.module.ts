import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

/** Public tracking page and customer self-service (track/...). */
@Module({
  imports: [OrdersModule],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
