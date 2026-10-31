import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Access, CurrentPrincipal, Public } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { TrackingService } from './tracking.service';
import { RateDto, RescheduleDto, UpdateAddressDto } from './tracking.dto';

const CUSTOMER_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Tracking')
@Controller({ path: 'track', version: '1' })
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @ApiBearerAuth()
  @Access({ actors: ['customer'] })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('me/orders')
  @ApiOperation({ summary: 'Customer: all shipments for the verified phone' })
  myOrders(@CurrentPrincipal() p: Principal) {
    return this.tracking.myOrders(p);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':trackingNumber')
  @ApiOperation({ summary: 'Public tracking (a customer token for the recipient phone unlocks details and live hero position)' })
  track(@Param('trackingNumber') tn: string, @CurrentPrincipal() p?: Principal) {
    return this.tracking.track(tn, p);
  }

  @ApiBearerAuth()
  @Access({ actors: ['customer'] })
  @Throttle(CUSTOMER_LIMIT)
  @Post(':trackingNumber/reschedule')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer: choose another delivery day (before out-for-delivery or after a failed attempt)' })
  reschedule(@Param('trackingNumber') tn: string, @Body() dto: RescheduleDto, @CurrentPrincipal() p: Principal) {
    return this.tracking.reschedule(tn, dto, p);
  }

  @ApiBearerAuth()
  @Access({ actors: ['customer'] })
  @Throttle(CUSTOMER_LIMIT)
  @Patch(':trackingNumber/address')
  @ApiOperation({ summary: 'Customer: landmark / building / floor / apartment / notes / map pin' })
  address(@Param('trackingNumber') tn: string, @Body() dto: UpdateAddressDto, @CurrentPrincipal() p: Principal) {
    return this.tracking.updateAddress(tn, dto, p);
  }

  @ApiBearerAuth()
  @Access({ actors: ['customer'] })
  @Throttle(CUSTOMER_LIMIT)
  @Post(':trackingNumber/rate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer: rate the delivery once (updates the hero rating)' })
  rate(@Param('trackingNumber') tn: string, @Body() dto: RateDto, @CurrentPrincipal() p: Principal) {
    return this.tracking.rate(tn, dto, p);
  }
}
