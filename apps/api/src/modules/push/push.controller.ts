import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Access, CurrentPrincipal, Public, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { DomainError } from '../../common/errors';
import { validateWebhookUrl } from '../webhooks/url-guard';
import { userIdOf } from '../users/access';
import { PushService } from './push.service';
import { PushStatusQuery, SubscribeDto, UnsubscribeDto } from './push.dto';

const ANY_USER = { actors: ['staff', 'brand', 'courier'] } as const;

@ApiTags('Push')
@Controller({ path: 'push', version: '1' })
export class PushController {
  constructor(private readonly push: PushService) {}

  @Public()
  @Get('public-key')
  @ApiOperation({ summary: 'VAPID application server key (enabled=false when push is not configured)' })
  publicKey() {
    return this.push.publicKey();
  }

  @ApiBearerAuth()
  @Access({ actors: [...ANY_USER.actors] })
  @Get('status')
  @ApiOperation({ summary: 'Whether push is enabled and how many devices of mine are subscribed' })
  status(@CurrentPrincipal() p: Principal, @Query() q: PushStatusQuery) {
    return this.push.status(userIdOf(p), q.endpoint);
  }

  @ApiBearerAuth()
  @Access({ actors: [...ANY_USER.actors] })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('subscribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Register this browser for push (upsert by endpoint)' })
  async subscribe(@CurrentPrincipal() p: Principal, @Body() dto: SubscribeDto, @RequestMeta() meta: RequestMetaInfo) {
    // The server POSTs to this URL: refuse private / loopback hosts in production.
    await validateWebhookUrl(dto.endpoint).catch(() => {
      throw new DomainError('INVALID_PUSH_ENDPOINT', 'This push endpoint is not allowed', HttpStatus.BAD_REQUEST);
    });
    return this.push.subscribe(userIdOf(p), dto, meta.userAgent);
  }

  @ApiBearerAuth()
  @Access({ actors: [...ANY_USER.actors] })
  @Delete('subscribe')
  @ApiOperation({ summary: 'Unregister this browser' })
  unsubscribe(@CurrentPrincipal() p: Principal, @Body() dto: UnsubscribeDto) {
    return this.push.unsubscribe(userIdOf(p), dto.endpoint);
  }

  @ApiBearerAuth()
  @Access({ actors: [...ANY_USER.actors] })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a test notification to all my devices' })
  test(@CurrentPrincipal() p: Principal) {
    return this.push.sendTest(userIdOf(p));
  }
}
