import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsEmail, IsIn, IsLatitude, IsLongitude, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { BrandStatus, FeesPayer, PayoutMethod, SettlementCycle } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';
import { PASSWORD_RULE } from '../auth/auth.dto';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class PayoutDetailsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @ApiPropertyOptional({ example: 'EG380019000500000000263180002' }) @IsOptional() @IsString() @Matches(/^EG\d{27}$/, { message: 'iban must be an Egyptian IBAN (EG + 27 digits)' }) iban?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) accountName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @ApiPropertyOptional({ example: 'brand@instapay' }) @IsOptional() @IsString() @MaxLength(120) instapayAddress?: string;
  @ApiPropertyOptional({ example: '01012345678' }) @IsOptional() @IsString() @MaxLength(20) walletPhone?: string;
}

export class LocationInputDto {
  @ApiProperty({ example: 'Zamalek studio' }) @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiPropertyOptional({ description: 'Defaults to the owner name' }) @IsOptional() @IsString() @MinLength(2) @MaxLength(120) contactName?: string;
  @ApiPropertyOptional({ description: 'Defaults to the owner phone' }) @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiProperty({ example: '12 Brazil St, Zamalek' }) @IsString() @MinLength(5) @MaxLength(500) addressLine!: string;
  @ApiProperty() @IsString() @MaxLength(32) zoneId!: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateLocationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(500) addressLine?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) zoneId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsLatitude() lat?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsLongitude() lng?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class OwnerInputDto {
  @ApiProperty({ example: 'Yasmin Nabil' }) @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiProperty({ example: '01110000011' }) @IsString() @MaxLength(20) phone!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(191) email?: string;
  @ApiPropertyOptional({ enum: ['ar', 'en'] }) @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
}

class BrandProfileFields {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) commercialRegNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) taxId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) industry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^(https?:\/\/|\/)\S+$/, { message: 'logoUrl must be an http(s) URL or an uploaded file path' }) @MaxLength(500) logoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^https?:\/\/\S+$/, { message: 'website must be an http(s) URL' }) @MaxLength(300) website?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(191) email?: string;
}

export class CreateBrandDto extends BrandProfileFields {
  @ApiProperty({ example: 'NILE', description: '2–12 letters/digits, printed on labels (uppercased)' })
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z0-9]{2,12}$/, { message: 'code must be 2–12 letters or digits' })
  code!: string;

  @ApiProperty({ example: 'Nile Threads' }) @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @ApiProperty({ example: '01110000001', description: 'Brand contact phone' }) @IsString() @MaxLength(20) phone!: string;
  @ApiPropertyOptional({ enum: ['PENDING', 'ACTIVE'], default: 'ACTIVE' }) @IsOptional() @IsIn(['PENDING', 'ACTIVE']) status?: 'PENDING' | 'ACTIVE';
  @ApiPropertyOptional({ description: 'Defaults to the default plan' }) @IsOptional() @IsString() @MaxLength(32) pricingPlanId?: string;
  @ApiPropertyOptional({ enum: Object.values(SettlementCycle) }) @IsOptional() @IsIn(Object.values(SettlementCycle)) settlementCycle?: SettlementCycle;
  @ApiPropertyOptional({ enum: Object.values(PayoutMethod) }) @IsOptional() @IsIn(Object.values(PayoutMethod)) payoutMethod?: PayoutMethod;
  @ApiPropertyOptional({ type: PayoutDetailsDto }) @IsOptional() @ValidateNested() @Type(() => PayoutDetailsDto) payoutDetails?: PayoutDetailsDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowOpenPackage?: boolean;
  @ApiPropertyOptional({ enum: Object.values(FeesPayer) }) @IsOptional() @IsIn(Object.values(FeesPayer)) defaultFeesPaidBy?: FeesPayer;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) accountManagerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;

  @ApiProperty({ type: OwnerInputDto }) @ValidateNested() @Type(() => OwnerInputDto) owner!: OwnerInputDto;
  @ApiProperty({ type: LocationInputDto, description: 'Default pickup location' }) @ValidateNested() @Type(() => LocationInputDto) location!: LocationInputDto;
}

export class UpdateBrandDto extends BrandProfileFields {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(150) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(32) pricingPlanId?: string | null;
  @ApiPropertyOptional({ enum: Object.values(SettlementCycle) }) @IsOptional() @IsIn(Object.values(SettlementCycle)) settlementCycle?: SettlementCycle;
  @ApiPropertyOptional({ enum: Object.values(PayoutMethod) }) @IsOptional() @IsIn(Object.values(PayoutMethod)) payoutMethod?: PayoutMethod;
  @ApiPropertyOptional({ type: PayoutDetailsDto, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @ValidateNested() @Type(() => PayoutDetailsDto) payoutDetails?: PayoutDetailsDto | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowOpenPackage?: boolean;
  @ApiPropertyOptional({ enum: Object.values(FeesPayer) }) @IsOptional() @IsIn(Object.values(FeesPayer)) defaultFeesPaidBy?: FeesPayer;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(32) accountManagerId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) notes?: string | null;
}

/** What a brand can change about itself. Payout fields: owner only. */
export class UpdateMyBrandDto extends BrandProfileFields {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional({ enum: Object.values(PayoutMethod) }) @IsOptional() @IsIn(Object.values(PayoutMethod)) payoutMethod?: PayoutMethod;
  @ApiPropertyOptional({ type: PayoutDetailsDto }) @IsOptional() @ValidateNested() @Type(() => PayoutDetailsDto) payoutDetails?: PayoutDetailsDto;
  @ApiPropertyOptional({ enum: Object.values(FeesPayer) }) @IsOptional() @IsIn(Object.values(FeesPayer)) defaultFeesPaidBy?: FeesPayer;
}

export class RegisterBrandDto {
  @ApiProperty({ example: 'Lotus Home' }) @IsString() @MinLength(2) @MaxLength(150) brandName!: string;
  @ApiPropertyOptional({ example: 'Home decor' }) @IsOptional() @IsString() @MaxLength(80) industry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^https?:\/\/\S+$/, { message: 'website must be an http(s) URL' }) @MaxLength(300) website?: string;
  @ApiProperty({ example: 'Sara Adel' }) @IsString() @MinLength(2) @MaxLength(120) ownerName!: string;
  @ApiProperty({ example: '01012345678' }) @IsString() @MaxLength(20) phone!: string;
  @ApiProperty({ example: 'sara@lotus.eg' }) @IsEmail() @MaxLength(191) email!: string;
  @ApiProperty({ description: 'At least 8 characters with letters and numbers' })
  @IsString()
  @Matches(PASSWORD_RULE, { message: 'Password must be at least 8 characters and contain letters and numbers' })
  password!: string;
  @ApiPropertyOptional({ type: LocationInputDto, description: 'First pickup location (can be added later)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationInputDto)
  location?: LocationInputDto;
  @ApiPropertyOptional({ enum: ['ar', 'en'] }) @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
}

export class BrandsQueryDto extends PageQuery {
  @ApiPropertyOptional({ enum: Object.values(BrandStatus) }) @IsOptional() @IsIn(Object.values(BrandStatus)) status?: BrandStatus;
  @ApiPropertyOptional({ description: 'Pricing plan id' }) @IsOptional() @IsString() @MaxLength(32) planId?: string;
  @ApiPropertyOptional({ enum: Object.values(SettlementCycle) }) @IsOptional() @IsIn(Object.values(SettlementCycle)) cycle?: SettlementCycle;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) accountManagerId?: string;
}
