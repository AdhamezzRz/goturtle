import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { requireBrandOwner } from '../users/access';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysQueryDto, CreateApiKeyDto } from './api-keys.dto';

@ApiTags('API keys')
@ApiBearerAuth()
@Controller({ path: 'api-keys', version: '1' })
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Access({ actors: ['staff', 'brand'], permissions: ['integrations.manage'] })
  @Get('scopes')
  @ApiOperation({ summary: 'Scopes an API key can be granted' })
  scopes() {
    return this.keys.scopes();
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['integrations.manage'] })
  @Get()
  @ApiOperation({ summary: 'List API keys (brand: own; staff: all, filter brandId). Secrets are never returned.' })
  list(@CurrentPrincipal() p: Principal, @Query() q: ApiKeysQueryDto) {
    return this.keys.list(p, q);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Post()
  @ApiOperation({ summary: 'Brand owner: create an API key — the raw key is returned ONCE' })
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateApiKeyDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.keys.create(requireBrandOwner(p).brandId, dto, p, meta);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['integrations.manage'] })
  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.keys.revoke(id, p, meta);
  }
}
