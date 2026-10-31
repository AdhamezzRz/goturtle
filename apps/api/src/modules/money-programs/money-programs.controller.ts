import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CollectionStatus, type CollectionStatus as TCollectionStatus } from '@goturtle/shared';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import { requireCourierId, type Principal } from '../../common/principal';
import { PageQuery } from '../../common/pagination';
import { requireAnyPermission } from '../orders/ops-kit';
import { PaymentsService } from '../payments/payments.service';
import { CollectionsService } from './collections.service';
import { AdvancesService } from './advances.service';
import { WeightService } from './weight.service';
import {
  AdvanceEligibilityQuery, AdvanceNoteDto, BulkConfirmCollectionsDto, ConfirmCollectionDto, ListAdvancesQuery, ListCollectionsQuery,
  ListWeightQuery, PayAdvanceDto, RejectCollectionDto, RequestAdvanceDto, ResolveWeightDisputeDto, WeighDto, WeightDisputeDto,
} from './money-programs.dto';

class HeroCollectionsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(CollectionStatus) }) @IsOptional() @IsIn(Object.values(CollectionStatus)) status?: TCollectionStatus;
}

// ------------------------------------------------------------------ digital collections

@ApiTags('Finance — digital collections')
@ApiBearerAuth()
@Controller({ path: 'finance/collections', version: '1' })
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get()
  @ApiOperation({ summary: 'Digital collections queue (InstaPay / wallet / card / payment link) with totals' })
  list(@Query() q: ListCollectionsQuery) {
    return this.collections.list(q);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post('bulk-confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm every pending collection whose reference appears in the pasted bank-statement list' })
  bulkConfirm(@Body() dto: BulkConfirmCollectionsDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.collections.bulkConfirm(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get(':orderId')
  get(@Param('orderId') orderId: string) {
    return this.collections.get(orderId);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post(':orderId/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Money arrived: Dr bank (gateway for payment links) / Cr digital clearing' })
  confirm(@Param('orderId') orderId: string, @Body() dto: ConfirmCollectionDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.collections.confirm(orderId, dto.bankReference?.trim() || null, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post(':orderId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Money never arrived: Dr hero cash custody / Cr digital clearing — the hero owes it as cash' })
  reject(@Param('orderId') orderId: string, @Body() dto: RejectCollectionDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.collections.reject(orderId, dto.note.trim(), p, meta);
  }
}

@ApiTags('Hero — digital collections')
@ApiBearerAuth()
@Access({ actors: ['courier'] })
@Controller({ path: 'hero/collections', version: '1' })
export class HeroCollectionsController {
  constructor(
    private readonly collections: CollectionsService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('options')
  @ApiOperation({ summary: 'Accepted door payment methods, company InstaPay address / wallet, payment links on/off' })
  options() {
    return this.collections.heroOptions();
  }

  @Get()
  @ApiOperation({ summary: 'My digital collections (never part of cash on hand unless rejected)' })
  mine(@Query() q: HeroCollectionsQuery, @CurrentPrincipal() p: Principal) {
    return this.collections.heroCollections(requireCourierId(p), q);
  }

  @Post('orders/:id/payment-link')
  @HttpCode(200)
  @ApiOperation({ summary: 'Paymob link / QR for the customer at the door (PAYMENTS_DISABLED when off)' })
  link(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.payments.createDoorLink(p, requireCourierId(p), id, meta);
  }

  @Get('orders/:id/payment-link')
  @ApiOperation({ summary: 'Door payment status (poll while the customer pays)' })
  linkStatus(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.collections.doorPaymentStatus(requireCourierId(p), id);
  }
}

// ------------------------------------------------------------------ advances

@ApiTags('Finance — brand advances (brand portal)')
@ApiBearerAuth()
@Controller({ path: 'finance/brand/advances', version: '1' })
export class BrandAdvancesController {
  constructor(private readonly advances: AdvancesService) {}

  @Access({ actors: ['brand', 'staff'], permissions: ['finance.read'] })
  @Get('eligibility')
  @ApiOperation({ summary: 'What can be paid now (early payout) or advanced against in-transit COD, with a fee preview' })
  eligibility(@Query() q: AdvanceEligibilityQuery, @CurrentPrincipal() p: Principal) {
    return this.advances.eligibility(this.advances.resolveBrand(p, q.brandId), q.amountCents);
  }

  @Access({ actors: ['brand', 'staff'], permissions: ['finance.read'] })
  @Get()
  list(@Query() q: ListAdvancesQuery, @CurrentPrincipal() p: Principal) {
    return this.advances.list(q, this.advances.resolveBrand(p, q.brandId));
  }

  @Access({ actors: ['brand'], permissions: ['finance.read'] })
  @Post()
  @ApiOperation({ summary: 'Request an early payout or a COD advance (brand owner only)' })
  request(@Body() dto: RequestAdvanceDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.advances.request(p, dto, meta);
  }

  @Access({ actors: ['brand'], permissions: ['finance.read'] })
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.advances.cancelOwn(p, id, meta);
  }
}

@ApiTags('Finance — brand advances')
@ApiBearerAuth()
@Controller({ path: 'finance/advances', version: '1' })
export class AdvancesController {
  constructor(private readonly advances: AdvancesService) {}

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get()
  list(@Query() q: ListAdvancesQuery) {
    return this.advances.list(q, null);
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get('overview')
  @ApiOperation({ summary: 'Queue counts, outstanding COD advances per brand, finance-fee revenue' })
  overview() {
    return this.advances.overview();
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get(':id')
  get(@Param('id') id: string) {
    return this.advances.get(id);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.advances.approve(id, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string, @Body() dto: AdvanceNoteDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.advances.reject(id, dto.note.trim(), p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post(':id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pay an APPROVED request (posts BRAND_ADVANCE)' })
  pay(@Param('id') id: string, @Body() dto: PayAdvanceDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.advances.pay(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() dto: AdvanceNoteDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.advances.cancel(id, dto.note.trim(), p, meta);
  }
}

// ------------------------------------------------------------------ quality: weighing & disputes

@ApiTags('Quality — hub weighing')
@ApiBearerAuth()
@Controller({ path: 'quality', version: '1' })
export class QualityController {
  constructor(private readonly weight: WeightService) {}

  @Access({ actors: ['staff'], permissions: ['hubs.scan'] })
  @Post('weigh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Weigh a parcel: billable = max(actual, volumetric); beyond tolerance it is re-priced (FEE_ADJUSTMENT). Idempotent per order.' })
  weigh(@Body() dto: WeighDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.weight.weigh(dto, p, meta);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['orders.read'] })
  @Get('weights')
  @ApiOperation({ summary: 'Re-priced and disputed orders' })
  list(@Query() q: ListWeightQuery, @CurrentPrincipal() p: Principal) {
    return this.weight.list(q, p);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['orders.read'] })
  @Get('orders/:id/weight')
  forOrder(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.weight.forOrder(id, p);
  }

  @Access({ actors: ['brand'], permissions: ['tickets.manage'] })
  @Post('weight-disputes')
  @ApiOperation({ summary: 'Dispute a weight adjustment within the window (opens a WEIGHT_DISPUTE ticket)' })
  dispute(@Body() dto: WeightDisputeDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.weight.dispute(dto, p, meta);
  }

  @Access({ actors: ['staff'] })
  @Post('weight-disputes/:orderId/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'ACCEPTED keeps the adjustment; REVERSED posts its exact mirror' })
  resolve(@Param('orderId') orderId: string, @Body() dto: ResolveWeightDisputeDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    requireAnyPermission(p, ['tickets.manage', 'finance.manage']);
    return this.weight.resolve(orderId, dto, p, meta);
  }
}
