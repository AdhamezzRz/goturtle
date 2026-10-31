import { Module } from '@nestjs/common';
import { NetworkModule } from '../network/network.module';
import { OrdersModule } from '../orders/orders.module';
import { DispatchController, RunsheetsController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { AssignmentService } from './assignment.service';
import { RunsheetsService } from './runsheets.service';

/** Hub scans, hero auto-assignment, runsheets, the live control tower and the SLA job. */
@Module({
  imports: [NetworkModule, OrdersModule],
  controllers: [DispatchController, RunsheetsController],
  providers: [DispatchService, AssignmentService, RunsheetsService],
  exports: [DispatchService, AssignmentService, RunsheetsService],
})
export class DispatchModule {}
