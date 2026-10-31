import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';
import { WebhooksListener } from './webhooks.listener';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcher, WebhooksListener],
  exports: [WebhookDispatcher],
})
export class WebhooksModule {}
