import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsLatitude, IsLongitude, IsOptional,
  IsString, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { ShiftStatus, type ShiftStatus as TShiftStatus } from '@goturtle/shared';
import { DAY_PATTERN, HHMM_PATTERN } from '../../couriers/workforce.util';

export class CreateShiftTemplateDto {
  @ApiProperty({ example: 'Morning' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '09:00', description: 'Cairo wall-clock time' })
  @Matches(HHMM_PATTERN, { message: 'startTime must be HH:MM' })
  startTime!: string;

  @ApiProperty({ example: '17:00', description: 'Earlier than startTime = overnight shift ending the next day' })
  @Matches(HHMM_PATTERN, { message: 'endTime must be HH:MM' })
  endTime!: string;

  @ApiProperty({ example: [0, 1, 2, 3, 4], description: '0 = Sunday … 6 = Saturday' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek!: number[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) zoneId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  requiredCouriers?: number;

  @ApiPropertyOptional({ description: 'Overrides the hero’s hourly rate (piasters)', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  hourlyRateCents?: number | null;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  breakMinutes?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateShiftTemplateDto extends PartialType(CreateShiftTemplateDto) {}

export class GenerateShiftsDto {
  @ApiProperty()
  @IsString()
  @MaxLength(32)
  templateId!: string;

  @ApiProperty({ example: '2026-11-01' })
  @Matches(DAY_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @ApiProperty({ example: '2026-11-07' })
  @Matches(DAY_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  courierIds!: string[];
}

export class CreateShiftDto {
  @ApiProperty() @IsString() @MaxLength(32) courierId!: string;
  @ApiProperty({ example: '2026-11-01T07:00:00.000Z' }) @IsISO8601() startAt!: string;
  @ApiProperty({ example: '2026-11-01T15:00:00.000Z' }) @IsISO8601() endAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) zoneId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) templateId?: string;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @IsInt() @Min(0) @Max(240) breakMinutes?: number;
  @ApiPropertyOptional({ description: 'Defaults to the hero’s hourly rate' }) @IsOptional() @IsInt() @Min(0) @Max(100_000) hourlyRateCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateShiftDto extends PartialType(CreateShiftDto) {}

export class CancelShiftDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ListShiftsQuery {
  @ApiPropertyOptional({ example: '2026-11-01', description: 'Cairo day (default: start of this week)' })
  @IsOptional()
  @Matches(DAY_PATTERN)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-07' })
  @IsOptional()
  @Matches(DAY_PATTERN)
  to?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) courierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) templateId?: string;

  @ApiPropertyOptional({ enum: Object.values(ShiftStatus) })
  @IsOptional()
  @IsIn(Object.values(ShiftStatus))
  status?: TShiftStatus;
}

export class CoverageQuery {
  @ApiPropertyOptional({ example: '2026-11-01' }) @IsOptional() @Matches(DAY_PATTERN) from?: string;
  @ApiPropertyOptional({ example: '2026-11-07' }) @IsOptional() @Matches(DAY_PATTERN) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
}

export class ClockDto {
  @ApiProperty({ example: 30.0566 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 31.3372 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

/** Hub staff recording attendance on a hero's behalf. */
export class StaffClockDto {
  @ApiPropertyOptional({ description: 'When it happened (default now)' }) @IsOptional() @IsISO8601() at?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}
