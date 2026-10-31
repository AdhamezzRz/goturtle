import { Module } from '@nestjs/common';
import {
  AdjustmentsController, BrandFinanceController, FinanceReportsController, PayoutsController, SettlementsController,
} from './finance.controller';
import { SettlementsService } from './settlements.service';
import { PayrollService } from './payroll.service';
import { AdjustmentsService } from './adjustments.service';
import { FinanceReportsService } from './finance-reports.service';
import { BrandFinanceService } from './brand-finance.service';
import { HeroLedgerService } from './hero-ledger.service';
import { SettlementNettingService } from './settlement-netting.service';

/**
 * Brand settlements (+ hourly `finance.settlements` job), hero payroll,
 * hero adjustments, the brand finance portal and ledger reports.
 */
@Module({
  controllers: [SettlementsController, PayoutsController, AdjustmentsController, BrandFinanceController, FinanceReportsController],
  providers: [SettlementsService, PayrollService, AdjustmentsService, FinanceReportsService, BrandFinanceService, HeroLedgerService, SettlementNettingService],
  exports: [SettlementsService, PayrollService, AdjustmentsService, FinanceReportsService, HeroLedgerService, SettlementNettingService],
})
export class FinanceModule {}
