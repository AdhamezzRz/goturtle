import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import {
  AdvanceStatus, AdvanceType, CollectionMethod, CollectionStatus, PayoutMethod, WeightDisputeStatus,
  type AdvanceStatus as TAdvanceStatus, type AdvanceType as TAdvanceType, type CollectionMethod as TCollectionMethod,
  type CollectionStatus as TCollectionStatus, type PayoutMethod as TPayoutMethod, type WeightDisputeStatus as TWeightDisputeStatus,
} from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';
import { DAY_PATTERN } from '../couriers/workforce.util';

/** Uploaded file URLs (/api/v1/files/…) or https links. */
export const EVIDENCE_URL = /^(\/api\/v1\/files\/|https:\/\/)\S+$/;

// ------------------------------------------------------------------ digital collections

export class ListCollectionsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(CollectionStatus) }) @IsOptional() @IsIn(Object.values(CollectionStatus)) status?: TCollectionStatus;
  @ApiPropertyOptional({ enum: Object.values(CollectionMethod) }) @IsOptional() @IsIn(Object.values(CollectionMethod)) method?: TCollectionMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) courierId?: string;
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Delivered on/after (Cairo day)' }) @IsOptional() @Matches(DAY_PATTERN, { message: 'from must be YYYY-MM-DD' }) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31', description: 'Delivered on/before (Cairo day)' }) @IsOptional() @Matches(DAY_PATTERN, { message: 'to must be YYYY-MM-DD' }) to?: string;
}

export class ConfirmCollectionDto {
  @ApiPropertyOptional({ description: 'Bank statement line reference' }) @IsOptional() @IsString() @MaxLength(120) bankReference?: string;
}

export class RejectCollectionDto {
  @ApiProperty({ example: 'No matching transfer on the bank statement of 30 Oct' }) @IsString() @MinLength(3) @MaxLength(500) note!: string;
}

export class BulkConfirmCollectionsDto {
  @ApiProperty({ type: [String], description: 'Transfer references pasted from the bank statement' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(120, { each: true }) references!: string[];
  @ApiPropertyOptional({ description: 'Statement / batch reference stored on every confirmation' }) @IsOptional() @IsString() @MaxLength(120) bankReference?: string;
}

// ------------------------------------------------------------------ advances

export class AdvanceEligibilityQuery {
  @ApiPropertyOptional({ description: 'Staff: the brand to look at' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
  @ApiPropertyOptional({ description: 'Amount to preview fees for (piasters)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000) amountCents?: number;
}

export class RequestAdvanceDto {
  @ApiProperty({ enum: Object.values(AdvanceType) }) @IsIn(Object.values(AdvanceType)) type!: TAdvanceType;
  @ApiProperty({ example: 500000, description: 'Amount to receive (piasters); the fee is added on top' }) @IsInt() @Min(1) @Max(1_000_000_000) amountCents!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class ListAdvancesQuery extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(AdvanceStatus) }) @IsOptional() @IsIn(Object.values(AdvanceStatus)) status?: TAdvanceStatus;
  @ApiPropertyOptional({ enum: Object.values(AdvanceType) }) @IsOptional() @IsIn(Object.values(AdvanceType)) type?: TAdvanceType;
  @ApiPropertyOptional({ description: 'Staff only' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
}

export class PayAdvanceDto {
  @ApiPropertyOptional({ enum: Object.values(PayoutMethod), description: 'Default: the brand’s payout method' }) @IsOptional() @IsIn(Object.values(PayoutMethod)) method?: TPayoutMethod;
  @ApiProperty({ example: 'INSTAPAY-REF-8812' }) @IsString() @MinLength(2) @MaxLength(120) reference!: string;
}

export class AdvanceNoteDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) note!: string;
}

export class OptionalNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

// ------------------------------------------------------------------ weighing

export class DimensionsDto {
  @ApiProperty({ example: 40 }) @IsInt() @Min(1) @Max(300) l!: number;
  @ApiProperty({ example: 30 }) @IsInt() @Min(1) @Max(300) w!: number;
  @ApiProperty({ example: 20 }) @IsInt() @Min(1) @Max(300) h!: number;
}

export class WeighDto {
  @ApiProperty({ example: 'GT4829150376' }) @IsString() @MinLength(6) @MaxLength(20) trackingNumber!: string;
  @ApiProperty({ example: 2350, description: 'Scale reading in grams' }) @IsInt() @Min(1) @Max(100_000) weightGrams!: number;
  @ApiPropertyOptional({ type: DimensionsDto, description: 'Parcel size in cm (volumetric weight)' })
  @IsOptional() @ValidateNested() @Type(() => DimensionsDto) dimensionsCm?: DimensionsDto;
}

export class WeightDisputeDto {
  @ApiProperty() @IsString() @MaxLength(32) orderId!: string;
  @ApiProperty({ example: 'Our scale shows 1.2 kg — photo attached' }) @IsString() @MinLength(5) @MaxLength(2000) note!: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(EVIDENCE_URL, { each: true, message: 'evidence must be uploaded file URLs' }) evidence?: string[];
}

export class ResolveWeightDisputeDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REVERSED'], description: 'ACCEPTED keeps the adjustment, REVERSED refunds it exactly' }) @IsIn(['ACCEPTED', 'REVERSED']) decision!: 'ACCEPTED' | 'REVERSED';
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) note!: string;
}

export class ListWeightQuery extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(WeightDisputeStatus) }) @IsOptional() @IsIn(Object.values(WeightDisputeStatus)) status?: TWeightDisputeStatus;
  @ApiPropertyOptional({ description: 'Staff only' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
}
