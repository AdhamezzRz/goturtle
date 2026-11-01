import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ClaimStatus, ClaimType, type ClaimStatus as TClaimStatus, type ClaimType as TClaimType } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';

const EVIDENCE_URL = /^(\/api\/v1\/files\/|https:\/\/)\S+$/;

export class CreateClaimDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) orderId?: string;
  @ApiPropertyOptional({ description: 'Alternative to orderId' }) @IsOptional() @IsString() @MaxLength(20) trackingNumber?: string;
  @ApiProperty({ enum: Object.values(ClaimType) }) @IsIn(Object.values(ClaimType)) type!: TClaimType;
  @ApiProperty({ example: 75000, description: 'Amount claimed in piasters' }) @IsInt() @Min(100) @Max(100_000_000) claimedCents!: number;
  @ApiProperty({ example: 'The box arrived crushed and the vase inside was broken.' }) @IsString() @MinLength(10) @MaxLength(2000) description!: string;
  @ApiPropertyOptional({ type: [String], description: 'Uploaded file URLs (/api/v1/files/…)' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(EVIDENCE_URL, { each: true, message: 'evidence must be uploaded file URLs' }) evidence?: string[];
}

export class ListClaimsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(ClaimStatus) }) @IsOptional() @IsIn(Object.values(ClaimStatus)) status?: TClaimStatus;
  @ApiPropertyOptional({ enum: Object.values(ClaimType) }) @IsOptional() @IsIn(Object.values(ClaimType)) type?: TClaimType;
  @ApiPropertyOptional({ description: 'Staff only' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) orderId?: string;
}

export class ApproveClaimDto {
  @ApiProperty({ description: 'Amount to pay (≤ liability cap)' }) @IsInt() @Min(1) @Max(100_000_000) approvedCents!: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) decisionNote!: string;
  @ApiPropertyOptional({ description: 'Charge the responsible hero (PENALTY adjustment, ≤ approvedCents)' }) @IsOptional() @IsInt() @Min(0) @Max(100_000_000) chargeHeroCents?: number;
  @ApiPropertyOptional({ description: 'Hero held responsible (default: the order’s hero)' }) @IsOptional() @IsString() @MaxLength(32) courierId?: string;
}

export class RejectClaimDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) note!: string;
}

export class ClaimNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
