import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { HandoverMethod, HandoverStatus, type HandoverMethod as TMethod, type HandoverStatus as TStatus } from '@goturtle/shared';
import { PageQuery } from '../../../common/pagination';
import { DAY_PATTERN } from '../../couriers/workforce.util';
import { FILE_URL_PATTERN } from '../../couriers/dto/couriers.dto';

export class DeclareHandoverDto {
  @ApiProperty({ example: 125000, description: 'Piasters the hero is handing over' })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents!: number;

  @ApiProperty({ enum: Object.values(HandoverMethod) })
  @IsIn(Object.values(HandoverMethod))
  method!: TMethod;

  @ApiPropertyOptional({ description: 'Transfer / wallet transaction id (required for non-cash methods)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ description: 'Receipt screenshot (POST /files?purpose=handover_proof)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(FILE_URL_PATTERN, { message: 'proofUrl must be an uploaded file URL or https URL' })
  proofUrl?: string;

  @ApiPropertyOptional({ description: 'Hub where cash was handed (CASH_AT_HUB; default home hub)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  hubId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class RecordHandoverDto extends DeclareHandoverDto {
  @ApiProperty()
  @IsString()
  @MaxLength(32)
  courierId!: string;
}

export class ConfirmHandoverDto {
  @ApiProperty({ example: 124500, description: 'Piasters actually received (variance = received − declared)' })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  receivedCents!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class RejectHandoverDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ShortageDto {
  @ApiProperty()
  @IsString()
  @MaxLength(32)
  courierId!: string;

  @ApiPropertyOptional({ description: 'Default: the hero’s outstanding shortage (negative variances not yet converted)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents?: number;

  @ApiProperty({ example: 'Shortage on HO-000031' })
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  reason!: string;
}

export class ListHandoversQuery extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(HandoverStatus) })
  @IsOptional()
  @IsIn(Object.values(HandoverStatus))
  status?: TStatus;

  @ApiPropertyOptional({ enum: Object.values(HandoverMethod) })
  @IsOptional()
  @IsIn(Object.values(HandoverMethod))
  method?: TMethod;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) courierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DAY_PATTERN) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DAY_PATTERN) to?: string;
}

export const CUSTODY_SORTS = ['cash', 'usedPct', 'oldest', 'code', 'name'] as const;

export class CustodyQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  @IsOptional()
  @IsIn(['true', 'false'])
  onlyWithCash?: 'true' | 'false';

  @ApiPropertyOptional({ enum: CUSTODY_SORTS, default: 'cash' })
  @IsOptional()
  @IsIn(CUSTODY_SORTS)
  sort?: (typeof CUSTODY_SORTS)[number];
}

export class HubSummaryQuery {
  @ApiPropertyOptional({ example: '2026-10-30', description: 'Cairo day (default today)' })
  @IsOptional()
  @Matches(DAY_PATTERN)
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
}
