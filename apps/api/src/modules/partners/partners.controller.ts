import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { PartnersService } from './partners.service';
import { CreatePartnerDto, HandoffDto, HandoffQueueQuery, PartnerShipmentsQuery, PartnerStatusBatchDto, UpdatePartnerDto } from './partners.dto';

@ApiTags('Partner carriers')
@ApiBearerAuth()
@Controller({ path: 'partners', version: '1' })
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Access({ actors: ['staff'], permissions: ['dispatch.manage'] })
  @Get()
  @ApiOperation({ summary: 'Partner carriers with shipment stats, COD custody and fees payable' })
  list() {
    return this.partners.list();
  }

  @Access({ actors: ['staff'], permissions: ['network.manage'] })
  @Post()
  @ApiOperation({ summary: 'Add a partner carrier (creates its virtual hero PT-<CODE>)' })
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreatePartnerDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.partners.create(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['dispatch.manage'] })
  @Get('handoff-queue')
  @ApiOperation({ summary: 'Parcels at the hub that our heroes do not cover (or all with unservedOnly=false), with suggested partners' })
  queue(@Query() q: HandoffQueueQuery) {
    return this.partners.handoffQueue(q);
  }

  @Access({ actors: ['staff'], permissions: ['dispatch.manage'] })
  @Get(':id')
  get(@Param('id') id: string) {
    return this.partners.get(id);
  }

  @Access({ actors: ['staff'], permissions: ['network.manage'] })
  @Patch(':id')
  update(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: UpdatePartnerDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.partners.update(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['dispatch.manage'] })
  @Post(':id/handoff')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hand parcels at the hub to the partner → OUT_FOR_DELIVERY with the partner waybill' })
  handoff(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: HandoffDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.partners.handoff(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['dispatch.manage'] })
  @Post(':id/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Bulk outcomes for a manual partner (DELIVERED / FAILED / RETURNED with partner reference); per-line results' })
  status(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: PartnerStatusBatchDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.partners.updateStatuses(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['dispatch.manage'] })
  @Get(':id/shipments')
  shipments(@Param('id') id: string, @Query() q: PartnerShipmentsQuery) {
    return this.partners.shipments(id, q);
  }

  @Access({ actors: ['staff'], permissions: ['cash.read'] })
  @Get(':id/custody')
  @ApiOperation({ summary: 'COD the partner holds for us, fees we owe them, remittances (cash handovers)' })
  custody(@Param('id') id: string) {
    return this.partners.custody(id);
  }
}
