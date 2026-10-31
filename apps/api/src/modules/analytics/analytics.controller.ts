import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Access, CurrentPrincipal } from '../../common/decorators';
import { brandScope, type Principal } from '../../common/principal';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRangeDto, EXPORT_REPORTS, type ExportReport } from './analytics.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Access({ actors: ['staff'], permissions: ['analytics.read'] })
  @Get('ops/overview')
  @ApiOperation({ summary: 'Ops dashboard: KPIs, daily series, by-zone, top brands, failure reasons, delivery heatmap' })
  ops(@Query() q: AnalyticsRangeDto) {
    return this.analytics.opsOverview(q);
  }

  @Access({ actors: ['brand', 'apiKey'], permissions: ['analytics.read'] })
  @Get('brand/overview')
  @ApiOperation({ summary: 'Brand dashboard (same shape, scoped to the caller, fees instead of internal revenue)' })
  brand(@CurrentPrincipal() p: Principal, @Query() q: AnalyticsRangeDto) {
    if (q.brandId || q.hubId) throw new BadRequestException('brandId and hubId filters are not available here');
    return this.analytics.brandOverview(brandScope(p)!, q);
  }

  @Access({ actors: ['staff'], permissions: ['analytics.read'] })
  @Get('heroes')
  @ApiOperation({ summary: 'Hero comparison table for the period (deliveries, failures, success rate, COD, earnings)' })
  heroes(@Query() q: AnalyticsRangeDto) {
    return this.analytics.heroes(q);
  }

  @Access({ actors: ['staff', 'brand'], permissions: ['analytics.read'] })
  @Get('export/:report')
  @ApiOperation({ summary: `CSV export: ${EXPORT_REPORTS.join(', ')} (brands: daily, zones, failure-reasons)` })
  async export(@CurrentPrincipal() p: Principal, @Param('report') report: string, @Query() q: AnalyticsRangeDto, @Res({ passthrough: true }) res: Response) {
    if (!(EXPORT_REPORTS as readonly string[]).includes(report)) throw new BadRequestException(`report must be one of ${EXPORT_REPORTS.join(', ')}`);
    const scope = brandScope(p);
    if (scope && (q.brandId || q.hubId)) throw new BadRequestException('brandId and hubId filters are not available here');
    const out = await this.analytics.exportCsv(report as ExportReport, q, scope);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    return out.csv;
  }
}
