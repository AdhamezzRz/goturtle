import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { FailureReason } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';
import { PARTNER_API_TYPES, type PartnerApiType } from './partner-adapters';

export const PARTNER_CODE = /^[A-Z0-9]{2,12}$/;
const GOV_CODE = /^[A-Za-z]{2,10}$/;
const URL_TEMPLATE = /^https:\/\/[^\s]+$/;

export class CreatePartnerDto {
  @ApiProperty({ example: 'BOSTA', description: '2–12 upper-case letters/digits; the virtual hero becomes PT-<CODE>' })
  @IsString() @Matches(PARTNER_CODE, { message: 'code must be 2–12 upper-case letters or digits' }) code!: string;

  @ApiProperty({ example: 'Bosta' })
  @IsString() @MinLength(2) @MaxLength(120) name!: string;

  @ApiPropertyOptional({ enum: PARTNER_API_TYPES, default: 'MANUAL' })
  @IsOptional() @IsIn(PARTNER_API_TYPES as unknown as string[]) apiType?: PartnerApiType;

  @ApiPropertyOptional({ example: 'https://bosta.co/tracking-shipments?shipment-number={tn}', description: 'https URL with {tn} where the partner tracking number goes' })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(300) @Matches(URL_TEMPLATE, { message: 'trackingUrlTemplate must be an https URL' }) trackingUrlTemplate?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['ASW', 'LXR', 'RED'], description: 'Governorate codes the partner covers' })
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @Matches(GOV_CODE, { each: true }) governorateCodes?: string[];

  @ApiPropertyOptional({ nullable: true, description: 'Per-parcel fee owed to the partner for a delivery (piasters). Default: settings platform.partnerFeeCents' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) feeCents?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Fee owed when the partner brings an undeliverable parcel back (piasters). Default 0' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) returnFeeCents?: number | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, description: 'API credentials for adapter partners (stored encrypted, never returned)' })
  @IsOptional() @IsObject() credentials?: Record<string, string>;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional({ enum: PARTNER_API_TYPES }) @IsOptional() @IsIn(PARTNER_API_TYPES as unknown as string[]) apiType?: PartnerApiType;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(300) @Matches(URL_TEMPLATE, { message: 'trackingUrlTemplate must be an https URL' }) trackingUrlTemplate?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @Matches(GOV_CODE, { each: true }) governorateCodes?: string[];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) feeCents?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) returnFeeCents?: number | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, description: 'Merged into the stored credentials; "" clears a field' })
  @IsOptional() @IsObject() credentials?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class HandoffDto {
  @ApiProperty({ type: [String], description: 'Orders at the hub (RECEIVED_AT_HUB)' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(32, { each: true }) orderIds!: string[];

  @ApiPropertyOptional({ type: [String], description: 'Partner tracking numbers, same order as orderIds ("" when not known yet)' })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(60, { each: true }) partnerTrackingNumbers?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export const PARTNER_OUTCOMES = ['DELIVERED', 'FAILED', 'RETURNED'] as const;
export type PartnerOutcome = (typeof PARTNER_OUTCOMES)[number];

export class PartnerStatusUpdateDto {
  @ApiPropertyOptional({ description: 'Order id — or give trackingNumber / partnerTrackingNumber' })
  @IsOptional() @IsString() @MaxLength(32) orderId?: string;

  @ApiPropertyOptional({ description: 'GoTurtle tracking number' })
  @IsOptional() @IsString() @MaxLength(16) trackingNumber?: string;

  @ApiPropertyOptional({ description: 'The partner’s tracking number' })
  @IsOptional() @IsString() @MaxLength(60) partnerTrackingNumber?: string;

  @ApiProperty({ enum: PARTNER_OUTCOMES, description: 'DELIVERED (COD now in partner custody), FAILED (attempt failed, partner retries) or RETURNED (partner brought it back to our hub → return to brand)' })
  @IsIn(PARTNER_OUTCOMES as unknown as string[]) outcome!: PartnerOutcome;

  @ApiPropertyOptional({ enum: Object.values(FailureReason), description: 'FAILED / RETURNED reason (default CUSTOMER_UNREACHABLE)' })
  @IsOptional() @IsIn(Object.values(FailureReason)) reason?: FailureReason;

  @ApiPropertyOptional({ description: 'DELIVERED: piasters the partner collected (default: the amount to collect)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000) collectedCents?: number;

  @ApiPropertyOptional({ description: 'Partner proof / reference (POD number, manifest id …)' })
  @IsOptional() @IsString() @MaxLength(120) partnerReference?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class PartnerStatusBatchDto {
  @ApiProperty({ type: [PartnerStatusUpdateDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PartnerStatusUpdateDto) updates!: PartnerStatusUpdateDto[];
}

export class HandoffQueueQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Only orders whose zone has no active hero (default true)' })
  @IsOptional() @Type(() => String) @IsIn(['true', 'false']) unservedOnly?: 'true' | 'false';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;

  @ApiPropertyOptional({ example: 'ASW' }) @IsOptional() @IsString() @Matches(GOV_CODE) governorate?: string;
}

export class PartnerShipmentsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['active', 'delivered', 'returned', 'all'], default: 'active' })
  @IsOptional() @IsIn(['active', 'delivered', 'returned', 'all']) state?: 'active' | 'delivered' | 'returned' | 'all';
}
