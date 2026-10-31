import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsRangeDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'First Cairo business day (inclusive). Default: 29 days before `to`' })
  @IsOptional()
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-30', description: 'Last Cairo business day (inclusive). Default: today' })
  @IsOptional()
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ description: 'Staff: limit to orders handled by this hub' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  hubId?: string;

  @ApiPropertyOptional({ description: 'Staff: limit to one brand' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  brandId?: string;
}

export const EXPORT_REPORTS = ['daily', 'zones', 'brands', 'heroes', 'failure-reasons'] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];
