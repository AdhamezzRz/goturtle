import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { NotificationChannel, NotificationStatus } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';
import { TEMPLATE_NAMES } from './templates';

const toBool = ({ value }: { value: unknown }) => (value === true || value === 'true' || value === '1' ? true : value === false || value === 'false' || value === '0' ? false : value);

export class MyNotificationsQueryDto extends PageQuery {
  @ApiPropertyOptional({ description: 'Only unread notifications' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  unread?: boolean;
}

export class AdminNotificationsQueryDto extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(NotificationChannel) })
  @IsOptional()
  @IsIn(Object.values(NotificationChannel))
  channel?: NotificationChannel;

  @ApiPropertyOptional({ enum: Object.values(NotificationStatus) })
  @IsOptional()
  @IsIn(Object.values(NotificationStatus))
  status?: NotificationStatus;

  @ApiPropertyOptional({ enum: TEMPLATE_NAMES })
  @IsOptional()
  @IsIn(TEMPLATE_NAMES as unknown as string[])
  template?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  userId?: string;

  @ApiPropertyOptional({ description: 'ISO date/time (inclusive)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date/time (exclusive)' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
