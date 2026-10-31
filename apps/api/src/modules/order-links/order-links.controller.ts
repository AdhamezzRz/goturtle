import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Access, CurrentPrincipal, Public, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { requireBrandId } from '../users/access';
import { OrderLinksService } from './order-links.service';
import { CreateOrderLinkDto, OrderLinksQueryDto, PublicDetectZoneDto, PublicOrderDto, PublicQuoteDto, UpdateOrderLinkDto } from './order-links.dto';

/*
 * Public limits are per client IP. Egyptian mobile carriers put many buyers
 * behind one CGNAT address, so they are generous enough for a viral post while
 * still stopping scripted floods.
 */
const VIEW_LIMIT = { default: { limit: 120, ttl: 60_000 } };
const SUBMIT_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const DETECT_LIMIT = { default: { limit: 60, ttl: 60_000 } };

@ApiTags('Order links')
@Controller({ path: 'public', version: '1' })
export class PublicOrderLinksController {
  constructor(private readonly links: OrderLinksService) {}

  @Public()
  @Throttle(VIEW_LIMIT)
  @Get('order-links/:code')
  @ApiOperation({ summary: 'Public order form data (brand, items, price). 404 when inactive, expired or sold out.' })
  view(@Param('code') code: string) {
    return this.links.publicView(code);
  }

  @Public()
  @Throttle(DETECT_LIMIT)
  @Post('order-links/:code/quote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Amount the buyer pays at the door for a delivery zone' })
  quote(@Param('code') code: string, @Body() dto: PublicQuoteDto) {
    return this.links.publicQuote(code, dto.zoneId);
  }

  @Public()
  @Throttle(SUBMIT_LIMIT)
  @Post('order-links/:code/orders')
  @ApiOperation({ summary: 'Buyer places an order through the link → ORDER_LINK order, already confirmed' })
  submit(@Param('code') code: string, @Body() dto: PublicOrderDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.links.submit(code, dto, meta);
  }

  @Public()
  @Throttle(DETECT_LIMIT)
  @Post('detect-zone')
  @HttpCode(200)
  @ApiOperation({ summary: 'Detect the delivery zone of an address / map pin (public order forms)' })
  detect(@Body() dto: PublicDetectZoneDto) {
    return this.links.detectZone(dto);
  }
}

@ApiTags('Order links')
@ApiBearerAuth()
@Controller({ path: 'order-links', version: '1' })
export class OrderLinksController {
  constructor(private readonly links: OrderLinksService) {}

  @Access({ actors: ['staff', 'brand'], permissions: ['orders.read'] })
  @Get()
  @ApiOperation({ summary: 'Order links with usage stats (brand: own; staff: all, filter brandId)' })
  list(@CurrentPrincipal() p: Principal, @Query() q: OrderLinksQueryDto) {
    return this.links.list(p, q);
  }

  @Access({ actors: ['brand'], permissions: ['orders.create'] })
  @Post()
  @ApiOperation({ summary: 'Create a shareable order link (short code, items, COD total)' })
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateOrderLinkDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.links.create(p, requireBrandId(p), dto, meta);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['orders.read'] })
  @Get(':id')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.links.get(p, id);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['orders.read'] })
  @Get(':id/orders')
  @ApiOperation({ summary: 'The latest 50 orders placed through this link' })
  orders(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.links.recentOrders(p, id);
  }

  @Access({ actors: ['brand'], permissions: ['orders.create'] })
  @Patch(':id')
  update(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: UpdateOrderLinkDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.links.update(p, id, dto, meta);
  }

  @Access({ actors: ['brand'], permissions: ['orders.create'] })
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an unused link (links with orders can only be deactivated)' })
  remove(@CurrentPrincipal() p: Principal, @Param('id') id: string, @RequestMeta() meta: RequestMetaInfo) {
    return this.links.remove(p, id, meta);
  }
}
