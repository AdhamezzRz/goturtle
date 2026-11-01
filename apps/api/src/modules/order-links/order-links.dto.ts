import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../common/pagination';

/** Order links never take SCHEDULED: the buyer cannot pick a day on the public form. */
export const LINK_SERVICE_LEVELS = ['STANDARD', 'SAME_DAY', 'EXPRESS'] as const;
export type LinkServiceLevel = (typeof LINK_SERVICE_LEVELS)[number];
/** 50,000 EGP — same ceiling as a single COD order. */
export const MAX_LINK_PRICE_CENTS = 5_000_000;

export class OrderLinkItemDto {
  @ApiProperty({ example: 'Linen shirt — size L' })
  @IsString() @MinLength(1) @MaxLength(120) name!: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 999 })
  @Type(() => Number) @IsInt() @Min(1) @Max(999) quantity!: number;

  @ApiProperty({ example: 45000, description: 'Unit price in piasters' })
  @Type(() => Number) @IsInt() @Min(0) @Max(MAX_LINK_PRICE_CENTS) priceCents!: number;
}

export class CreateOrderLinkDto {
  @ApiProperty({ example: 'Summer linen shirt' })
  @IsString() @MinLength(2) @MaxLength(150) title!: string;

  @ApiPropertyOptional({ example: '100% Egyptian linen. Exchange within 14 days.' })
  @IsOptional() @IsString() @MaxLength(1000) description?: string;

  @ApiProperty({ type: [OrderLinkItemDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => OrderLinkItemDto) items!: OrderLinkItemDto[];

  @ApiPropertyOptional({ enum: ['COD', 'PREPAID'], default: 'COD', description: 'COD: the buyer pays the hero. PREPAID: already paid (e.g. InstaPay before sharing the link).' })
  @IsOptional() @IsIn(['COD', 'PREPAID']) paymentMethod?: 'COD' | 'PREPAID';

  @ApiPropertyOptional({ description: 'COD amount in piasters. Default: the items total. Ignored for PREPAID.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_LINK_PRICE_CENTS) codAmountCents?: number;

  @ApiPropertyOptional({ enum: LINK_SERVICE_LEVELS, default: 'STANDARD' })
  @IsOptional() @IsIn(LINK_SERVICE_LEVELS as unknown as string[]) serviceLevel?: LinkServiceLevel;

  @ApiPropertyOptional({ default: 1000, description: 'Parcel weight in grams' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) weightGrams?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean() allowOpening?: boolean;

  @ApiPropertyOptional({ description: 'Shown to the hero on every order from this link' })
  @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Stop accepting orders after this many (null = unlimited)' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(100_000) maxUses?: number | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-12-31T21:59:59.000Z' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() expiresAt?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateOrderLinkDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(150) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ type: [OrderLinkItemDto] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => OrderLinkItemDto) items?: OrderLinkItemDto[];
  @ApiPropertyOptional({ enum: ['COD', 'PREPAID'] }) @IsOptional() @IsIn(['COD', 'PREPAID']) paymentMethod?: 'COD' | 'PREPAID';
  @ApiPropertyOptional({ nullable: true, description: 'null = recompute from the items' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(MAX_LINK_PRICE_CENTS) codAmountCents?: number | null;
  @ApiPropertyOptional({ enum: LINK_SERVICE_LEVELS }) @IsOptional() @IsIn(LINK_SERVICE_LEVELS as unknown as string[]) serviceLevel?: LinkServiceLevel;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) weightGrams?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowOpening?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(100_000) maxUses?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() expiresAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class OrderLinksQueryDto extends PageQuery {
  @ApiPropertyOptional({ description: 'Staff only' })
  @IsOptional() @IsString() @MaxLength(32) brandId?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive']) state?: 'active' | 'inactive';
}

// ------------------------------------------------------------------ public

export class PublicOrderDto {
  @ApiProperty({ example: 'Mona Adel' })
  @IsString() @MinLength(2) @MaxLength(150) name!: string;

  @ApiProperty({ example: '01001234567' })
  @IsString() @MinLength(8) @MaxLength(20) phone!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) altPhone?: string;

  @ApiProperty({ example: '12 Makram Ebeid St, Nasr City' })
  @IsString() @MinLength(5) @MaxLength(500) addressLine!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) building?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) floor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) apartment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) landmark?: string;

  @ApiPropertyOptional({ description: 'Chosen zone (otherwise detected from the address / pin)' })
  @IsOptional() @IsString() @MaxLength(32) zoneId?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(21) @Max(32) lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(24) @Max(37) lng?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @ApiPropertyOptional({ description: 'Honeypot — must stay empty (hidden from humans)' })
  @IsOptional() @IsString() @MaxLength(300) website?: string;
}

export class PublicDetectZoneDto {
  @ApiProperty({ example: 'مدينة نصر، شارع عباس العقاد' })
  @IsString() @MinLength(2) @MaxLength(500) address!: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(21) @Max(32) lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(24) @Max(37) lng?: number;
}

export class PublicQuoteDto {
  @ApiProperty() @IsString() @MaxLength(32) zoneId!: string;
}
