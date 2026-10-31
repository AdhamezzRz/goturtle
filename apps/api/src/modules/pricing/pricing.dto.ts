import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, MaxLength, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { FeesPayer, OrderType, PaymentMethod, PricingTier, ServiceLevel } from '@goturtle/shared';

export class PricingRuleDto {
  @ApiProperty({ enum: PricingTier }) @IsIn(Object.values(PricingTier)) tier!: PricingTier;
  @ApiProperty({ enum: ServiceLevel }) @IsIn(Object.values(ServiceLevel)) serviceLevel!: ServiceLevel;
  @ApiProperty({ description: 'Base shipping fee in piasters', example: 5500 }) @IsInt() @Min(0) @Max(10_000_000) baseFeeCents!: number;
}

export class PricingPlanDto {
  @ApiProperty({ example: 'Enterprise' }) @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional({ description: 'COD fee in basis points of the COD amount (100 = 1%)', default: 100 }) @IsOptional() @IsInt() @Min(0) @Max(2000) codFeeBp?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) codFeeMinCents?: number;
  @ApiPropertyOptional({ default: 3000 }) @IsOptional() @IsInt() @Min(0) @Max(100_000) includedWeightGrams?: number;
  @ApiPropertyOptional({ default: 500 }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) extraKgCents?: number;
  @ApiPropertyOptional({ description: 'Return (RTO) fee as basis points of the shipping fee', default: 5000 }) @IsOptional() @IsInt() @Min(0) @Max(20_000) returnFeeBp?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) exchangeFeeCents?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(2000) insuranceBp?: number;
  @ApiPropertyOptional({ default: 1400 }) @IsOptional() @IsInt() @Min(0) @Max(3000) vatBp?: number;
  @ApiPropertyOptional({ type: [PricingRuleDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(64) @ValidateNested({ each: true }) @Type(() => PricingRuleDto)
  rules?: PricingRuleDto[];
}

export class UpdatePricingPlanDto extends PartialType(OmitType(PricingPlanDto, ['rules'] as const)) {}

export class ReplaceRulesDto {
  @ApiProperty({ type: [PricingRuleDto] })
  @IsArray() @ArrayMaxSize(64) @ValidateNested({ each: true }) @Type(() => PricingRuleDto)
  rules!: PricingRuleDto[];
}

export class QuoteDto {
  @ApiPropertyOptional({ description: 'Zone id; or give an address to detect it' }) @IsOptional() @IsString() @MaxLength(32) zoneId?: string;
  @ApiPropertyOptional({ example: 'مدينة نصر، شارع مكرم عبيد' }) @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional({ enum: ServiceLevel, default: 'STANDARD' }) @IsOptional() @IsIn(Object.values(ServiceLevel)) serviceLevel?: ServiceLevel;
  @ApiPropertyOptional({ enum: OrderType, default: 'DELIVERY' }) @IsOptional() @IsIn(Object.values(OrderType)) type?: OrderType;
  @ApiPropertyOptional({ default: 1000 }) @IsOptional() @IsInt() @Min(0) @Max(100_000) weightGrams?: number;
  @ApiPropertyOptional({ enum: PaymentMethod, default: 'COD' }) @IsOptional() @IsIn(Object.values(PaymentMethod)) paymentMethod?: PaymentMethod;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000) codAmountCents?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(100_000_000) declaredValueCents?: number;
  @ApiPropertyOptional({ enum: FeesPayer, description: "Defaults to the brand's setting" }) @IsOptional() @IsIn(Object.values(FeesPayer)) feesPaidBy?: FeesPayer;
  @ApiPropertyOptional({ description: 'Staff only: price for this brand (otherwise the default plan)' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
}
