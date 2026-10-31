import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min,
  MinLength, ValidateNested,
} from 'class-validator';
import {
  CourierAvailability, CourierStatus, DocumentType, EmploymentType, VehicleType,
  type CourierAvailability as TAvailability, type CourierStatus as TStatus, type DocumentType as TDocType,
  type EmploymentType as TEmployment, type VehicleType as TVehicle,
} from '@goturtle/shared';
import { PageQuery } from '../../../common/pagination';
import { DAY_PATTERN } from '../workforce.util';

export const FILE_URL_PATTERN = /^(\/api\/v1\/files\/[a-z_]+\/\d{4}-\d{2}\/[a-z0-9]+\.[a-z]+|https:\/\/[^\s]+)$/;

export class ZoneAssignmentDto {
  @ApiProperty()
  @IsString()
  @MaxLength(32)
  zoneId!: string;

  @ApiPropertyOptional({ description: 'Exactly one zone may be primary; the first one is used when none is flagged' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class EmergencyContactDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '01012345678' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ example: 'Brother' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  relation?: string;
}

export class BankDetailsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) iban?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) accountName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) instapayAddress?: string;
}

export class CreateCourierDto {
  @ApiProperty({ example: 'Omar Hamdy' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '01098765432', description: 'Egyptian mobile; becomes the login identifier' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(191)
  email?: string;

  @ApiPropertyOptional({ enum: ['ar', 'en'], default: 'ar' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  locale?: 'ar' | 'en';

  @ApiProperty({ enum: Object.values(EmploymentType) })
  @IsIn(Object.values(EmploymentType))
  employmentType!: TEmployment;

  @ApiPropertyOptional({ enum: Object.values(VehicleType), default: 'MOTORCYCLE' })
  @IsOptional()
  @IsIn(Object.values(VehicleType))
  vehicleType?: TVehicle;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) vehiclePlate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) licenseNumber?: string;

  @ApiPropertyOptional({ example: '2028-05-31' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: 'licenseExpiry must be YYYY-MM-DD' })
  licenseExpiry?: string;

  @ApiPropertyOptional({ example: '29501011234567', description: 'Egyptian national ID (14 digits); date of birth is derived from it' })
  @IsOptional()
  @Matches(/^\d{14}$/, { message: 'nationalId must be exactly 14 digits' })
  nationalId?: string;

  @ApiPropertyOptional({ example: '1995-01-01' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: 'dateOfBirth must be YYYY-MM-DD' })
  dateOfBirth?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) homeHubId?: string;

  @ApiPropertyOptional({ type: [ZoneAssignmentDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ZoneAssignmentDto)
  @ArrayMaxSize(20)
  zones?: ZoneAssignmentDto[];

  @ApiPropertyOptional({ description: 'Piasters per delivery (defaults by employment type)' })
  @IsOptional() @IsInt() @Min(0) @Max(100_000) perDeliveryRateCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) perPickupRateCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) failedAttemptRateCents?: number;
  @ApiPropertyOptional({ description: 'Required (> 0) for SHIFT heroes' })
  @IsOptional() @IsInt() @Min(0) @Max(100_000) hourlyRateCents?: number;
  @ApiPropertyOptional({ description: 'FULL_TIME heroes' })
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) monthlySalaryCents?: number;
  @ApiPropertyOptional({ description: 'Max cash custody in piasters' })
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) cashLimitCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(200) maxActiveOrders?: number;

  @ApiPropertyOptional({ description: 'Vodafone Cash / InstaPay phone for payouts' })
  @IsOptional() @IsString() @MaxLength(20) walletPhone?: string;

  @ApiPropertyOptional({ type: BankDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankDetailsDto)
  bankDetails?: BankDetailsDto;

  @ApiPropertyOptional({ type: EmergencyContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmergencyContactDto)
  emergencyContact?: EmergencyContactDto;

  @ApiPropertyOptional({ description: 'Activate immediately instead of PENDING_ONBOARDING', default: false })
  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}

export class UpdateCourierDto extends PartialType(OmitType(CreateCourierDto, ['activate'] as const)) {}

export const COURIER_SORTS = ['code', 'name', 'xp', 'rating', 'cashOnHand', 'lastSeenAt', 'joinedAt'] as const;

export class ListCouriersQuery extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(CourierStatus) })
  @IsOptional()
  @IsIn(Object.values(CourierStatus))
  status?: TStatus;

  @ApiPropertyOptional({ enum: Object.values(CourierAvailability) })
  @IsOptional()
  @IsIn(Object.values(CourierAvailability))
  availability?: TAvailability;

  @ApiPropertyOptional({ enum: Object.values(EmploymentType) })
  @IsOptional()
  @IsIn(Object.values(EmploymentType))
  employmentType?: TEmployment;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) zoneId?: string;

  @ApiPropertyOptional({ enum: COURIER_SORTS, default: 'code' })
  @IsOptional()
  @IsIn(COURIER_SORTS)
  sort?: (typeof COURIER_SORTS)[number];
}

export class StatusReasonDto {
  @ApiProperty({ example: 'Repeated cash shortages' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ActivateCourierDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateDocumentDto {
  @ApiProperty({ enum: Object.values(DocumentType) })
  @IsIn(Object.values(DocumentType))
  type!: TDocType;

  @ApiProperty({ description: 'URL returned by POST /files (purpose=courier_document) or an https URL' })
  @IsString()
  @MaxLength(500)
  @Matches(FILE_URL_PATTERN, { message: 'url must be an uploaded file URL (/api/v1/files/…) or https URL' })
  url!: string;

  @ApiPropertyOptional({ example: '2027-12-31T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class ReviewDocumentDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'Required when rejecting' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Set/override the expiry while reviewing' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class ExpiringQuery {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}

export class LiveQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;

  @ApiPropertyOptional({ enum: Object.values(CourierAvailability) })
  @IsOptional()
  @IsIn(Object.values(CourierAvailability))
  availability?: TAvailability;

  @ApiPropertyOptional({ description: 'Only heroes seen since this instant (pass the previous serverTime)' })
  @IsOptional()
  @IsISO8601()
  since?: string;
}

export class TrackQuery {
  @ApiPropertyOptional({ example: '2026-10-30', description: 'Cairo day (default today)' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

export class LeaderboardQuery {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'week' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  period: 'day' | 'week' | 'month' = 'week';

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
}
