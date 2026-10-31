import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { CashService, hubScope } from './cash.service';
import { ConfirmHandoverDto, CustodyQuery, HubSummaryQuery, ListHandoversQuery, RecordHandoverDto, RejectHandoverDto, ShortageDto } from './dto/cash.dto';

@ApiTags('Cash custody')
@ApiBearerAuth()
@Controller({ path: 'cash', version: '1' })
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Access({ actors: ['staff'], permissions: ['cash.read'] })
  @Get('custody')
  @ApiOperation({ summary: 'All heroes: cash on hand vs limit, oldest unhanded COD, pending handovers, outstanding shortage' })
  custody(@Query() q: CustodyQuery, @CurrentPrincipal() p: Principal) {
    return this.cash.custody(q, { hubId: hubScope(p) });
  }

  @Access({ actors: ['staff'], permissions: ['cash.read'] })
  @Get('hub-summary')
  @ApiOperation({ summary: 'Hub cash desk: received on a Cairo day per hub and per method' })
  hubSummary(@Query() q: HubSummaryQuery, @CurrentPrincipal() p: Principal) {
    return this.cash.hubSummary(q.date, hubScope(p) ?? q.hubId ?? null);
  }

  @Access({ actors: ['staff'], permissions: ['cash.read'] })
  @Get('handovers')
  list(@Query() q: ListHandoversQuery, @CurrentPrincipal() p: Principal) {
    return this.cash.list(q, { hubId: hubScope(p) });
  }

  @Access({ actors: ['staff'], permissions: ['cash.manage'] })
  @Post('handovers')
  @ApiOperation({ summary: 'Record cash received at the hub desk for a hero (created CONFIRMED)' })
  record(@Body() dto: RecordHandoverDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.cash.record(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['cash.read'] })
  @Get('handovers/:id')
  get(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.cash.get(id, { hubId: hubScope(p) });
  }

  @Access({ actors: ['staff'], permissions: ['cash.manage'] })
  @Post('handovers/:id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm what was received: custody decreases, variance recorded, COD orders linked oldest-first' })
  confirm(@Param('id') id: string, @Body() dto: ConfirmHandoverDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.cash.confirm(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['cash.manage'] })
  @Post('handovers/:id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string, @Body() dto: RejectHandoverDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.cash.reject(id, dto.reason, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['cash.manage'] })
  @Post('shortages')
  @ApiOperation({ summary: 'Convert a hero’s outstanding shortage into a CASH_SHORTAGE adjustment (deducted from pay)' })
  shortage(@Body() dto: ShortageDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.cash.recordShortage(dto, p, meta);
  }
}
