import { Module } from '@nestjs/common';
import { NetworkModule } from '../network/network.module';
import { PricingModule } from '../pricing/pricing.module';
import { CustomersModule } from '../customers/customers.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersBulkService } from './orders-bulk.service';
import { OrderFactoryService } from './order-factory.service';
import { OrderWorkflowService } from './order-workflow.service';
import { ORDER_INTAKE } from './orders.contract';

/**
 * Orders: intake, the status workflow, bulk upload, labels and export.
 * Exports ORDER_INTAKE (integrations / bulk / seeds), OrdersService and
 * OrderWorkflowService (the only place statuses change).
 */
@Module({
  imports: [NetworkModule, PricingModule, CustomersModule],
  controllers: [OrdersController],
  providers: [
    OrderFactoryService,
    OrderWorkflowService,
    OrdersService,
    OrdersBulkService,
    { provide: ORDER_INTAKE, useExisting: OrdersService },
  ],
  exports: [ORDER_INTAKE, OrdersService, OrderWorkflowService, OrderFactoryService],
})
export class OrdersModule {}
