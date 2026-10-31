import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { ProviderRegistry } from './providers/provider-registry';

/** Global so any module can send messages / in-app notifications. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListener, ProviderRegistry],
  exports: [NotificationsService, ProviderRegistry],
})
export class NotificationsModule {}
