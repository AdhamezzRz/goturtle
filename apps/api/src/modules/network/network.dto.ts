import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString,
  Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { PricingTier } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';

const CODE = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;
const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value);

export class GovernorateDto {
  @ApiProperty({ example: 'ALX' }) @IsString() @Matches(/^[A-Z]{2,10}$/, { message: 'code must be 2-10 upper-case letters' }) code!: string;
  @ApiProperty({ example: 'Alexandria' }) @IsString() @MinLength(2) @MaxLength(100) nameEn!: string;
  @ApiProperty({ example: 'الإسكندرية' }) @IsString() @MinLength(2) @MaxLength(100) nameAr!: string;
}
export class UpdateGovernorateDto extends PartialType(GovernorateDto) {}

export class CityDto {
  @ApiProperty() @IsString() @MaxLength(32) governorateId!: string;
  @ApiProperty({ example: 'ALX' }) @IsString() @Matches(CODE, { message: 'code must be upper-case letters, digits, - or _' }) code!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) nameEn!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) nameAr!: string;
}
export class UpdateCityDto extends PartialType(CityDto) {}

export class HubDto {
  @ApiProperty({ example: 'HUB-ALX' }) @IsString() @Matches(CODE, { message: 'code must be upper-case letters, digits, - or _' }) code!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) nameAr?: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(300) address!: string;
  @ApiProperty() @IsLatitude() lat!: number;
  @ApiProperty() @IsLongitude() lng!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateHubDto extends PartialType(HubDto) {}

export class GeoPolygonDto {
  @ApiProperty({ enum: ['Polygon'] }) @IsIn(['Polygon']) type!: 'Polygon';
  @ApiProperty({ description: 'GeoJSON rings of [lng, lat] pairs; the first ring is the outer boundary', type: 'array', items: { type: 'array' } })
  @IsArray()
  coordinates!: Array<Array<[number, number]>>;
}

export class ZoneDto {
  @ApiProperty({ example: 'CAI-NASR' }) @IsString() @Matches(CODE, { message: 'code must be upper-case letters, digits, - or _' }) code!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) nameEn!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) nameAr!: string;
  @ApiProperty() @IsString() @MaxLength(32) cityId!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(32) hubId?: string | null;
  @ApiPropertyOptional({ enum: PricingTier, default: 'A' }) @IsOptional() @IsIn(Object.values(PricingTier)) tier?: PricingTier;
  @ApiPropertyOptional({ type: [String], description: 'Arabic / English / Franco aliases used by the address parser' })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(100, { each: true })
  keywords?: string[];
  @ApiPropertyOptional({ type: GeoPolygonDto, nullable: true }) @IsOptional() @IsObject() polygon?: GeoPolygonDto | null;
  @ApiProperty() @IsLatitude() centerLat!: number;
  @ApiProperty() @IsLongitude() centerLng!: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ default: 24 }) @IsOptional() @IsInt() @Min(1) @Max(240) slaHours?: number;
}
export class UpdateZoneDto extends PartialType(ZoneDto) {}

export class ZoneListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) cityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional({ enum: PricingTier }) @IsOptional() @IsIn(Object.values(PricingTier)) tier?: PricingTier;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  override pageSize: number = 100;
}

export class HubListQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
}

export class DetectZoneDto {
  @ApiProperty({ example: '12 شارع عباس العقاد، مدينة نصر' }) @IsString() @MinLength(2) @MaxLength(500) address!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsLongitude() lng?: number;
}
