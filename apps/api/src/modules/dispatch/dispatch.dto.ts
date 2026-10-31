import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { RunsheetStatus } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toList = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === '' ? undefined : (Array.isArray(value) ? value : String(value).split(',')).map((v) => String(v).trim()).filter(Boolean);

export class ScanDto {
  @ApiProperty() @IsString() @MaxLength(32) hubId!: string;
  @ApiProperty({ example: 'GT4829150376' }) @IsString() @MinLength(6) @MaxLength(20) trackingNumber!: string;
}

export class OutboundScanDto {
  @ApiProperty() @IsString() @MaxLength(32) runsheetId!: string;
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(20) trackingNumber!: string;
}

export class ReturnHandoverDto {
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(20) trackingNumber!: string;
  @ApiPropertyOptional({ description: 'Brand representative who received the parcel' }) @IsOptional() @IsString() @MaxLength(150) receivedBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class AssignReturnsDto {
  @ApiProperty() @IsString() @MaxLength(32) courierId!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) orderIds!: string[];
}

export class AutoAssignDto {
  @ApiPropertyOptional({ description: 'Only orders at this hub' }) @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional({ description: 'Delivery day (default today, Cairo)' }) @IsOptional() @Matches(DAY) date?: string;
  @ApiPropertyOptional({ type: [String], description: 'Restrict to these orders (must be RECEIVED_AT_HUB)' })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true })
  orderIds?: string[];
  @ApiPropertyOptional({ default: false, description: 'false → return the proposed plan only; true → create/extend DRAFT runsheets' })
  @IsOptional() @IsBoolean()
  commit?: boolean;
}

export class CreateRunsheetDto {
  @ApiProperty() @IsString() @MaxLength(32) courierId!: string;
  @ApiPropertyOptional({ description: 'YYYY-MM-DD, default today' }) @IsOptional() @Matches(DAY) date?: string;
  @ApiPropertyOptional({ description: "Defaults to the hero's home hub" }) @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) orderIds?: string[];
}

export class RunsheetOrdersDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) orderIds!: string[];
}

export class DispatchRunsheetDto {
  @ApiPropertyOptional({ description: 'OPS managers only: dispatch although the hero would exceed the cash limit' }) @IsOptional() @IsBoolean() override?: boolean;
}

export class CloseRunsheetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class RunsheetListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) date?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DAY) to?: string;
  @ApiPropertyOptional({ type: [String], enum: RunsheetStatus }) @IsOptional() @Transform(toList) @IsArray() @IsIn(Object.values(RunsheetStatus), { each: true }) status?: RunsheetStatus[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) courierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
}

export class LiveQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
}
