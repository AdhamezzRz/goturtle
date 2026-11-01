import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { CustomersModule } from '../customers/customers.module';
import { FinanceModule } from '../finance/finance.module';
import { AddressBookModule } from '../address-book/address-book.module';
import { HoldsService } from './holds.service';
import { ConfirmationService } from './confirmation.service';
import { AttemptsService } from './attempts.service';
import { InboundService } from './inbound.service';
import { CustomerActionsService } from './customer-actions.service';
import { IntegrityReportsService } from './integrity-reports.service';
import { IntegrityController } from './integrity.controller';
import { CustomerIntegrityController, HeroCallsController, InboundController } from './public.controllers';

/**
 * Delivery integrity: RTO shield (customer confirmation before dispatch,
 * holds, prepayment rule, network blocklist), attempt integrity (logged
 * calls, geofence & call rules on failed attempts, customer verification and
 * disputes) and inbound WhatsApp / SMS replies.
 */
@Module({
  imports: [OrdersModule, CustomersModule, FinanceModule, AddressBookModule],
  controllers: [IntegrityController, CustomerIntegrityController, HeroCallsController, InboundController],
  providers: [HoldsService, ConfirmationService, AttemptsService, InboundService, CustomerActionsService, IntegrityReportsService],
  exports: [HoldsService, ConfirmationService, AttemptsService],
})
export class DeliveryIntegrityModule {}
