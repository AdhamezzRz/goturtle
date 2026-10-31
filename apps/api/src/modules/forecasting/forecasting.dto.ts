import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { DAY_PATTERN } from '../couriers/workforce.util';

export class DemandQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01', description: 'Cairo day (default: 14 days ago)' })
  @IsOptional() @IsString() @Matches(DAY_PATTERN) from?: string;

  @ApiPropertyOptional({ example: '2026-11-30', description: 'Cairo day, inclusive (default: 14 days ahead); at most 92 days per request' })
  @IsOptional() @IsString() @Matches(DAY_PATTERN) to?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;

  @ApiPropertyOptional({ enum: ['hub', 'zone'], default: 'hub', description: 'Breakdown of `groups` (staffing needs hub)' })
  @IsOptional() @IsIn(['hub', 'zone']) by?: 'hub' | 'zone';
}

export class AccuracyQueryDto {
  @ApiPropertyOptional({ default: 4, minimum: 1, maximum: 8 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8) weeks?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
}
