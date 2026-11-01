import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

/** Brand claims for lost / damaged / missing / wrong / late parcels, paid through the ledger. */
@Module({
  imports: [FinanceModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
