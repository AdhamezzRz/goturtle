import {
  Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { eq } from 'drizzle-orm';
import { isValidTrackingNumber, normalizeTrackingNumber } from '@goturtle/shared';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import { actorFromPrincipal } from '../../common/actor';
import { brandScope, type Principal } from '../../common/principal';
import { DomainError, notFound } from '../../common/errors';
import { InjectDb } from '../../core/database.module';
import type { Db } from '../../db/client';
import { orders } from '../../db/schema';
import { cairoToday } from '../../db/helpers';
import { OrdersService } from './orders.service';
import { OrdersBulkService } from './orders-bulk.service';
import { BulkOrdersDto, CancelOrderDto, ChangeStatusDto, CreateOrderDto, LabelsDto, OrderListQuery, UpdateOrderDto } from './orders.dto';

const PORTALS = ['staff', 'brand', 'apiKey'] as const;

@ApiTags('Orders')
@ApiBearerAuth()
@ApiSecurity('apiKey')
@Controller({ path: 'orders', version: '1' })
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly bulk: OrdersBulkService,
    @InjectDb() private readonly db: Db,
  ) {}

  @Access({ actors: [...PORTALS], permissions: ['orders.create'] })
  @Post()
  @ApiOperation({ summary: 'Create an order (zone auto-detected from the address when zoneId is omitted)' })
  create(@Body() dto: CreateOrderDto, @CurrentPrincipal() p: Principal) {
    return this.orders.createFromDto(dto, p);
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.read'] })
  @Get()
  @ApiOperation({ summary: 'List orders with filters (brand-scoped)' })
  list(@Query() q: OrderListQuery, @CurrentPrincipal() p: Principal) {
    return this.orders.list(q, p);
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.read'] })
  @Get('counts')
  @ApiOperation({ summary: 'Order counts per status and status group (for tabs); same filters as the list' })
  counts(@Query() q: OrderListQuery, @CurrentPrincipal() p: Principal) {
    return this.orders.counts(q, p);
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.export'] })
  @Get('export')
  @ApiOperation({ summary: `CSV export (max 10,000 rows; header X-Export-Truncated: true when capped)` })
  async export(@Query() q: OrderListQuery, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) res: Response) {
    const { csv, rows, truncated } = await this.orders.exportCsv(q, p);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goturtle-orders-${cairoToday()}.csv"`);
    res.setHeader('X-Export-Rows', String(rows));
    res.setHeader('X-Export-Truncated', String(truncated));
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Rows, X-Export-Truncated, Content-Disposition');
    return csv;
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.create'] })
  @Get('bulk/template')
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ar'] })
  @ApiOperation({ summary: 'Bulk upload CSV template (English or Arabic headers)' })
  template(@Query('lang') lang: string | undefined, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goturtle-bulk-template-${lang === 'ar' ? 'ar' : 'en'}.csv"`);
    return this.bulk.template(lang === 'ar' ? 'ar' : 'en');
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.create'] })
  @Post('bulk/validate')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, brandId: { type: 'string' }, pickupLocationId: { type: 'string' }, rows: { type: 'array', items: { type: 'object' } } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Validate a bulk upload (CSV file or JSON rows): per-row errors, detected zone and fee preview' })
  validateBulk(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: BulkOrdersDto, @CurrentPrincipal() p: Principal) {
    return this.bulk.validate(this.bulkRows(file, dto), this.bulkContext(p, dto));
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.create'] })
  @Post('bulk')
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, brandId: { type: 'string' }, pickupLocationId: { type: 'string' }, rows: { type: 'array', items: { type: 'object' } } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Create orders in bulk (max 500 rows); valid rows are created, invalid ones reported' })
  createBulk(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: BulkOrdersDto, @CurrentPrincipal() p: Principal) {
    return this.bulk.create(this.bulkRows(file, dto), this.bulkContext(p, dto), actorFromPrincipal(p));
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.read'] })
  @Post('labels')
  @HttpCode(200)
  @ApiOperation({ summary: 'Data for printing 4x6" AWB labels' })
  labels(@Body() dto: LabelsDto, @CurrentPrincipal() p: Principal) {
    return this.orders.labels(dto.ids, p);
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.read'] })
  @Get('by-tracking/:trackingNumber')
  @ApiOperation({ summary: 'Order detail by tracking number (scanner input)' })
  async byTracking(@Param('trackingNumber') raw: string, @CurrentPrincipal() p: Principal) {
    const tn = normalizeTrackingNumber(raw);
    if (!isValidTrackingNumber(tn)) throw new DomainError('INVALID_TRACKING_NUMBER', 'Tracking number is not valid', 400);
    const [row] = await this.db.select({ id: orders.id, brandId: orders.brandId }).from(orders).where(eq(orders.trackingNumber, tn)).limit(1);
    const scope = brandScope(p);
    if (!row || (scope && row.brandId !== scope)) throw notFound('Order', tn);
    return this.orders.detail(row.id, p);
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.read'] })
  @Get(':id')
  @ApiOperation({ summary: 'Order detail: timeline, attempts, hero, zone, hub, pickup, brand (+ customer & ledger for staff)' })
  detail(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.orders.detail(id, p);
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.update'] })
  @Patch(':id')
  @ApiOperation({ summary: 'Edit an order (brand: before pickup; staff: until final). Fees are re-quoted when needed' })
  update(@Param('id') id: string, @Body() dto: UpdateOrderDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.orders.update(id, dto, p, meta);
  }

  @Access({ actors: [...PORTALS], permissions: ['orders.cancel'] })
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.orders.cancel(id, dto.reason, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['orders.status'] })
  @Post(':id/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Staff: move an order to any status the state machine allows' })
  changeStatus(@Param('id') id: string, @Body() dto: ChangeStatusDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.orders.changeStatus(id, dto, p, meta);
  }

  // ------------------------------------------------------------------ helpers

  private bulkRows(file: Express.Multer.File | undefined, dto: BulkOrdersDto) {
    if (file) return this.bulk.parseCsv(file.buffer);
    if (dto.rows?.length) return dto.rows;
    throw new DomainError('EMPTY_UPLOAD', 'Upload a CSV file (field "file") or send JSON { rows: [...] }', 400);
  }

  private bulkContext(p: Principal, dto: BulkOrdersDto) {
    const actor = actorFromPrincipal(p);
    return {
      brandId: this.orders.targetBrand(p, dto.brandId),
      source: actor.actorType === 'API' ? ('API' as const) : ('BULK_UPLOAD' as const),
      pickupLocationId: dto.pickupLocationId ?? null,
    };
  }
}

