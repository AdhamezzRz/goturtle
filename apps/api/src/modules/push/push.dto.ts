import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

const BASE64URL = /^[A-Za-z0-9_\-=+/]+$/;

export class PushKeysDto {
  @ApiProperty({ description: 'Browser ECDH public key (base64url)' })
  @IsString() @MinLength(16) @MaxLength(200) @Matches(BASE64URL) p256dh!: string;

  @ApiProperty({ description: 'Auth secret (base64url)' })
  @IsString() @MinLength(8) @MaxLength(100) @Matches(BASE64URL) auth!: string;
}

export class SubscribeDto {
  @ApiProperty({ example: 'https://fcm.googleapis.com/fcm/send/…', description: 'PushSubscription.endpoint' })
  @IsString() @MaxLength(700) @Matches(/^https:\/\/[^\s]+$/, { message: 'endpoint must be an https URL' }) endpoint!: string;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested() @Type(() => PushKeysDto) keys!: PushKeysDto;
}

export class UnsubscribeDto {
  @ApiProperty() @IsString() @MaxLength(700) endpoint!: string;
}

export class PushStatusQuery {
  @ApiPropertyOptional({ description: 'This browser’s endpoint, to tell whether it is subscribed' })
  @IsOptional() @IsString() @MaxLength(700) endpoint?: string;
}
