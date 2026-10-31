import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class RescheduleDto {
  @ApiProperty({ example: '2026-11-03', description: 'Tomorrow … +7 days (Cairo)' }) @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' }) date!: string;
  @ApiPropertyOptional({ example: 'Please come after 5 pm' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateAddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) landmark?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) building?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) floor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) apartment?: string;
  @ApiPropertyOptional({ description: 'Appended to the hero notes' }) @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiPropertyOptional({ description: 'Map pin' }) @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
}

export class RateDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
