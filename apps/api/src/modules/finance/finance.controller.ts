import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { SettlementsService } from './settlements.service';
import { PayrollService } from './payroll.service';
import { AdjustmentsService } from './adjustments.service';
import { FinanceReportsService } from './finance-reports.service';
import { BrandFinanceService } from './brand-finance.service';
import {
  BrandScopeQuery, BrandSettlementsQuery, BrandStatementQuery, CreateAdjustmentDto, DayQuery, DayRangeQuery, GeneratePayoutsDto,
  GenerateSettlementsDto, ListAdjustmentsQuery, ListPayoutsQuery, ListSettlementsQuery, PayPayoutDto, PaySettlementDto, ReasonDto,
  StatementQuery, TrialBalanceQuery,
} from './dto/finance.dto';

function sendCsv(res: Response, filename: string, content: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  return content;
}

@ApiTags('Finance — brand settlements')
@ApiBearerAuth()
@Controller({ path: 'finance/settlements', version: '1' })
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Access({ actors: ['staff'], permissions: ['settlements.manage'] })
  @Post('generate')
  @ApiOperation({ summary: 'Create DRAFT settlements for unsettled DELIVERED/RETURNED orders (all active brands or one)' })
  generate(@Body() dto: GenerateSettlementsDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.settlements.generate({ brandId: dto.brandId, periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined }, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get()
  list(@Query() q: ListSettlementsQuery) {
    return this.settlements.list(q);
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.settlements.detail(id);
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get(':id/export.csv')
  @ApiProduces('text/csv')
  async csv(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.settlements.csv(id);
    return sendCsv(res, f.filename, f.content);
  }

  @Access({ actors: ['staff'], permissions: ['settlements.manage'] })
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.settlements.approve(id, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['settlements.manage'] })
  @Post(':id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark an APPROVED settlement paid (posts the brand payout)' })
  pay(@Param('id') id: string, @Body() dto: PaySettlementDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.settlements.pay(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['settlements.manage'] })
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a DRAFT/APPROVED settlement and release its orders' })
  cancel(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.settlements.cancel(id, dto.reason, p, meta);
  }
}

@ApiTags('Finance — hero payroll')
@ApiBearerAuth()
@Controller({ path: 'finance/payouts', version: '1' })
export class PayoutsController {
  constructor(private readonly payroll: PayrollService) {}

  @Access({ actors: ['staff'], permissions: ['payouts.manage'] })
  @Post('generate')
  @ApiOperation({ summary: 'Create DRAFT payouts = current payable balance, with the period breakdown' })
  generate(@Body() dto: GeneratePayoutsDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.payroll.generate(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get()
  list(@Query() q: ListPayoutsQuery) {
    return this.payroll.list(q);
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.payroll.detail(id);
  }

  @Access({ actors: ['staff'], permissions: ['payouts.manage'] })
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.payroll.approve(id, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['payouts.manage'] })
  @Post(':id/pay')
  @HttpCode(200)
  pay(@Param('id') id: string, @Body() dto: PayPayoutDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.payroll.pay(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['payouts.manage'] })
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.payroll.cancel(id, dto.reason, p, meta);
  }
}

@ApiTags('Finance — hero adjustments')
@ApiBearerAuth()
@Controller({ path: 'finance/adjustments', version: '1' })
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get()
  list(@Query() q: ListAdjustmentsQuery) {
    return this.adjustments.list(q);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post()
  @ApiOperation({ summary: 'Bonus / penalty / cash shortage / advance / reimbursement (posted immediately, never deleted)' })
  create(@Body() dto: CreateAdjustmentDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.adjustments.create(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get(':id')
  get(@Param('id') id: string) {
    return this.adjustments.get(id);
  }

  @Access({ actors: ['staff'], permissions: ['finance.manage'] })
  @Post(':id/reverse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Post an exact reversing adjustment' })
  reverse(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.adjustments.reverse(id, dto.reason, p, meta);
  }
}

@ApiTags('Finance — brand portal')
@ApiBearerAuth()
@Controller({ path: 'finance/brand', version: '1' })
export class BrandFinanceController {
  constructor(
    private readonly brandFinance: BrandFinanceService,
    private readonly settlements: SettlementsService,
  ) {}

  @Access({ actors: ['brand', 'staff'], permissions: ['finance.read'] })
  @Get('summary')
  @ApiOperation({ summary: 'Wallet balance, pending COD, fees this month, next settlement date' })
  summary(@CurrentPrincipal() p: Principal, @Query() q: BrandScopeQuery) {
    return this.brandFinance.summary(this.brandFinance.resolveBrand(p, q.brandId));
  }

  @Access({ actors: ['brand', 'staff'], permissions: ['finance.read'] })
  @Get('settlements')
  settlementsList(@CurrentPrincipal() p: Principal, @Query() q: BrandSettlementsQuery) {
    const brandId = this.brandFinance.resolveBrand(p, q.brandId);
    return this.settlements.list({ ...q, brandId }, { brandId, excludeCancelled: true });
  }

  @Access({ actors: ['brand', 'staff'], permissions: ['finance.read'] })
  @Get('settlements/:id')
  settlementDetail(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Query() q: BrandScopeQuery) {
    return this.settlements.detail(id, this.brandFinance.resolveBrand(p, q.brandId));
  }

  @Access({ actors: ['brand', 'staff'], permissions: ['finance.read'] })
  @Get('settlements/:id/export.csv')
  @ApiProduces('text/csv')
  async settlementCsv(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Query() q: BrandScopeQuery, @Res({ passthrough: true }) res: Response) {
    const f = await this.settlements.csv(id, this.brandFinance.resolveBrand(p, q.brandId));
    return sendCsv(res, f.filename, f.content);
  }

  @Access({ actors: ['brand', 'staff'], permissions: ['finance.read'] })
  @Get('statement')
  @ApiOperation({ summary: 'Wallet ledger lines (oldest first) with running balance' })
  statement(@CurrentPrincipal() p: Principal, @Query() q: BrandStatementQuery) {
    return this.brandFinance.statement(this.brandFinance.resolveBrand(p, q.brandId), q);
  }

  @Access({ actors: ['brand', 'staff'], permissions: ['finance.read'] })
  @Get('statement.csv')
  @ApiProduces('text/csv')
  async statementCsv(@CurrentPrincipal() p: Principal, @Query() q: BrandStatementQuery, @Res({ passthrough: true }) res: Response) {
    const brandId = this.brandFinance.resolveBrand(p, q.brandId);
    return sendCsv(res, `statement_${q.from ?? 'last30'}_${q.to ?? 'today'}.csv`, await this.brandFinance.statementCsv(brandId, q));
  }
}

@ApiTags('Finance — reports')
@ApiBearerAuth()
@Controller({ path: 'finance', version: '1' })
export class FinanceReportsController {
  constructor(private readonly reports: FinanceReportsService) {}

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get('trial-balance')
  trialBalance(@Query() q: TrialBalanceQuery) {
    return this.reports.trialBalance(q.includeZero === 'true');
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get('accounts/:code/statement')
  @ApiOperation({ summary: 'Statement of any ledger account, e.g. 1000, 2100:BRAND:<id>, 2200:HERO:<id>' })
  statement(@Param('code') code: string, @Query() q: StatementQuery) {
    return this.reports.accountStatement(code, q);
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get('pnl')
  pnl(@Query() q: DayRangeQuery) {
    return this.reports.pnl(q.from, q.to);
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get('cash-position')
  cashPosition() {
    return this.reports.cashPosition();
  }

  @Access({ actors: ['staff'], permissions: ['finance.read'] })
  @Get('daily')
  daily(@Query() q: DayQuery) {
    return this.reports.daily(q.date);
  }
}
