import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Access, CurrentPrincipal, Public, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { NetworkService } from './network.service';
import {
  CityDto, DetectZoneDto, GovernorateDto, HubDto, HubListQuery, UpdateCityDto, UpdateGovernorateDto, UpdateHubDto, UpdateZoneDto, ZoneDto,
  ZoneListQuery,
} from './network.dto';

/** Read the network (staff and brand portals). */
const CanRead = () => Access({ actors: ['staff', 'brand'], permissions: ['network.read'] });
/** Change the network (ops). */
const CanManage = () => Access({ actors: ['staff'], permissions: ['network.manage'] });

@ApiTags('Network')
@ApiBearerAuth()
@Controller({ path: 'network', version: '1' })
export class NetworkController {
  constructor(private readonly network: NetworkService) {}

  // ---------------------------------------------------------------- public & detection

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('zones/serviceable')
  @ApiOperation({ summary: 'Active delivery zones (minimal fields) for order and tracking forms' })
  serviceable() {
    return this.network.serviceableZones();
  }

  @Access({ actors: ['staff', 'brand', 'apiKey'] })
  @Post('detect-zone')
  @HttpCode(200)
  @ApiOperation({ summary: 'Detect the delivery zone of an address (Arabic / English / Franco) and optional pin' })
  detect(@Body() dto: DetectZoneDto) {
    return this.network.detectForDto(dto);
  }

  // ---------------------------------------------------------------- governorates

  @CanRead()
  @Get('governorates')
  governorates() {
    return this.network.listGovernorates();
  }

  @CanManage()
  @Post('governorates')
  createGovernorate(@Body() dto: GovernorateDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.createGovernorate(dto, p, meta);
  }

  @CanManage()
  @Patch('governorates/:id')
  updateGovernorate(@Param('id') id: string, @Body() dto: UpdateGovernorateDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.updateGovernorate(id, dto, p, meta);
  }

  @CanManage()
  @Delete('governorates/:id')
  deleteGovernorate(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.deleteGovernorate(id, p, meta);
  }

  // ---------------------------------------------------------------- cities

  @CanRead()
  @Get('cities')
  cities(@Query('governorateId') governorateId?: string) {
    return this.network.listCities(governorateId);
  }

  @CanManage()
  @Post('cities')
  createCity(@Body() dto: CityDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.createCity(dto, p, meta);
  }

  @CanManage()
  @Patch('cities/:id')
  updateCity(@Param('id') id: string, @Body() dto: UpdateCityDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.updateCity(id, dto, p, meta);
  }

  @CanManage()
  @Delete('cities/:id')
  deleteCity(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.deleteCity(id, p, meta);
  }

  // ---------------------------------------------------------------- hubs

  @CanRead()
  @Get('hubs')
  hubs(@Query() q: HubListQuery) {
    return this.network.listHubs(q.isActive);
  }

  @CanRead()
  @Get('hubs/:id')
  hub(@Param('id') id: string) {
    return this.network.hubDetail(id);
  }

  @CanManage()
  @Post('hubs')
  createHub(@Body() dto: HubDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.createHub(dto, p, meta);
  }

  @CanManage()
  @Patch('hubs/:id')
  updateHub(@Param('id') id: string, @Body() dto: UpdateHubDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.updateHub(id, dto, p, meta);
  }

  @CanManage()
  @Delete('hubs/:id')
  deleteHub(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.deleteHub(id, p, meta);
  }

  // ---------------------------------------------------------------- zones

  @CanRead()
  @Get('zones')
  zones(@Query() q: ZoneListQuery) {
    return this.network.listZones(q);
  }

  @CanRead()
  @Get('zones/:id')
  zone(@Param('id') id: string) {
    return this.network.zoneDetail(id);
  }

  @CanManage()
  @Post('zones')
  createZone(@Body() dto: ZoneDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.createZone(dto, p, meta);
  }

  @CanManage()
  @Patch('zones/:id')
  updateZone(@Param('id') id: string, @Body() dto: UpdateZoneDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.updateZone(id, dto, p, meta);
  }

  @CanManage()
  @Delete('zones/:id')
  deleteZone(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.network.deleteZone(id, p, meta);
  }
}
