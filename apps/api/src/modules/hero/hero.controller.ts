import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal } from '../../common/decorators';
import { requireCourierId, type Principal } from '../../common/principal';
import { CouriersService } from '../couriers/couriers.service';
import { CourierDocumentsService } from '../couriers/courier-documents.service';
import { CourierLocationsService } from '../couriers/courier-locations.service';
import { CreateDocumentDto } from '../couriers/dto/couriers.dto';
import { CashService } from '../cash/cash.service';
import { DeclareHandoverDto, ListHandoversQuery } from '../cash/dto/cash.dto';
import { ShiftsService } from '../shifts/shifts.service';
import { ClockDto } from '../shifts/dto/shifts.dto';
import { PayrollService } from '../finance/payroll.service';
import { ListPayoutsQuery } from '../finance/dto/finance.dto';
import { GamificationService } from '../gamification/gamification.service';
import { HeroService } from './hero.service';
import { AvailabilityDto, HeroLeaderboardQuery, HeroRangeQuery, HeroShiftsQuery, LocationBatchDto } from './dto/hero.dto';

/** Hero (courier) self-service. Every route is scoped to the signed-in hero. */
@ApiTags('Hero app')
@ApiBearerAuth()
@Access({ actors: ['courier'] })
@Controller({ path: 'hero/me', version: '1' })
export class HeroController {
  constructor(
    private readonly hero: HeroService,
    private readonly couriers: CouriersService,
    private readonly documents: CourierDocumentsService,
    private readonly locations: CourierLocationsService,
    private readonly cash: CashService,
    private readonly shifts: ShiftsService,
    private readonly payroll: PayrollService,
    private readonly gamification: GamificationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My profile with level/progress, zones, cash and KPIs' })
  profile(@CurrentPrincipal() p: Principal) {
    return this.couriers.detail(requireCourierId(p));
  }

  @Patch('availability')
  @ApiOperation({ summary: 'Go ONLINE / OFFLINE / ON_BREAK (SHIFT heroes: only during a shift → NO_ACTIVE_SHIFT)' })
  availability(@CurrentPrincipal() p: Principal, @Body() dto: AvailabilityDto) {
    return this.hero.setAvailability(requireCourierId(p), dto.availability);
  }

  @Post('location')
  @HttpCode(200)
  @ApiOperation({ summary: 'Batch of 1–20 GPS points (history kept every ≥30 s / ≥50 m; accuracy > 200 m ignored)' })
  location(@CurrentPrincipal() p: Principal, @Body() dto: LocationBatchDto) {
    return this.locations.ingest(requireCourierId(p), dto.points);
  }

  @Get('dashboard')
  dashboard(@CurrentPrincipal() p: Principal) {
    return this.hero.dashboard(requireCourierId(p));
  }

  @Get('earnings')
  @ApiOperation({ summary: 'My earnings ledger (2200:HERO) for a date range with totals by kind' })
  earnings(@CurrentPrincipal() p: Principal, @Query() q: HeroRangeQuery) {
    return this.hero.earnings(requireCourierId(p), q);
  }

  @Get('wallet')
  @ApiOperation({ summary: 'Cash on hand and COD orders not yet covered by a confirmed handover (oldest first)' })
  wallet(@CurrentPrincipal() p: Principal) {
    return this.cash.wallet(requireCourierId(p));
  }

  @Post('handovers')
  @ApiOperation({ summary: 'Declare a cash handover (PENDING until finance confirms)' })
  declare(@CurrentPrincipal() p: Principal, @Body() dto: DeclareHandoverDto) {
    return this.cash.declare(requireCourierId(p), dto);
  }

  @Get('handovers')
  handovers(@CurrentPrincipal() p: Principal, @Query() q: ListHandoversQuery) {
    return this.cash.list(q, { courierId: requireCourierId(p) });
  }

  @Get('handovers/:id')
  handover(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.cash.get(id, { courierId: requireCourierId(p) });
  }

  @Get('payouts')
  payouts(@CurrentPrincipal() p: Principal, @Query() q: ListPayoutsQuery) {
    return this.payroll.list(q, { courierId: requireCourierId(p) });
  }

  @Get('payouts/:id')
  payout(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.payroll.detail(id, { courierId: requireCourierId(p) });
  }

  @Get('shifts')
  myShifts(@CurrentPrincipal() p: Principal, @Query() q: HeroShiftsQuery) {
    return this.shifts.list(q, { courierId: requireCourierId(p) });
  }

  @Post('shifts/:id/confirm')
  @HttpCode(200)
  confirmShift(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.shifts.confirm(id, requireCourierId(p));
  }

  @Post('shifts/:id/clock-in')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clock in (opens 30 min before start; > 500 m from the hub is allowed but flagged GEOFENCE_WARNING)' })
  clockIn(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: ClockDto) {
    return this.shifts.clockIn(id, { lat: dto.lat, lng: dto.lng }, { courierId: requireCourierId(p) });
  }

  @Post('shifts/:id/clock-out')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clock out: completes the shift and posts the hourly earning' })
  clockOut(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: ClockDto) {
    return this.shifts.clockOut(id, { lat: dto.lat, lng: dto.lng }, { courierId: requireCourierId(p) });
  }

  @Get('documents')
  myDocuments(@CurrentPrincipal() p: Principal) {
    return this.documents.list(requireCourierId(p));
  }

  @Post('documents')
  @ApiOperation({ summary: 'Upload a document (POST /files?purpose=courier_document first) for review' })
  addDocument(@CurrentPrincipal() p: Principal, @Body() dto: CreateDocumentDto) {
    return this.documents.create(requireCourierId(p), dto, p, null);
  }

  @Get('achievements')
  @ApiOperation({ summary: 'Level, progress, badges (from real stats), streak and XP history' })
  achievements(@CurrentPrincipal() p: Principal) {
    return this.gamification.achievements(requireCourierId(p));
  }

  @Get('leaderboard')
  leaderboard(@CurrentPrincipal() p: Principal, @Query() q: HeroLeaderboardQuery) {
    return this.gamification.leaderboard(q.period, { limit: 20, meCourierId: requireCourierId(p) });
  }
}
