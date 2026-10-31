import { Module } from '@nestjs/common';
import { GamificationListener } from './gamification.listener';
import { GamificationService } from './gamification.service';

/**
 * Hero XP, levels, badges, streaks and leaderboards. XP is awarded from
 * domain events (order delivered / failed attempt, pickup completed, cash
 * handover confirmed) and by the daily `gamification.streaks` job.
 * Endpoints live in the couriers (staff leaderboard) and hero (self-service) modules.
 */
@Module({
  providers: [GamificationService, GamificationListener],
  exports: [GamificationService],
})
export class GamificationModule {}
