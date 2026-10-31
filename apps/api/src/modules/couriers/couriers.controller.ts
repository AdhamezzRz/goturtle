import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { GamificationService } from '../gamification/gamification.service';
import { CouriersService } from './couriers.service';
import { CourierDocumentsService } from './courier-documents.service';
import { CourierLocationsService } from './courier-locations.service';
import {
  ActivateCourierDto, CreateCourierDto, CreateDocumentDto, ExpiringQuery, LeaderboardQuery, ListCouriersQuery, LiveQuery,
  ReviewDocumentDto, StatusReasonDto, TrackQuery, UpdateCourierDto,
} from './dto/couriers.dto';

@ApiTags('Heroes (couriers)')
@ApiBearerAuth()
@Controller({ path: 'couriers', version: '1' })
export class CouriersController {
  constructor(
    private readonly couriers: CouriersService,
    private readonly documents: CourierDocumentsService,
    private readonly locations: CourierLocationsService,
    private readonly gamification: GamificationService,
  ) {}

  // Static routes first (before /:id).

  @Access({ actors: ['staff'], permissions: ['couriers.track'] })
  @Get('live')
  @ApiOperation({ summary: 'Live positions for the ops map (poll with ?since=<previous serverTime>)' })
  live(@Query() q: LiveQuery) {
    return this.locations.live(q);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.read'] })
  @Get('leaderboard')
  @ApiOperation({ summary: 'Hero leaderboard for today / this week / this month' })
  leaderboard(@Query() q: LeaderboardQuery) {
    return this.gamification.leaderboard(q.period, { limit: q.limit, hubId: q.hubId });
  }

  @Access({ actors: ['staff'], permissions: ['couriers.read'] })
  @Get('documents/expiring')
  @ApiOperation({ summary: 'Documents and driving licenses expiring within N days (or already expired)' })
  expiring(@Query() q: ExpiringQuery) {
    return this.documents.expiring(q.days);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.read'] })
  @Get()
  @ApiOperation({ summary: 'List heroes with filters, search and sorting' })
  list(@Query() q: ListCouriersQuery) {
    return this.couriers.list(q);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.manage'] })
  @Post()
  @ApiOperation({ summary: 'Onboard a hero: creates the login (temporary password returned once) and the hero profile' })
  onboard(@Body() dto: CreateCourierDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.couriers.onboard(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.read'] })
  @Get(':id')
  @ApiOperation({ summary: 'Hero profile with KPIs (today / 7d / 30d), cash custody, payable balance, XP and level' })
  detail(@Param('id') id: string) {
    return this.couriers.detail(id);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.manage'] })
  @Patch(':id')
  @ApiOperation({ summary: 'Update profile, rates, limits and zones' })
  update(@Param('id') id: string, @Body() dto: UpdateCourierDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.couriers.update(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.manage'] })
  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id') id: string, @Body() dto: ActivateCourierDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.couriers.changeStatus(id, 'activate', dto.reason ?? null, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.manage'] })
  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id') id: string, @Body() dto: StatusReasonDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.couriers.changeStatus(id, 'suspend', dto.reason, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.manage'] })
  @Post(':id/offboard')
  @HttpCode(200)
  @ApiOperation({ summary: 'Offboard (refused with CASH_OUTSTANDING while the hero holds cash)' })
  offboard(@Param('id') id: string, @Body() dto: StatusReasonDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.couriers.changeStatus(id, 'offboard', dto.reason, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.read'] })
  @Get(':id/documents')
  documentsList(@Param('id') id: string) {
    return this.documents.list(id);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.manage'] })
  @Post(':id/documents')
  @ApiOperation({ summary: 'Attach a document (upload the file first with POST /files?purpose=courier_document)' })
  addDocument(@Param('id') id: string, @Body() dto: CreateDocumentDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.documents.create(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.manage'] })
  @Post(':id/documents/:documentId/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve or reject a document (note required to reject)' })
  review(@Param('id') id: string, @Param('documentId') documentId: string, @Body() dto: ReviewDocumentDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.documents.review(id, documentId, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['couriers.track'] })
  @Get(':id/track')
  @ApiOperation({ summary: 'Location breadcrumbs for one Cairo day' })
  track(@Param('id') id: string, @Query() q: TrackQuery) {
    return this.locations.track(id, q.date);
  }
}
