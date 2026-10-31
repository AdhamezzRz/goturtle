import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { STAFF_ROLES, UserStatus, type UserRole } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';

export const BRAND_TEAM_ROLES = ['BRAND_OWNER', 'BRAND_STAFF'] as const;
export type BrandTeamRole = (typeof BRAND_TEAM_ROLES)[number];

export class UsersQueryDto extends PageQuery {
  @ApiPropertyOptional({ enum: ['staff', 'brand', 'courier', 'all'], default: 'staff' })
  @IsOptional()
  @IsIn(['staff', 'brand', 'courier', 'all'])
  kind: 'staff' | 'brand' | 'courier' | 'all' = 'staff';

  @ApiPropertyOptional({ description: 'Role filter' })
  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'OPS_MANAGER', 'DISPATCHER', 'HUB_OPERATOR', 'FINANCE', 'SUPPORT', 'BRAND_OWNER', 'BRAND_STAFF', 'COURIER'])
  role?: UserRole;

  @ApiPropertyOptional({ enum: Object.values(UserStatus) })
  @IsOptional()
  @IsIn(Object.values(UserStatus))
  status?: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  hubId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  brandId?: string;
}

class UserBaseDto {
  @ApiProperty({ example: 'Mona Fathy' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '01012345678', description: 'Egyptian mobile (any format)' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ example: 'mona@goturtle.eg' })
  @IsOptional()
  @IsEmail()
  @MaxLength(191)
  email?: string;

  @ApiPropertyOptional({ enum: ['ar', 'en'], default: 'ar' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  locale?: 'ar' | 'en';
}

export class InviteStaffDto extends UserBaseDto {
  @ApiProperty({ enum: STAFF_ROLES })
  @IsIn(STAFF_ROLES as unknown as string[])
  role!: UserRole;

  @ApiPropertyOptional({ description: 'Home hub (hub operators, dispatchers)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  hubId?: string;
}

export class UpdateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  @MaxLength(191)
  email?: string | null;

  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional()
  @IsIn(STAFF_ROLES as unknown as string[])
  role?: UserRole;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(32)
  hubId?: string | null;

  @ApiPropertyOptional({ enum: ['ar', 'en'] })
  @IsOptional()
  @IsIn(['ar', 'en'])
  locale?: 'ar' | 'en';

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}

export class InviteTeamMemberDto extends UserBaseDto {
  @ApiProperty({ enum: BRAND_TEAM_ROLES })
  @IsIn(BRAND_TEAM_ROLES as unknown as string[])
  role!: BrandTeamRole;
}

export class UpdateTeamMemberDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  @MaxLength(191)
  email?: string | null;

  @ApiPropertyOptional({ enum: BRAND_TEAM_ROLES })
  @IsOptional()
  @IsIn(BRAND_TEAM_ROLES as unknown as string[])
  role?: BrandTeamRole;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}
