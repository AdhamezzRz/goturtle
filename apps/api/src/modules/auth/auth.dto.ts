import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: '01000000000', description: 'Phone (any Egyptian format) or email' })
  @IsString()
  @MaxLength(191)
  identifier!: string;

  @ApiProperty({ example: 'Admin@12345' })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  refreshToken!: string;
}

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ description: 'At least 8 characters with letters and numbers' })
  @IsString()
  @Matches(PASSWORD_RULE, { message: 'Password must be at least 8 characters and contain letters and numbers' })
  newPassword!: string;
}

export class OtpRequestDto {
  @ApiProperty({ example: '01012345678' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ example: 'GT4829150376', description: 'Open a session for a single shipment' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  trackingNumber?: string;
}

export class OtpVerifyDto extends OtpRequestDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(4, 8)
  code!: string;
}

export class PasswordResetDto {
  @ApiProperty()
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty()
  @IsString()
  @Length(4, 8)
  code!: string;

  @ApiProperty()
  @IsString()
  @Matches(PASSWORD_RULE, { message: 'Password must be at least 8 characters and contain letters and numbers' })
  newPassword!: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ['ar', 'en'] })
  @IsOptional()
  @Matches(/^(ar|en)$/)
  locale?: 'ar' | 'en';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;
}
