import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PageQuery } from '../../common/pagination';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Shopify middleware' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: ['orders.read', 'orders.create'], description: 'Subset of brand-staff permissions, or ["*"]' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  scopes!: string[];
}

export class ApiKeysQueryDto extends PageQuery {
  @ApiPropertyOptional({ description: 'Staff only: filter by brand' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  brandId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeRevoked?: boolean;
}
