import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Permission } from '@goturtle/shared';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import { isStaff, type Principal } from '../../common/principal';
import { requireAnyPermission } from '../orders/ops-kit';
import { PricingService } from './pricing.service';
import { PricingPlanDto, PricingRuleDto, QuoteDto, ReplaceRulesDto, UpdatePricingPlanDto } from './pricing.dto';

const READ_PERMS: Permission[] = ['pricing.manage', 'finance.read', 'network.read'];
const CanManage = () => Access({ actors: ['staff'], permissions: ['pricing.manage'] });

@ApiTags('Pricing')
@ApiBearerAuth()
@Controller({ path: 'pricing', version: '1' })
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Access({ actors: ['staff', 'brand', 'apiKey'] })
  @Post('quote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fee quote for a shipment (brand-scoped; staff may pass brandId)' })
  quote(@Body() dto: QuoteDto, @CurrentPrincipal() p: Principal) {
    return this.pricing.quoteFor(dto, p);
  }

  @Access({ actors: ['staff', 'brand', 'apiKey'] })
  @Get('rate-card')
  @ApiQuery({ name: 'brandId', required: false, description: 'Staff only' })
  @ApiOperation({ summary: "The caller's rate card (brand) or any brand's / the default card (staff)" })
  rateCard(@CurrentPrincipal() p: Principal, @Query('brandId') brandId?: string) {
    if (isStaff(p)) requireAnyPermission(p, READ_PERMS);
    return this.pricing.rateCardView(p, brandId);
  }

  @Access({ actors: ['staff'] })
  @Get('plans')
  plans(@CurrentPrincipal() p: Principal) {
    requireAnyPermission(p, READ_PERMS);
    return this.pricing.listPlans();
  }

  @Access({ actors: ['staff'] })
  @Get('plans/:id')
  plan(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    requireAnyPermission(p, READ_PERMS);
    return this.pricing.getPlan(id);
  }

  @CanManage()
  @Post('plans')
  create(@Body() dto: PricingPlanDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.pricing.createPlan(dto, p, meta);
  }

  @CanManage()
  @Patch('plans/:id')
  update(@Param('id') id: string, @Body() dto: UpdatePricingPlanDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.pricing.updatePlan(id, dto, p, meta);
  }

  @CanManage()
  @Delete('plans/:id')
  remove(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.pricing.deletePlan(id, p, meta);
  }

  @CanManage()
  @Put('plans/:id/rules')
  @ApiOperation({ summary: 'Replace all rules of a plan (tier × service level grid)' })
  replaceRules(@Param('id') id: string, @Body() dto: ReplaceRulesDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.pricing.replaceRules(id, dto.rules, p, meta);
  }

  @CanManage()
  @Post('plans/:id/rules')
  @ApiOperation({ summary: 'Create or update one rule (unique per tier + service level)' })
  upsertRule(@Param('id') id: string, @Body() dto: PricingRuleDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.pricing.upsertRule(id, dto, p, meta);
  }

  @CanManage()
  @Delete('rules/:ruleId')
  deleteRule(@Param('ruleId') ruleId: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.pricing.deleteRule(ruleId, p, meta);
  }
}
