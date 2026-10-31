import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength,
  Min, MinLength,
} from 'class-validator';
import {
  AdjustmentType, PayoutMethod, PayoutStatus, SettlementStatus,
  type AdjustmentType as TAdjustment, type PayoutMethod as TPayoutMethod, type PayoutStatus as TPayoutStatus,
  type SettlementStatus as TSettlementStatus,
} from '@goturtle/shared';
import { PageQuery } from '../../../common/pagination';
import { DAY_PATTERN } from '../../couriers/workforce.util';

export class DayRangeQuery {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Cairo day (inclusive)' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Cairo day (inclusive)' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class PagedDayRangeQuery extends PageQuery {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class DayQuery {
  @ApiPropertyOptional({ example: '2026-10-30', description: 'Cairo day (default today)' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

// ------------------------------------------------------------- settlements

export class GenerateSettlementsDto {
  @ApiPropertyOptional({ description: 'Only this brand (default: every active brand)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  brandId?: string;

  @ApiPropertyOptional({ description: 'Include orders finalised up to this instant (default now)' })
  @IsOptional()
  @IsISO8601()
  periodEnd?: string;
}

export class ListSettlementsQuery extends PagedDayRangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) brandId?: string;

  @ApiPropertyOptional({ enum: Object.values(SettlementStatus) })
  @IsOptional()
  @IsIn(Object.values(SettlementStatus))
  status?: TSettlementStatus;
}

export class PaySettlementDto {
  @ApiPropertyOptional({ enum: Object.values(PayoutMethod), description: 'Default: the brand’s payout method' })
  @IsOptional()
  @IsIn(Object.values(PayoutMethod))
  method?: TPayoutMethod;

  @ApiProperty({ example: 'INSTAPAY-REF-55821' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  paymentReference!: string;
}

export class ReasonDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class BrandScopeQuery {
  @ApiPropertyOptional({ description: 'Staff only: which brand to view' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  brandId?: string;
}

export class BrandStatementQuery extends PagedDayRangeQuery {
  @ApiPropertyOptional({ description: 'Staff only: which brand to view' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  brandId?: string;
}

export class BrandSettlementsQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Staff only: which brand to view' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  brandId?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'APPROVED', 'PAID'] })
  @IsOptional()
  @IsIn(['DRAFT', 'APPROVED', 'PAID'])
  status?: 'DRAFT' | 'APPROVED' | 'PAID';
}

// ----------------------------------------------------------------- payroll

export class GeneratePayoutsDto {
  @ApiPropertyOptional({ type: [String], description: 'Default: every hero with a positive payable balance' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  courierIds?: string[];

  @ApiProperty({ example: '2026-10-01', description: 'Cairo day (inclusive)' })
  @Matches(DAY_PATTERN, { message: 'periodStart must be YYYY-MM-DD' })
  periodStart!: string;

  @ApiProperty({ example: '2026-10-31', description: 'Cairo day (inclusive)' })
  @Matches(DAY_PATTERN, { message: 'periodEnd must be YYYY-MM-DD' })
  periodEnd!: string;

  @ApiPropertyOptional({ default: false, description: 'Post the prorated monthly salary of FULL_TIME heroes for the period' })
  @IsOptional()
  @IsBoolean()
  includeSalary?: boolean;
}

export class ListPayoutsQuery extends PagedDayRangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) courierId?: string;

  @ApiPropertyOptional({ enum: Object.values(PayoutStatus) })
  @IsOptional()
  @IsIn(Object.values(PayoutStatus))
  status?: TPayoutStatus;
}

export class PayPayoutDto {
  @ApiProperty({ enum: Object.values(PayoutMethod) })
  @IsIn(Object.values(PayoutMethod))
  method!: TPayoutMethod;

  @ApiPropertyOptional({ example: 'VFC-778812' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentReference?: string;
}

// ------------------------------------------------------------- adjustments

export class CreateAdjustmentDto {
  @ApiProperty() @IsString() @MaxLength(32) courierId!: string;

  @ApiProperty({ enum: Object.values(AdjustmentType) })
  @IsIn(Object.values(AdjustmentType))
  type!: TAdjustment;

  @ApiProperty({ example: 5000, description: 'Positive piasters; the type gives the direction' })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountCents!: number;

  @ApiProperty({ example: 'Top hero of the week' })
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  reason!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) orderId?: string;
}

export class ListAdjustmentsQuery extends PagedDayRangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) courierId?: string;

  @ApiPropertyOptional({ enum: Object.values(AdjustmentType) })
  @IsOptional()
  @IsIn(Object.values(AdjustmentType))
  type?: TAdjustment;

  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Only adjustments not yet linked to a payout' })
  @IsOptional()
  @IsIn(['true', 'false'])
  unpaid?: 'true' | 'false';
}

// ----------------------------------------------------------------- reports

export class TrialBalanceQuery {
  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false', description: 'Include accounts without any entries' })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeZero?: 'true' | 'false';
}

export class StatementQuery extends PagedDayRangeQuery {}

export class LimitQuery {
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
