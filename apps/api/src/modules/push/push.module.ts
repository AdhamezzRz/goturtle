import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushListener } from './push.listener';
import { PUSH_SENDER, PushService, WebPushSender } from './push.service';

/** Web Push (VAPID) for heroes, brand owners and staff. Disabled when VAPID keys are not set. */
@Module({
  controllers: [PushController],
  providers: [PushService, PushListener, { provide: PUSH_SENDER, useClass: WebPushSender }],
  exports: [PushService],
})
export class PushModule {}
