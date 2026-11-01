import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AttemptDisputeStatus, ConfirmationStatus } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- staff lists

export class HoldsQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'UNCONFIRMED' }) @IsOptional() @IsString() @MaxLength(60) reason?: string;
}

export class ConfirmationsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ConfirmationStatus, description: 'Default: PENDING + NO_RESPONSE' }) @IsOptional() @IsIn(Object.values(ConfirmationStatus)) status?: ConfirmationStatus;
}

export class DisputesQuery extends PageQuery {
  @ApiPropertyOptional({ enum: AttemptDisputeStatus, description: 'Default: DISPUTED (open)' }) @IsOptional() @IsIn(Object.values(AttemptDisputeStatus)) status?: AttemptDisputeStatus;
}

export class HeroIntegrityQuery {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 180 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(180) days?: number;
}

export class NetworkRiskQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['network', 'blocked'], default: 'network', description: 'network = refusals across brands, blocked = blocklist / prepay-only' })
  @IsOptional()
  @IsIn(['network', 'blocked'])
  scope?: 'network' | 'blocked';
  @ApiPropertyOptional({ default: 2, minimum: 1, maximum: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) minBrands?: number;
}

// ---------------------------------------------------------------- staff actions

export class HoldNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CancelHoldDto {
  @ApiProperty({ example: 'Brand asked to cancel: customer unreachable' }) @IsString() @MinLength(3) @MaxLength(500) note!: string;
}

export class OverrideDto {
  @ApiProperty({ example: 'Customer confirmed on a call with the brand' }) @IsString() @MinLength(5) @MaxLength(300) reason!: string;
}

export class RecordConfirmationDto {
  @ApiProperty({ enum: ['CONFIRM', 'RESCHEDULE', 'DECLINE'] }) @IsIn(['CONFIRM', 'RESCHEDULE', 'DECLINE']) action!: 'CONFIRM' | 'RESCHEDULE' | 'DECLINE';
  @ApiPropertyOptional({ example: '2026-11-03' }) @IsOptional() @Matches(DAY, { message: 'date must be YYYY-MM-DD' }) date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: ['UPHELD', 'REJECTED'], description: 'UPHELD = the customer is right (fake attempt)' }) @IsIn(['UPHELD', 'REJECTED']) decision!: 'UPHELD' | 'REJECTED';
  @ApiPropertyOptional({ description: 'PENALTY adjustment for the hero in piasters (UPHELD only)' }) @IsOptional() @IsInt() @Min(0) @Max(100_000) penaltyCents?: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) note!: string;
}

// ---------------------------------------------------------------- customer (tracking page)

export class IntegrityStateQuery {
  @ApiPropertyOptional({ description: 'Signed confirmation token from the message link (?c=)' }) @IsOptional() @IsString() @MaxLength(80) c?: string;
  @ApiPropertyOptional({ description: 'Signed attempt token (?a=)' }) @IsOptional() @IsString() @MaxLength(80) a?: string;
  @ApiPropertyOptional({ description: 'Signed pin token (?p=)' }) @IsOptional() @IsString() @MaxLength(80) p?: string;
}

export class CustomerConfirmationDto {
  @ApiProperty({ enum: ['CONFIRM', 'RESCHEDULE', 'DECLINE'] }) @IsIn(['CONFIRM', 'RESCHEDULE', 'DECLINE']) action!: 'CONFIRM' | 'RESCHEDULE' | 'DECLINE';
  @ApiPropertyOptional({ example: '2026-11-03', description: 'RESCHEDULE: tomorrow … +7 days' }) @IsOptional() @Matches(DAY, { message: 'date must be YYYY-MM-DD' }) date?: string;
  @ApiPropertyOptional({ description: 'Signed token from the message link (not needed with a customer session)' }) @IsOptional() @IsString() @MaxLength(80) token?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class AttemptFeedbackDto {
  @ApiProperty({ enum: ['CONFIRM', 'DISPUTE'], description: 'DISPUTE = "I was available"' }) @IsIn(['CONFIRM', 'DISPUTE']) answer!: 'CONFIRM' | 'DISPUTE';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) attemptId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) token?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class PinDto {
  @ApiProperty() @IsLatitude() lat!: number;
  @ApiProperty() @IsLongitude() lng!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) token?: string;
}

// ---------------------------------------------------------------- hero calls

export class StartCallDto {
  @ApiPropertyOptional({ enum: ['PRIMARY', 'ALT'], default: 'PRIMARY' }) @IsOptional() @IsIn(['PRIMARY', 'ALT']) to?: 'PRIMARY' | 'ALT';
}

export class CallResultDto {
  @ApiProperty({ enum: ['ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED'] }) @IsIn(['ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED']) status!: 'ANSWERED' | 'NO_ANSWER' | 'BUSY' | 'FAILED';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(7200) durationSeconds?: number;
}
