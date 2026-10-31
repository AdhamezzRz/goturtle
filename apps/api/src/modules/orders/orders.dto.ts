import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsObject, IsOptional, IsString, Matches, Max,
  MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { FailureReason, FeesPayer, OrderSource, OrderStatus, OrderType, PaymentMethod, ServiceLevel } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value);
const toList = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === '' ? undefined : (Array.isArray(value) ? value : String(value).split(',')).map((v) => String(v).trim()).filter(Boolean);

export const MAX_COD_CENTS = 10_000_000; // 100,000 EGP per parcel

// ------------------------------------------------------------------ create

export class RecipientDto {
  @ApiProperty({ example: 'Mohamed Hassan' }) @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @ApiProperty({ example: '01012345678', description: 'Egyptian mobile in any format (Arabic digits OK)' }) @IsString() @MaxLength(25) phone!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(25) altPhone?: string | null;
}

export class AddressDto {
  @ApiProperty({ example: '12 شارع مكرم عبيد، مدينة نصر' }) @IsString() @MinLength(5) @MaxLength(500) line!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(50) building?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(20) floor?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(20) apartment?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(200) landmark?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Detected from the address / pin when omitted' }) @IsOptional() @IsString() @MaxLength(32) zoneId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsLatitude() lat?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsLongitude() lng?: number | null;
}

export class PackageDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(999) itemsCount?: number;
  @ApiPropertyOptional({ default: 1000 }) @IsOptional() @IsInt() @Min(1) @Max(100_000) weightGrams?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isFragile?: boolean;
  @ApiPropertyOptional({ description: "Defaults to the brand's allowOpenPackage" }) @IsOptional() @IsBoolean() allowOpening?: boolean;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(100_000_000) declaredValueCents?: number;
}

export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'Staff only: the brand to create the order for' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
  @ApiPropertyOptional({ nullable: true, description: "Merchant's own order number (unique per brand)" }) @IsOptional() @IsString() @MaxLength(100) brandReference?: string | null;
  @ApiPropertyOptional({ enum: OrderType, default: 'DELIVERY' }) @IsOptional() @IsIn(Object.values(OrderType)) type?: OrderType;
  @ApiPropertyOptional({ enum: ServiceLevel, default: 'STANDARD' }) @IsOptional() @IsIn(Object.values(ServiceLevel)) serviceLevel?: ServiceLevel;
  @ApiProperty({ type: RecipientDto }) @IsObject() @ValidateNested() @Type(() => RecipientDto) recipient!: RecipientDto;
  @ApiProperty({ type: AddressDto }) @IsObject() @ValidateNested() @Type(() => AddressDto) address!: AddressDto;
  @ApiPropertyOptional({ type: PackageDto }) @IsOptional() @IsObject() @ValidateNested() @Type(() => PackageDto) package?: PackageDto;
  @ApiPropertyOptional({ enum: PaymentMethod, default: 'COD' }) @IsOptional() @IsIn(Object.values(PaymentMethod)) paymentMethod?: PaymentMethod;
  @ApiProperty({ example: 125000, description: 'COD amount in piasters (0 for prepaid)' }) @IsInt() @Min(0) @Max(MAX_COD_CENTS) codAmountCents!: number;
  @ApiPropertyOptional({ enum: FeesPayer, description: "Defaults to the brand's defaultFeesPaidBy" }) @IsOptional() @IsIn(Object.values(FeesPayer)) feesPaidBy?: FeesPayer;
  @ApiPropertyOptional({ nullable: true, description: 'Defaults to the brand default pickup location' }) @IsOptional() @IsString() @MaxLength(32) pickupLocationId?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-11-02' }) @IsOptional() @Matches(DAY, { message: 'scheduledDate must be YYYY-MM-DD' }) scheduledDate?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Visible to the hero' }) @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
  @ApiPropertyOptional({ default: false, description: 'Require the recipient OTP at delivery' }) @IsOptional() @IsBoolean() deliveryOtpRequired?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(100) externalId?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
}

// ------------------------------------------------------------------ update

export class UpdateRecipientDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(150) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(25) phone?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(25) altPhone?: string | null;
}

export class UpdateAddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(500) line?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(50) building?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(20) floor?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(20) apartment?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(200) landmark?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) zoneId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsLatitude() lat?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsLongitude() lng?: number | null;
}

export class UpdateOrderDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(100) brandReference?: string | null;
  @ApiPropertyOptional({ enum: ServiceLevel }) @IsOptional() @IsIn(Object.values(ServiceLevel)) serviceLevel?: ServiceLevel;
  @ApiPropertyOptional({ type: UpdateRecipientDto }) @IsOptional() @IsObject() @ValidateNested() @Type(() => UpdateRecipientDto) recipient?: UpdateRecipientDto;
  @ApiPropertyOptional({ type: UpdateAddressDto }) @IsOptional() @IsObject() @ValidateNested() @Type(() => UpdateAddressDto) address?: UpdateAddressDto;
  @ApiPropertyOptional({ type: PackageDto }) @IsOptional() @IsObject() @ValidateNested() @Type(() => PackageDto) package?: PackageDto;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsIn(Object.values(PaymentMethod)) paymentMethod?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_COD_CENTS) codAmountCents?: number;
  @ApiPropertyOptional({ enum: FeesPayer }) @IsOptional() @IsIn(Object.values(FeesPayer)) feesPaidBy?: FeesPayer;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(DAY, { message: 'scheduledDate must be YYYY-MM-DD' }) scheduledDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() deliveryOtpRequired?: boolean;
  @ApiPropertyOptional({ description: 'Staff only' }) @IsOptional() @IsString() @MaxLength(2000) internalNotes?: string | null;
  @ApiPropertyOptional({ description: 'Staff only' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @ApiPropertyOptional({ description: 'Staff only (0..10, higher is dispatched first)' }) @IsOptional() @IsInt() @Min(0) @Max(10) priority?: number;
  @ApiPropertyOptional({ description: 'Staff only' }) @IsOptional() @IsInt() @Min(1) @Max(5) maxAttempts?: number;
}

// ------------------------------------------------------------------ actions

export class CancelOrderDto {
  @ApiPropertyOptional({ example: 'Customer cancelled on WhatsApp' }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: OrderStatus }) @IsIn(Object.values(OrderStatus)) status!: OrderStatus;
  @ApiPropertyOptional({ description: 'Machine reason code (e.g. a FailureReason)' }) @IsOptional() @IsString() @MaxLength(60) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ description: 'Show this event on the customer tracking timeline' }) @IsOptional() @IsBoolean() isPublic?: boolean;
  @ApiPropertyOptional({ description: 'Hero for PICKUP_ASSIGNED / ASSIGNED / OUT_FOR_DELIVERY / RETURN_OUT' }) @IsOptional() @IsString() @MaxLength(32) courierId?: string;
  @ApiPropertyOptional({ description: 'Hub for RECEIVED_AT_HUB' }) @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional({ description: 'DELIVERED: cash actually collected (defaults to collectCents)' }) @IsOptional() @IsInt() @Min(0) @Max(MAX_COD_CENTS * 2) collectedCents?: number;
  @ApiPropertyOptional({ enum: FailureReason, description: 'Required for FAILED_ATTEMPT' }) @IsOptional() @IsIn(Object.values(FailureReason)) failureReason?: FailureReason;
  @ApiPropertyOptional({ description: 'RESCHEDULED: new delivery day' }) @IsOptional() @Matches(DAY) scheduledDate?: string;
  @ApiPropertyOptional({ description: 'DELIVERED: name of the person who received the parcel' }) @IsOptional() @IsString() @MaxLength(150) receivedBy?: string;
}

export class LabelsDto {
  @ApiProperty({ type: [String], maxItems: 300 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @IsString({ each: true }) @MaxLength(32, { each: true }) ids!: string[];
}

export class BulkOrdersDto {
  @ApiPropertyOptional({ description: 'Staff only: target brand. (multipart: form field)' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
  @ApiPropertyOptional({ description: 'Rows as objects keyed by template headers (English or Arabic); alternative to the CSV file', type: 'array', items: { type: 'object' } })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  rows?: Array<Record<string, unknown>>;
  @ApiPropertyOptional({ description: 'Default pickup location for all rows' }) @IsOptional() @IsString() @MaxLength(32) pickupLocationId?: string;
}

// ------------------------------------------------------------------ list

export const ORDER_SORTS = ['createdAt', 'updatedAt', 'promisedBy', 'deliveredAt', 'codAmountCents', 'collectCents', 'riskScore', 'status', 'attempts', 'priority'] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

export class OrderListQuery extends PageQuery {
  @ApiPropertyOptional({ type: [String], enum: OrderStatus, description: 'Repeat or comma-separate' })
  @IsOptional() @Transform(toList) @IsArray() @IsIn(Object.values(OrderStatus), { each: true })
  status?: OrderStatus[];
  @ApiPropertyOptional({ description: 'Staff only' }) @IsOptional() @IsString() @MaxLength(32) brandId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) zoneId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) hubId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) courierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) runsheetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) pickupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) customerId?: string;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsIn(Object.values(PaymentMethod)) paymentMethod?: PaymentMethod;
  @ApiPropertyOptional({ enum: ServiceLevel }) @IsOptional() @IsIn(Object.values(ServiceLevel)) serviceLevel?: ServiceLevel;
  @ApiPropertyOptional({ enum: OrderType }) @IsOptional() @IsIn(Object.values(OrderType)) type?: OrderType;
  @ApiPropertyOptional({ enum: OrderSource }) @IsOptional() @IsIn(Object.values(OrderSource)) source?: OrderSource;
  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH'] }) @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH']) riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  @ApiPropertyOptional({ description: 'YYYY-MM-DD (Cairo day) or ISO timestamp' }) @IsOptional() @IsString() @MaxLength(40) from?: string;
  @ApiPropertyOptional({ description: 'YYYY-MM-DD (inclusive Cairo day) or ISO timestamp' }) @IsOptional() @IsString() @MaxLength(40) to?: string;
  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt', 'deliveredAt', 'promisedBy'], default: 'createdAt' })
  @IsOptional() @IsIn(['createdAt', 'updatedAt', 'deliveredAt', 'promisedBy'])
  dateField?: 'createdAt' | 'updatedAt' | 'deliveredAt' | 'promisedBy';
  @ApiPropertyOptional({ description: 'Only orders past promisedBy and not final' }) @IsOptional() @Transform(toBool) @IsBoolean() slaBreached?: boolean;
  @ApiPropertyOptional({ description: 'Has a parent order (return legs)' }) @IsOptional() @Transform(toBool) @IsBoolean() hasParent?: boolean;
  @ApiPropertyOptional({ enum: ORDER_SORTS, default: 'createdAt' }) @IsOptional() @IsIn([...ORDER_SORTS]) sort?: OrderSort;
}
