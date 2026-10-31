import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsLatitude, IsLongitude, IsNumber, IsOptional, Matches, Max, Min,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../../common/pagination';
import { DAY_PATTERN } from '../../couriers/workforce.util';

export class AvailabilityDto {
  @ApiProperty({ enum: ['ONLINE', 'OFFLINE', 'ON_BREAK'] })
  @IsIn(['ONLINE', 'OFFLINE', 'ON_BREAK'])
  availability!: 'ONLINE' | 'OFFLINE' | 'ON_BREAK';
}

export class LocationPointDto {
  @ApiProperty({ example: 30.0566 }) @IsLatitude() lat!: number;
  @ApiProperty({ example: 31.3372 }) @IsLongitude() lng!: number;
  @ApiPropertyOptional({ description: 'Metres (points worse than 200 m are ignored)' }) @IsOptional() @IsNumber() @Min(0) @Max(100_000) accuracy?: number;
  @ApiPropertyOptional({ description: 'm/s' }) @IsOptional() @IsNumber() @Min(0) @Max(100) speed?: number;
  @ApiPropertyOptional({ description: 'Degrees' }) @IsOptional() @IsNumber() @Min(0) @Max(360) heading?: number;
  @ApiPropertyOptional({ description: '0–100 %' }) @IsOptional() @IsInt() @Min(0) @Max(100) battery?: number;
  @ApiPropertyOptional({ description: 'Device time of the fix (default: now)' }) @IsOptional() @IsISO8601() recordedAt?: string;
}

export class LocationBatchDto {
  @ApiProperty({ type: [LocationPointDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LocationPointDto)
  points!: LocationPointDto[];
}

export class HeroRangeQuery extends PageQuery {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DAY_PATTERN, { message: 'from must be YYYY-MM-DD' }) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DAY_PATTERN, { message: 'to must be YYYY-MM-DD' }) to?: string;
}

export class HeroShiftsQuery {
  @ApiPropertyOptional({ example: '2026-11-01' }) @IsOptional() @Matches(DAY_PATTERN) from?: string;
  @ApiPropertyOptional({ example: '2026-11-07' }) @IsOptional() @Matches(DAY_PATTERN) to?: string;
}

export class HeroLeaderboardQuery {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'week' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  period: 'day' | 'week' | 'month' = 'week';
}
