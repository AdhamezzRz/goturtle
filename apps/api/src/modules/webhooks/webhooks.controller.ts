import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { assertPermission, requireBrandOwner } from '../users/access';
import { WebhooksService } from './webhooks.service';
import { CreateEndpointDto, DeliveriesQueryDto, EndpointsQueryDto, UpdateEndpointDto } from './webhooks.dto';

/** Staff need brands.read to look, brand users need integrations.manage (owners). */
const VIEW = { staff: 'brands.read', brand: 'integrations.manage' } as const;

@ApiTags('Webhooks')
@ApiBearerAuth()
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Access({ actors: ['staff', 'brand'] })
  @Get('events')
  @ApiOperation({ summary: 'Events an endpoint can subscribe to' })
  events() {
    return this.webhooks.events();
  }

  @Access({ actors: ['staff', 'brand'] })
  @Get('endpoints')
  @ApiOperation({ summary: 'List endpoints (brand: own; staff: all, filter brandId). Secrets are not included.' })
  list(@CurrentPrincipal() p: Principal, @Query() q: EndpointsQueryDto) {
    assertPermission(p, VIEW);
    return this.webhooks.list(p, q);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Post('endpoints')
  @ApiOperation({ summary: 'Brand owner: add an endpoint — the signing secret (whsec_…) is returned' })
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateEndpointDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.webhooks.create(requireBrandOwner(p).brandId, dto, p, meta);
  }

  @Access({ actors: ['staff', 'brand'] })
  @Get('endpoints/:id')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    assertPermission(p, VIEW);
    return this.webhooks.get(p, id);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Patch('endpoints/:id')
  update(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: UpdateEndpointDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.webhooks.update(p, id, dto, meta);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Delete('endpoints/:id')
  remove(@CurrentPrincipal() p: Principal, @Param('id') id: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.webhooks.remove(p, id, meta);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Post('endpoints/:id/reveal-secret')
  @HttpCode(200)
  @ApiOperation({ summary: 'Brand owner: show the signing secret' })
  reveal(@CurrentPrincipal() p: Principal, @Param('id') id: string, @RequestMeta() meta: RequestMetaInfo) {
    requireBrandOwner(p);
    return this.webhooks.revealSecret(p, id, meta);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Post('endpoints/:id/rotate-secret')
  @HttpCode(200)
  @ApiOperation({ summary: 'Brand owner: replace the signing secret (old one stops working immediately)' })
  rotate(@CurrentPrincipal() p: Principal, @Param('id') id: string, @RequestMeta() meta: RequestMetaInfo) {
    requireBrandOwner(p);
    return this.webhooks.rotateSecret(p, id, meta);
  }

  @Access({ actors: ['brand'], permissions: ['integrations.manage'] })
  @Post('endpoints/:id/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a signed `ping` now and return the receiver response' })
  test(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.webhooks.test(p, id);
  }

  @Access({ actors: ['staff', 'brand'] })
  @Get('endpoints/:id/deliveries')
  @ApiOperation({ summary: 'Delivery log (filters: status, event)' })
  deliveries(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Query() q: DeliveriesQueryDto) {
    assertPermission(p, VIEW);
    return this.webhooks.deliveries(p, id, q);
  }

  @Access({ actors: ['staff', 'brand'] })
  @Get('deliveries/:id')
  @ApiOperation({ summary: 'One delivery with payload and the receiver response (first 2 KB)' })
  delivery(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    assertPermission(p, VIEW);
    return this.webhooks.delivery(p, id);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['integrations.manage'] })
  @Post('deliveries/:id/redeliver')
  @HttpCode(200)
  @ApiOperation({ summary: 'Queue the same event again (same payload id) for immediate delivery' })
  redeliver(@CurrentPrincipal() p: Principal, @Param('id') id: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.webhooks.redeliver(p, id, meta);
  }
}
