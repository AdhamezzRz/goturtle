import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import { actorFromPrincipal } from '../../common/actor';
import type { Principal } from '../../common/principal';
import { HoldsService } from './holds.service';
import { ConfirmationService } from './confirmation.service';
import { AttemptsService } from './attempts.service';
import { InboundService } from './inbound.service';
import { IntegrityReportsService } from './integrity-reports.service';
import {
  CancelHoldDto, ConfirmationsQuery, DisputesQuery, HeroIntegrityQuery, HoldNoteDto, HoldsQuery, NetworkRiskQuery, OverrideDto,
  RecordConfirmationDto, ResolveDisputeDto,
} from './integrity.dto';

class InboundListQuery {
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

/** Ops: delivery integrity dashboard, holds, confirmations, disputes, hero scores and network risk. */
@ApiTags('Delivery integrity')
@ApiBearerAuth()
@Controller({ path: 'integrity', version: '1' })
export class IntegrityController {
  constructor(
    private readonly holds: HoldsService,
    private readonly confirmations: ConfirmationService,
    private readonly attempts: AttemptsService,
    private readonly inbound: InboundService,
    private readonly reports: IntegrityReportsService,
  ) {}

  @Access({ actors: ['staff'], permissions: ['orders.read'] })
  @Get('overview')
  @ApiOperation({ summary: 'KPIs: confirmations, holds by reason, disputes, RTO rate (30 d vs previous 30 d), blocklist' })
  overview() {
    return this.reports.overview();
  }

  @Access({ actors: ['staff'], permissions: ['couriers.read'] })
  @Get('heroes')
  @ApiOperation({ summary: 'Hero integrity: failed attempts, distance at failure, calls per failure, disputes, upheld rate → score' })
  heroes(@Query() q: HeroIntegrityQuery) {
    return this.reports.heroes(q);
  }

  @Access({ actors: ['staff'], permissions: ['orders.read'] })
  @Get('network-risk')
  @ApiOperation({ summary: 'Phones that refused / declined COD across ≥ 2 brands, or the blocklist (scope=blocked)' })
  networkRisk(@Query() q: NetworkRiskQuery) {
    return this.reports.networkRisk(q);
  }

  // ---------------------------------------------------------------- holds

  @Access({ actors: ['staff'], permissions: ['orders.read'] })
  @Get('holds')
  holdsList(@Query() q: HoldsQuery) {
    return this.reports.holdsList(q);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['orders.update'] })
  @Post('holds/:orderId/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release a hold whose cause is resolved (brands: their own PREPAY_REQUIRED holds once prepaid)' })
  release(@Param('orderId') id: string, @Body() dto: HoldNoteDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.holds.release(id, dto.note, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['orders.status'] })
  @Post('holds/:orderId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a held order (before pickup) or return it to the brand' })
  cancel(@Param('orderId') id: string, @Body() dto: CancelHoldDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.holds.cancel(id, dto.note, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['orders.status'] })
  @Post('holds/:orderId/override')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ops manager: override the integrity rules for this order (audited)' })
  override(@Param('orderId') id: string, @Body() dto: OverrideDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.holds.override(id, dto.reason, p, meta);
  }

  // ---------------------------------------------------------------- confirmations

  @Access({ actors: ['staff'], permissions: ['orders.read'] })
  @Get('confirmations')
  confirmationsList(@Query() q: ConfirmationsQuery) {
    return this.reports.confirmationsList(q);
  }

  @Access({ actors: ['staff'], permissions: ['orders.update'] })
  @Post('confirmations/:orderId/resend')
  @HttpCode(200)
  resend(@Param('orderId') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.confirmations.resend(id, actorFromPrincipal(p), meta);
  }

  @Access({ actors: ['staff'], permissions: ['orders.update'] })
  @Post('confirmations/:orderId/record')
  @HttpCode(200)
  @ApiOperation({ summary: "Record the customer's answer from a phone call (confirm / new day / decline)" })
  record(@Param('orderId') id: string, @Body() dto: RecordConfirmationDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.confirmations.respond(id, { action: dto.action, date: dto.date ?? null, note: dto.note ?? null, channel: 'PHONE', actor: actorFromPrincipal(p), meta });
  }

  // ---------------------------------------------------------------- disputes

  @Access({ actors: ['staff'], permissions: ['orders.read'] })
  @Get('disputes')
  @ApiOperation({ summary: 'Disputed attempts with evidence: distance vs geofence, call timeline, customer note' })
  disputes(@Query() q: DisputesQuery) {
    return this.reports.disputes(q);
  }

  @Access({ actors: ['staff'], permissions: ['orders.update'] })
  @Post('disputes/:attemptId/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'UPHELD (fake attempt: re-delivery priority + optional PENALTY) or REJECTED' })
  resolve(@Param('attemptId') id: string, @Body() dto: ResolveDisputeDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.attempts.resolve(id, dto, p, meta);
  }

  // ---------------------------------------------------------------- order view & inbound log

  @Access({ actors: ['staff', 'brand'], permissions: ['orders.read'] })
  @Get('orders/:id')
  @ApiOperation({ summary: 'Integrity view of one order (brands: confirmation + hold only)' })
  order(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.reports.order(id, p);
  }

  @Access({ actors: ['staff'], permissions: ['orders.read'] })
  @Get('inbound')
  @ApiOperation({ summary: 'Latest WhatsApp / SMS replies and how they were understood' })
  inboundLog(@Query() q: InboundListQuery) {
    return this.inbound.recent(q.limit ?? 50);
  }
}
