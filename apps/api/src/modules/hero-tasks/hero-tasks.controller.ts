import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Access, CurrentPrincipal } from '../../common/decorators';
import { actorFromPrincipal, type ActorContext } from '../../common/actor';
import { requireCourierId, type Principal } from '../../common/principal';
import { PickupsService } from '../pickups/pickups.service';
import { RunsheetsService } from '../dispatch/runsheets.service';
import { CompletePickupDto, FailPickupDto, PickupScanDto } from '../pickups/pickups.dto';
import { HeroTasksService } from './hero-tasks.service';
import { DeliverDto, FailDto, NoteDto, PositionDto, ReturnedDto } from './hero-tasks.dto';

/** Hero actor with its courier id (throws for anyone else). */
const hero = (p: Principal): ActorContext => ({ ...actorFromPrincipal(p), courierId: requireCourierId(p) });

@ApiTags('Hero tasks')
@ApiBearerAuth()
@Access({ actors: ['courier'] })
@Controller({ path: 'hero/tasks', version: '1' })
export class HeroTasksController {
  constructor(
    private readonly tasks: HeroTasksService,
    private readonly pickups: PickupsService,
    private readonly runsheets: RunsheetsService,
  ) {}

  @Get('today')
  @ApiOperation({ summary: "Today's agenda: pickups, runsheet stops in route order, returns, totals" })
  today(@CurrentPrincipal() p: Principal) {
    return this.tasks.today(requireCourierId(p));
  }

  // ---------------------------------------------------------------- runsheets

  @Get('runsheets/:id')
  runsheet(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.tasks.runsheet(id, requireCourierId(p));
  }

  @Post('runsheets/:id/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start the runsheet (DISPATCHED → IN_PROGRESS)' })
  start(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.runsheets.heroStart(id, hero(p));
  }

  // ---------------------------------------------------------------- stops

  @Get('orders/:id')
  @ApiOperation({ summary: 'Stop detail (phone, address, collect amount, OTP flag, maps link)' })
  stop(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.tasks.stop(id, requireCourierId(p));
  }

  @Post('orders/:id/out-for-delivery')
  @HttpCode(200)
  outForDelivery(@Param('id') id: string, @Body() dto: PositionDto, @CurrentPrincipal() p: Principal) {
    return this.tasks.outForDelivery(id, hero(p), dto);
  }

  @Post('orders/:id/deliver')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deliver: collectedCents must equal collectCents; OTP required when flagged' })
  deliver(@Param('id') id: string, @Body() dto: DeliverDto, @CurrentPrincipal() p: Principal) {
    return this.tasks.deliver(id, dto, hero(p));
  }

  @Post('orders/:id/fail')
  @HttpCode(200)
  @ApiOperation({ summary: 'Failed attempt (auto RETURN_PENDING on refusal / max attempts, RESCHEDULED with a date)' })
  fail(@Param('id') id: string, @Body() dto: FailDto, @CurrentPrincipal() p: Principal) {
    return this.tasks.fail(id, dto, hero(p));
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('orders/:id/resend-otp')
  @HttpCode(200)
  resendOtp(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.tasks.resendOtp(id, requireCourierId(p));
  }

  @Post('orders/:id/return-to-hub')
  @HttpCode(200)
  @ApiOperation({ summary: 'Declare bringing a parcel back to the hub (confirmed by the hub inbound scan)' })
  returnToHub(@Param('id') id: string, @Body() dto: NoteDto, @CurrentPrincipal() p: Principal) {
    return this.tasks.returnToHub(id, dto, hero(p));
  }

  @Post('orders/:id/return-out')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start returning a parcel to its brand (RETURN_PENDING → RETURN_OUT)' })
  returnOut(@Param('id') id: string, @Body() dto: NoteDto, @CurrentPrincipal() p: Principal) {
    return this.tasks.startReturn(id, dto, hero(p));
  }

  @Post('orders/:id/returned')
  @HttpCode(200)
  @ApiOperation({ summary: 'Parcel handed back to the brand (RETURN_OUT → RETURNED, return fee charged)' })
  returned(@Param('id') id: string, @Body() dto: ReturnedDto, @CurrentPrincipal() p: Principal) {
    return this.tasks.returned(id, dto, hero(p));
  }

  // ---------------------------------------------------------------- pickups

  @Get('pickups/:id')
  pickup(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.pickups.heroDetail(id, hero(p));
  }

  @Post('pickups/:id/start')
  @HttpCode(200)
  startPickup(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.pickups.start(id, hero(p));
  }

  @Post('pickups/:id/scan')
  @HttpCode(200)
  @ApiOperation({ summary: "Scan a parcel at the brand (must belong to the pickup's brand & location) → PICKED_UP" })
  scan(@Param('id') id: string, @Body() dto: PickupScanDto, @CurrentPrincipal() p: Principal) {
    return this.pickups.scan(id, dto.trackingNumber, hero(p), { lat: dto.lat, lng: dto.lng });
  }

  @Post('pickups/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete the pickup (unscanned parcels stay CREATED for the next pickup)' })
  complete(@Param('id') id: string, @Body() dto: CompletePickupDto, @CurrentPrincipal() p: Principal) {
    return this.pickups.complete(id, dto, hero(p));
  }

  @Post('pickups/:id/fail')
  @HttpCode(200)
  failPickup(@Param('id') id: string, @Body() dto: FailPickupDto, @CurrentPrincipal() p: Principal) {
    return this.pickups.fail(id, dto.note, hero(p));
  }
}
