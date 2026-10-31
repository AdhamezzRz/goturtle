import { Module } from '@nestjs/common';
import { IntegrationsController, IntegrationsInboundController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationsListener } from './integrations.listener';

@Module({
  // Inbound first: /integrations/shopify/… must not be captured by /integrations/:id.
  controllers: [IntegrationsInboundController, IntegrationsController],
  providers: [IntegrationsService, IntegrationsListener],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
