import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

/** Hero cash custody, handovers (declare → confirm/reject), shortages and the hub cash desk. */
@Module({
  imports: [FinanceModule],
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
