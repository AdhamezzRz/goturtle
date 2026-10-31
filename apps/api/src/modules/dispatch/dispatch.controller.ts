import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import { actorFromPrincipal } from '../../common/actor';
import type { Principal } from '../../common/principal';
import { isOpsManager } from '../orders/ops-kit';
import { DispatchService } from './dispatch.service';
import { AssignmentService } from './assignment.service';
import { RunsheetsService } from './runsheets.service';
import {
  AssignReturnsDto, AutoAssignDto, CloseRunsheetDto, CreateRunsheetDto, DispatchRunsheetDto, LiveQuery, OutboundScanDto, ReturnHandoverDto,
  RunsheetListQuery, RunsheetOrdersDto, ScanDto,
} from './dispatch.dto';

@ApiTags('Dispatch')
@ApiBearerAuth()
@Controller({ path: 'dispatch', version: '1' })
export class DispatchController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly assignment: AssignmentService,
  ) {}

  @Access({ actors: ['staff'], permissions: ['hubs.scan'] })
  @Post('scan/inbound')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hub inbound scan → RECEIVED_AT_HUB with sorting info (bin, transfer, suggested hero)' })
  inbound(@Body() dto: ScanDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.dispatch.inboundScan(dto.hubId, dto.trackingNumber, p, actorFromPrincipal(p), meta);
  }

  @Access({ actors: ['staff'], permissions: ['hubs.scan'] })
  @Post('scan/outbound')
  @HttpCode(200)
  @ApiOperation({ summary: 'Loading check: the parcel belongs to this runsheet (records a LOADED note)' })
  outbound(@Body() dto: OutboundScanDto, @CurrentPrincipal() p: Principal) {
    return this.dispatch.outboundScan(dto.runsheetId, dto.trackingNumber, actorFromPrincipal(p));
  }

  @Access({ actors: ['staff'], permissions: ['hubs.scan'] })
  @Post('scan/return-to-brand')
  @HttpCode(200)
  @ApiOperation({ summary: 'Brand collected a return at the hub (→ RETURNED, return fee charged)' })
  returnToBrand(@Body() dto: ReturnHandoverDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.dispatch.returnToBrand(dto.trackingNumber, dto, actorFromPrincipal(p), meta);
  }

  @Access({ actors: ['staff'], permissions: ['dispatch.manage'] })
  @Post('returns/assign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send pending returns to their brands with a hero (RETURN_PENDING → RETURN_OUT)' })
  assignReturns(@Body() dto: AssignReturnsDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.dispatch.assignReturns(dto.courierId, dto.orderIds, actorFromPrincipal(p), meta);
  }

  @Access({ actors: ['staff'], permissions: ['dispatch.manage'] })
  @Get('suggest/:orderId')
  @ApiOperation({ summary: 'Top 5 eligible heroes for an order with score breakdown' })
  suggest(@Param('orderId') orderId: string) {
    return this.assignment.suggest(orderId);
  }

  @Access({ actors: ['staff'], permissions: ['dispatch.manage'] })
  @Post('auto-assign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Plan (commit=false) or apply (commit=true) hero assignment for orders waiting at the hub' })
  autoAssign(@Body() dto: AutoAssignDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.assignment.autoAssign(dto, actorFromPrincipal(p), meta);
  }

  @Access({ actors: ['staff'], permissions: ['dispatch.manage'] })
  @SkipThrottle()
  @Get('live')
  @ApiOperation({ summary: 'Control tower snapshot: heroes, out-for-delivery orders, SLA at risk (poll ~10 s)' })
  live(@Query() q: LiveQuery) {
    return this.dispatch.live(q.hubId);
  }
}

@ApiTags('Runsheets')
@ApiBearerAuth()
@Controller({ path: 'runsheets', version: '1' })
export class RunsheetsController {
  constructor(private readonly runsheets: RunsheetsService) {}

  @Access({ actors: ['staff'], permissions: ['runsheets.read'] })
  @Get()
  list(@Query() q: RunsheetListQuery) {
    return this.runsheets.list(q);
  }

  @Access({ actors: ['staff'], permissions: ['runsheets.manage'] })
  @Post()
  @ApiOperation({ summary: 'Create a DRAFT runsheet for a hero (optionally with orders → ASSIGNED)' })
  create(@Body() dto: CreateRunsheetDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.runsheets.create(dto, actorFromPrincipal(p), meta);
  }

  @Access({ actors: ['staff'], permissions: ['runsheets.read'] })
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.runsheets.detail(id);
  }

  @Access({ actors: ['staff'], permissions: ['runsheets.read'] })
  @Get(':id/manifest')
  @ApiOperation({ summary: 'Printable manifest data' })
  manifest(@Param('id') id: string) {
    return this.runsheets.manifest(id);
  }

  @Access({ actors: ['staff'], permissions: ['runsheets.manage'] })
  @Post(':id/orders')
  @HttpCode(200)
  addOrders(@Param('id') id: string, @Body() dto: RunsheetOrdersDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.runsheets.addOrders(id, dto.orderIds, actorFromPrincipal(p), meta);
  }

  @Access({ actors: ['staff'], permissions: ['runsheets.manage'] })
  @Delete(':id/orders')
  @ApiOperation({ summary: 'Remove orders from a DRAFT runsheet (back to RECEIVED_AT_HUB)' })
  removeOrders(@Param('id') id: string, @Body() dto: RunsheetOrdersDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.runsheets.removeOrders(id, dto.orderIds, actorFromPrincipal(p), meta);
  }

  @Access({ actors: ['staff'], permissions: ['runsheets.manage'] })
  @Post(':id/optimize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Optimise the stop order (nearest neighbour + 2-opt) from the hero position or hub' })
  optimize(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.runsheets.optimize(id, actorFromPrincipal(p));
  }

  @Access({ actors: ['staff'], permissions: ['runsheets.manage'] })
  @Post(':id/dispatch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dispatch: stops → OUT_FOR_DELIVERY (CASH_LIMIT_EXCEEDED unless override by an ops manager)' })
  dispatch(@Param('id') id: string, @Body() dto: DispatchRunsheetDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.runsheets.dispatch(id, { override: dto.override, canOverride: isOpsManager(p) }, actorFromPrincipal(p), meta);
  }

  @Access({ actors: ['staff'], permissions: ['runsheets.manage'] })
  @Post(':id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close and reconcile (all stops final or back at the hub)' })
  close(@Param('id') id: string, @Body() dto: CloseRunsheetDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.runsheets.close(id, dto.notes, actorFromPrincipal(p), meta);
  }
}
