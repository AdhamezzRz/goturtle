import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { TicketCategory, TicketPriority, TicketStatus } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';

const ATTACHMENT = /^(\/api\/v1\/files\/|https:\/\/)\S+$/;
const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value);

export class CreateTicketDto {
  @ApiProperty({ example: 'Parcel GT4829150376 is late' }) @IsString() @MinLength(3) @MaxLength(200) subject!: string;
  @ApiProperty({ enum: Object.values(TicketCategory) }) @IsIn(Object.values(TicketCategory)) category!: TicketCategory;
  @ApiPropertyOptional({ enum: Object.values(TicketPriority), description: 'Ignored for customers (MEDIUM)' }) @IsOptional() @IsIn(Object.values(TicketPriority)) priority?: TicketPriority;
  @ApiProperty({ description: 'First message' }) @IsString() @MinLength(2) @MaxLength(5000) body!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) orderId?: string;
  @ApiPropertyOptional({ description: 'Alternative to orderId (customer portal)' }) @IsOptional() @IsString() @MaxLength(20) trackingNumber?: string;
  @ApiPropertyOptional({ description: 'Staff only: brand the ticket is about' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @ApiPropertyOptional({ type: [String], description: 'Uploaded file URLs (/api/v1/files/…)' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(ATTACHMENT, { each: true, message: 'attachments must be uploaded file URLs' }) attachments?: string[];
}

export class ReplyTicketDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @ApiPropertyOptional({ default: false, description: 'Staff only: internal note, never shown to brands or customers' }) @IsOptional() @IsBoolean() isInternal?: boolean;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(ATTACHMENT, { each: true, message: 'attachments must be uploaded file URLs' }) attachments?: string[];
}

export class AssignTicketDto {
  @ApiProperty({ nullable: true, description: 'Staff user id, or null to unassign' })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(32)
  assigneeId!: string | null;
}

export class TicketStatusDto {
  @ApiProperty({ enum: Object.values(TicketStatus) }) @IsIn(Object.values(TicketStatus)) status!: TicketStatus;
}

export class UpdateTicketDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(200) subject?: string;
  @ApiPropertyOptional({ enum: Object.values(TicketCategory) }) @IsOptional() @IsIn(Object.values(TicketCategory)) category?: TicketCategory;
  @ApiPropertyOptional({ enum: Object.values(TicketPriority), description: 'Recomputes the SLA due time' }) @IsOptional() @IsIn(Object.values(TicketPriority)) priority?: TicketPriority;
}

export class TicketsQueryDto extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(TicketStatus) }) @IsOptional() @IsIn(Object.values(TicketStatus)) status?: TicketStatus;
  @ApiPropertyOptional({ description: 'open = OPEN + IN_PROGRESS + WAITING_ON_CUSTOMER' }) @IsOptional() @Transform(toBool) @IsBoolean() open?: boolean;
  @ApiPropertyOptional({ enum: Object.values(TicketPriority) }) @IsOptional() @IsIn(Object.values(TicketPriority)) priority?: TicketPriority;
  @ApiPropertyOptional({ enum: Object.values(TicketCategory) }) @IsOptional() @IsIn(Object.values(TicketCategory)) category?: TicketCategory;
  @ApiPropertyOptional({ description: 'Staff: user id, "me" or "none"' }) @IsOptional() @IsString() @MaxLength(32) assigneeId?: string;
  @ApiPropertyOptional({ description: 'Staff only' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) orderId?: string;
  @ApiPropertyOptional({ description: 'SLA breached (due time passed before resolution)' }) @IsOptional() @Transform(toBool) @IsBoolean() breached?: boolean;
}
