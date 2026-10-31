import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Access, CurrentPrincipal, Public, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { requireBrandId } from '../users/access';
import { BrandsService } from './brands.service';
import { BrandsQueryDto, CreateBrandDto, LocationInputDto, RegisterBrandDto, UpdateBrandDto, UpdateLocationDto, UpdateMyBrandDto } from './brands.dto';

/**
 * Brand portal self-service. Registered BEFORE BrandsController so that
 * `/brands/me…` never matches the staff `/brands/:id…` routes.
 */
@ApiTags('Brand portal')
@ApiBearerAuth()
@Controller({ path: 'brands', version: '1' })
export class BrandSelfController {
  constructor(private readonly brands: BrandsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Public brand sign-up → PENDING brand + owner account (can sign in; orders blocked until approved)' })
  register(@Body() dto: RegisterBrandDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.register(dto, meta);
  }

  @Access({ actors: ['brand'] })
  @Get('me')
  @ApiOperation({ summary: 'My brand profile, wallet balance and pickup locations' })
  me(@CurrentPrincipal() p: Principal) {
    return this.brands.mine(p, requireBrandId(p));
  }

  @Access({ actors: ['brand'] })
  @Patch('me')
  @ApiOperation({ summary: 'Update my brand profile (payout method/details: owner only)' })
  updateMe(@CurrentPrincipal() p: Principal, @Body() dto: UpdateMyBrandDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.updateMine(requireBrandId(p), dto, p, meta);
  }

  @Access({ actors: ['brand'], permissions: ['pickups.read'] })
  @Get('me/locations')
  myLocations(@CurrentPrincipal() p: Principal) {
    return this.brands.listLocations(requireBrandId(p));
  }

  @Access({ actors: ['brand'], permissions: ['pickups.manage'] })
  @Post('me/locations')
  createMyLocation(@CurrentPrincipal() p: Principal, @Body() dto: LocationInputDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.createLocation(requireBrandId(p), dto, p, meta);
  }

  @Access({ actors: ['brand'], permissions: ['pickups.manage'] })
  @Patch('me/locations/:locationId')
  updateMyLocation(@CurrentPrincipal() p: Principal, @Param('locationId') locationId: string, @Body() dto: UpdateLocationDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.updateLocation(requireBrandId(p), locationId, dto, p, meta);
  }

  @Access({ actors: ['brand'], permissions: ['pickups.manage'] })
  @Delete('me/locations/:locationId')
  deleteMyLocation(@CurrentPrincipal() p: Principal, @Param('locationId') locationId: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.deleteLocation(requireBrandId(p), locationId, p, meta);
  }
}

@ApiTags('Brands')
@ApiBearerAuth()
@Controller({ path: 'brands', version: '1' })
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Access({ actors: ['staff'], permissions: ['brands.read'] })
  @Get()
  @ApiOperation({ summary: 'List brands (filters: status, planId, cycle, accountManagerId, q)' })
  list(@Query() q: BrandsQueryDto) {
    return this.brands.list(q);
  }

  @Access({ actors: ['staff'], permissions: ['brands.manage'] })
  @Post()
  @ApiOperation({ summary: 'Onboard a brand with its owner account and default pickup location' })
  create(@Body() dto: CreateBrandDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.create(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['brands.read'] })
  @Get(':id')
  @ApiOperation({ summary: 'Brand detail with stats (orders by status, last 30 days, wallet balance), locations and team' })
  detail(@Param('id') id: string) {
    return this.brands.detail(id);
  }

  @Access({ actors: ['staff'], permissions: ['brands.manage'] })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBrandDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.update(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['brands.manage'] })
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.approve(id, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['brands.manage'] })
  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.suspend(id, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['brands.manage'] })
  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.reactivate(id, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['brands.read'] })
  @Get(':id/locations')
  locations(@Param('id') id: string) {
    return this.brands.load(id).then(() => this.brands.listLocations(id));
  }

  @Access({ actors: ['staff'], permissions: ['brands.manage'] })
  @Post(':id/locations')
  createLocation(@Param('id') id: string, @Body() dto: LocationInputDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.createLocation(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['brands.manage'] })
  @Patch(':id/locations/:locationId')
  updateLocation(@Param('id') id: string, @Param('locationId') locationId: string, @Body() dto: UpdateLocationDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.updateLocation(id, locationId, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['brands.manage'] })
  @Delete(':id/locations/:locationId')
  deleteLocation(@Param('id') id: string, @Param('locationId') locationId: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.brands.deleteLocation(id, locationId, p, meta);
  }
}
