import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../../common/pagination';

const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value);

export class CustomerListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isBlocked?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) minReliability?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) maxReliability?: number;
  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt', 'name', 'totalOrders', 'deliveredOrders', 'refusedOrders', 'reliabilityScore'] })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'name', 'totalOrders', 'deliveredOrders', 'refusedOrders', 'reliabilityScore'])
  sort?: 'createdAt' | 'updatedAt' | 'name' | 'totalOrders' | 'deliveredOrders' | 'refusedOrders' | 'reliabilityScore';
}

export class BlockCustomerDto {
  @ApiPropertyOptional({ example: 'Refused 3 COD orders in a row' }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
