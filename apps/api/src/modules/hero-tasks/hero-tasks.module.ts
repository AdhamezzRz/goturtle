import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PickupsModule } from '../pickups/pickups.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { HeroTasksController } from './hero-tasks.controller';
import { HeroTasksService } from './hero-tasks.service';

/** Hero self-service task flow (hero/tasks/...). */
@Module({
  imports: [OrdersModule, PickupsModule, DispatchModule],
  controllers: [HeroTasksController],
  providers: [HeroTasksService],
  exports: [HeroTasksService],
})
export class HeroTasksModule {}
