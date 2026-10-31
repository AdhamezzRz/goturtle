import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PickupStatus } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toList = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === '' ? undefined : (Array.isArray(value) ? value : String(value).split(',')).map((v) => String(v).trim()).filter(Boolean);

export class RequestPickupDto {
  @ApiPropertyOptional({ description: 'Staff only: brand to request for' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
  @ApiPropertyOptional({ description: 'Defaults to the brand default location' }) @IsOptional() @IsString() @MaxLength(32) locationId?: string;
  @ApiProperty({ example: '2026-11-01', description: 'Cairo business day (today … +14 days)' }) @Matches(DAY, { message: 'scheduledDate must be YYYY-MM-DD' }) scheduledDate!: string;
  @ApiPropertyOptional({ example: '10:00-14:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, { message: 'timeWindow must look like 10:00-14:00' })
  timeWindow?: string;
  @ApiPropertyOptional({ description: 'Parcels the brand expects to hand over' }) @IsOptional() @IsInt() @Min(0) @Max(5000) expectedCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class AssignPickupDto {
  @ApiProperty() @IsString() @MaxLength(32) courierId!: string;
}

export class CancelPickupDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class PickupListQuery extends PageQuery {
  @ApiPropertyOptional({ type: [String], enum: PickupStatus }) @IsOptional() @Transform(toList) @IsArray() @IsIn(Object.values(PickupStatus), { each: true }) status?: PickupStatus[];
  @ApiPropertyOptional({ description: 'Staff only' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) courierId?: string;
  @ApiPropertyOptional({ description: 'Hub of the pickup location zone' }) @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) to?: string;
}

export class PickupScanDto {
  @ApiProperty({ example: 'GT4829150376' }) @IsString() @MinLength(6) @MaxLength(20) trackingNumber!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) lng?: number;
}

export class CompletePickupDto {
  @ApiPropertyOptional({ type: [String], description: 'Tracking numbers scanned offline (scanned on top of earlier scans)' })
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) @MaxLength(20, { each: true })
  trackingNumbers?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class FailPickupDto {
  @ApiProperty({ example: 'Warehouse closed' }) @IsString() @MinLength(3) @MaxLength(1000) note!: string;
}
