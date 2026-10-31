import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

/** Partner carriers (virtual heroes) for destinations outside our own network. */
@Module({
  imports: [OrdersModule],
  controllers: [PartnersController],
  providers: [PartnersService],
  exports: [PartnersService],
})
export class PartnersModule {}
