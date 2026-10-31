import { Module } from '@nestjs/common';
import { CouriersModule } from '../couriers/couriers.module';
import { CashModule } from '../cash/cash.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { FinanceModule } from '../finance/finance.module';
import { GamificationModule } from '../gamification/gamification.module';
import { HeroController } from './hero.controller';
import { HeroService } from './hero.service';

/** The hero app API (`/hero/me/...`): profile, availability, GPS, dashboard, money, shifts, documents, achievements. */
@Module({
  imports: [CouriersModule, CashModule, ShiftsModule, FinanceModule, GamificationModule],
  controllers: [HeroController],
  providers: [HeroService],
  exports: [HeroService],
})
export class HeroModule {}
