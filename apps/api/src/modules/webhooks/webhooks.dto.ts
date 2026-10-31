import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { DeliveryStatus, WEBHOOK_EVENTS } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';

const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value);

export class CreateEndpointDto {
  @ApiProperty({ example: 'https://shop.example.com/webhooks/goturtle' })
  @IsString()
  @MaxLength(500)
  url!: string;

  @ApiProperty({ example: ['order.delivered', 'order.failed_attempt'], description: `Subset of ${WEBHOOK_EVENTS.join(', ')} — or ["*"]` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WEBHOOK_EVENTS.length)
  @IsIn([...WEBHOOK_EVENTS, '*'], { each: true })
  events!: string[];

  @ApiPropertyOptional({ example: 'ERP sync' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateEndpointDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WEBHOOK_EVENTS.length)
  @IsIn([...WEBHOOK_EVENTS, '*'], { each: true })
  events?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({ description: 'Re-enabling resets the failure counter' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class EndpointsQueryDto extends PageQuery {
  @ApiPropertyOptional({ description: 'Staff only' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  brandId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class DeliveriesQueryDto extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(DeliveryStatus) })
  @IsOptional()
  @IsIn(Object.values(DeliveryStatus))
  status?: DeliveryStatus;

  @ApiPropertyOptional({ enum: [...WEBHOOK_EVENTS, 'ping'] })
  @IsOptional()
  @IsIn([...WEBHOOK_EVENTS, 'ping'])
  event?: string;
}
