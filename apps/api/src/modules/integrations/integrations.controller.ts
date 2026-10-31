import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Access, CurrentPrincipal, Public, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { assertPermission, requireBrandOwner } from '../users/access';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto, IntegrationsQueryDto, UpdateIntegrationDto } from './integrations.dto';

type RawRequest = Request & { rawBody?: Buffer };
const VIEW = { staff: 'brands.read', brand: 'integrations.manage' } as const;
const INBOUND_LIMIT = { default: { limit: 240, ttl: 60_000 } };

/**
 * Public inbound store webhooks. Declared first so `/integrations/shopify/…`
 * is never captured by `/integrations/:id`.
 *
 * Responses: 401 bad signature (store retries until fixed), 404 unknown
 * connection, 200 for everything else — including orders we cannot map
 * (the reason is stored on the connection), so stores do not retry forever.
 */
@ApiTags('Integrations')
@Controller({ path: 'integrations', version: '1' })
export class IntegrationsInboundController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Public()
  @Throttle(INBOUND_LIMIT)
  @Post('shopify/:connectionId/orders')
  @HttpCode(200)
  @ApiOperation({ summary: 'Shopify webhook receiver (orders/create, orders/cancelled) — HMAC verified' })
  shopify(@Param('connectionId') connectionId: string, @Req() req: RawRequest) {
    return this.integrations.inboundShopify(connectionId, req.headers, req.rawBody, req.body);
  }

  @Public()
  @Throttle(INBOUND_LIMIT)
  @Post('woocommerce/:connectionId/orders')
  @HttpCode(200)
  @ApiOperation({ summary: 'WooCommerce webhook receiver (order.created / order.updated) — HMAC verified' })
  woocommerce(@Param('connectionId') connectionId: string, @Req() req: RawRequest) {
    return this.integrations.inboundWoo(connectionId, req.headers, req.rawBody, req.body);
  }
}

@ApiTags('Integrations')
@ApiBearerAuth()
@Controller({ path: 'integrations', version: '1' })
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Access({ actors: ['staff', 'brand'] })
  @Get()
  @ApiOperation({ summary: 'Store connections (brand: own; staff: all, filter brandId/provider/status)' })
  list(@CurrentPrincipal() p: Principal, @Query() q: IntegrationsQueryDto) {
    assertPermission(p, VIEW);
    return this.integrations.list(p, q);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Post()
  @ApiOperation({ summary: 'Brand owner: connect a Shopify / WooCommerce store (returns webhookUrl + inboundSecret)' })
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateIntegrationDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.integrations.create(requireBrandOwner(p).brandId, dto, p, meta);
  }

  @Access({ actors: ['staff', 'brand'] })
  @Get(':id')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    assertPermission(p, VIEW);
    return this.integrations.get(p, id);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Patch(':id')
  update(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: UpdateIntegrationDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.integrations.update(p, id, dto, meta);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Delete(':id')
  remove(@CurrentPrincipal() p: Principal, @Param('id') id: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.integrations.remove(p, id, meta);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Post(':id/rotate-secret')
  @HttpCode(200)
  rotate(@CurrentPrincipal() p: Principal, @Param('id') id: string, @RequestMeta() meta: RequestMetaInfo) {
    requireBrandOwner(p);
    return this.integrations.rotateInboundSecret(p, id, meta);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['integrations.manage'] })
  @Post(':id/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check the stored credentials against the store API' })
  test(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.integrations.test(p, id);
  }
}
