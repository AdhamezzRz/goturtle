import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CollectionMethod, FailureReason } from '@goturtle/shared';

export class PositionDto {
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
}

export class DeliverDto extends PositionDto {
  @ApiProperty({ description: 'Cash collected in piasters — must equal the order collectCents' }) @IsInt() @Min(0) @Max(20_000_000) collectedCents!: number;
  @ApiPropertyOptional({ description: 'Recipient delivery code (required when the order needs OTP)' }) @IsOptional() @IsString() @MinLength(4) @MaxLength(8) otp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) podPhotoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) signatureUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) receivedBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ enum: CollectionMethod, default: 'CASH', description: 'How the recipient paid. Non-cash never enters the hero custody; finance confirms it.' })
  @IsOptional() @IsIn(Object.values(CollectionMethod)) collectionMethod?: CollectionMethod;
  @ApiPropertyOptional({ description: 'Transfer / card slip reference (required for INSTAPAY, WALLET and CARD)' })
  @IsOptional() @IsString() @MaxLength(120) collectionReference?: string;
}

export class FailDto extends PositionDto {
  @ApiProperty({ enum: FailureReason }) @IsIn(Object.values(FailureReason)) reason!: FailureReason;
  @ApiPropertyOptional({ description: 'Required when reason is OTHER' }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) photoUrl?: string;
  @ApiPropertyOptional({ description: 'Customer asked for another day (today … +7)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) rescheduleDate?: string;
}

export class NoteDto extends PositionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ReturnedDto extends PositionDto {
  @ApiPropertyOptional({ description: 'Brand representative who received the return' }) @IsOptional() @IsString() @MaxLength(150) receivedBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) photoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
