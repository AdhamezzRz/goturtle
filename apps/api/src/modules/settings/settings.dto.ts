import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQuery } from '../../common/pagination';

export class UpdateSettingDto {
  @ApiProperty({ description: 'Partial value — only the given fields change', example: { supportPhone: '16123' }, type: Object })
  @IsObject()
  value!: Record<string, unknown>;
}

export class AuditQueryDto extends PageQuery {
  @ApiPropertyOptional({ example: 'Brand' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  actorId?: string;

  @ApiPropertyOptional({ description: 'Exact action or a prefix ending with "." (e.g. "brand.")', example: 'brand.update' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ description: 'ISO date/time (inclusive)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date/time (exclusive); a plain date includes that whole day' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
