import { Module } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { CouriersController } from './couriers.controller';
import { CouriersService } from './couriers.service';
import { CourierDocumentsService } from './courier-documents.service';
import { CourierLocationsService } from './courier-locations.service';

/** Hero onboarding, profiles, KPIs, documents, live map and breadcrumbs (staff side). */
@Module({
  imports: [GamificationModule],
  controllers: [CouriersController],
  providers: [CouriersService, CourierDocumentsService, CourierLocationsService],
  exports: [CouriersService, CourierDocumentsService, CourierLocationsService],
})
export class CouriersModule {}
