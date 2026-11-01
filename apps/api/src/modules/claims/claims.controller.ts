import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { requireAnyPermission } from '../orders/ops-kit';
import { ClaimsService } from './claims.service';
import { ApproveClaimDto, CreateClaimDto, ListClaimsQuery, RejectClaimDto } from './claims.dto';

@ApiTags('Claims')
@ApiBearerAuth()
@Controller({ path: 'claims', version: '1' })
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Access({ actors: ['brand'], permissions: ['tickets.manage'] })
  @Post()
  @ApiOperation({ summary: 'File a claim (LOST / DAMAGED / MISSING_ITEMS / WRONG_ITEM / DELAYED) — one open claim per order and type' })
  create(@Body() dto: CreateClaimDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.claims.create(p, dto, meta);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['orders.read'] })
  @Get()
  list(@Query() q: ListClaimsQuery, @CurrentPrincipal() p: Principal) {
    return this.claims.list(p, q);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['orders.read'] })
  @Get(':id')
  detail(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.claims.detail(p, id);
  }

  @Access({ actors: ['staff'] })
  @Post(':id/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start reviewing (OPEN → UNDER_REVIEW)' })
  review(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    requireAnyPermission(p, ['tickets.manage', 'finance.manage']);
    return this.claims.review(p, id, meta);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve up to the liability cap; optionally charge the responsible hero (PENALTY)' })
  approve(@Param('id') id: string, @Body() dto: ApproveClaimDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.claims.approve(p, id, dto, meta);
  }

  @Access({ actors: ['staff'] })
  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string, @Body() dto: RejectClaimDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    requireAnyPermission(p, ['tickets.manage', 'finance.manage']);
    return this.claims.reject(p, id, dto.note, meta);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post(':id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pay an APPROVED claim into the brand wallet (Dr 5300 claims / Cr brand wallet)' })
  pay(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.claims.pay(p, id, meta);
  }
}
