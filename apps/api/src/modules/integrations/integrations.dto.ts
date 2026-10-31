import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { ServiceLevel } from '@goturtle/shared';
import { PageQuery } from '../../common/pagination';

export const CONNECTOR_PROVIDERS = ['SHOPIFY', 'WOOCOMMERCE', 'EASYORDERS', 'ZID', 'SALLA', 'YOUCAN'] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export class IntegrationCredentialsDto {
  @ApiPropertyOptional({ description: 'Shopify Admin API token (shpat_…), Salla / YouCan OAuth access token, Zid X-Manager-Token or EasyOrders API key — used by the credentials test' })
  @IsOptional() @IsString() @MaxLength(1000) accessToken?: string;

  @ApiPropertyOptional({ description: 'Shopify: webhook signing secret / app client secret. WooCommerce: the secret typed in the webhook settings (otherwise use the connection inboundSecret)' })
  @IsOptional() @IsString() @MaxLength(300) webhookSecret?: string;

  @ApiPropertyOptional({ description: 'WooCommerce REST consumer key (ck_…)' })
  @IsOptional() @IsString() @MaxLength(300) consumerKey?: string;

  @ApiPropertyOptional({ description: 'WooCommerce REST consumer secret (cs_…)' })
  @IsOptional() @IsString() @MaxLength(300) consumerSecret?: string;

  @ApiPropertyOptional({ description: 'Zid: Authorization bearer token (the X-Manager-Token goes in accessToken)' })
  @IsOptional() @IsString() @MaxLength(1000) authorizationToken?: string;
}

export class IntegrationSettingsDto {
  @ApiPropertyOptional({ default: true, description: 'Create GoTurtle orders automatically from incoming store orders' })
  @IsOptional() @IsBoolean() autoCreate?: boolean;

  @ApiPropertyOptional({ enum: Object.values(ServiceLevel), default: 'STANDARD' })
  @IsOptional() @IsIn(Object.values(ServiceLevel)) defaultServiceLevel?: ServiceLevel;

  @ApiPropertyOptional({ type: [String], example: ['Cash on Delivery (COD)', 'cod'], description: 'Payment gateway names treated as cash on delivery' })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true }) codGateways?: string[];

  @ApiPropertyOptional({ default: 1000 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) defaultWeightGrams?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Pickup location for imported orders (defaults to the brand default)' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(32) pickupLocationId?: string | null;
}

export class CreateIntegrationDto {
  @ApiProperty({ enum: CONNECTOR_PROVIDERS })
  @IsIn(CONNECTOR_PROVIDERS as unknown as string[])
  provider!: ConnectorProvider;

  @ApiProperty({ example: 'nile-threads.myshopify.com', description: 'Shopify: *.myshopify.com. WooCommerce: the store host (and path), e.g. shop.example.com. EasyOrders / Zid / Salla / YouCan: store domain, handle or merchant id' })
  @IsString() @MinLength(3) @MaxLength(191) shopDomain!: string;

  @ApiPropertyOptional({ type: IntegrationCredentialsDto })
  @IsOptional() @ValidateNested() @Type(() => IntegrationCredentialsDto) credentials?: IntegrationCredentialsDto;

  @ApiPropertyOptional({ type: IntegrationSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => IntegrationSettingsDto) settings?: IntegrationSettingsDto;
}

export class UpdateIntegrationDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MinLength(3) @MaxLength(191) shopDomain?: string;

  @ApiPropertyOptional({ type: IntegrationCredentialsDto, description: 'Merged into the stored (encrypted) credentials; send "" to clear a field' })
  @IsOptional() @ValidateNested() @Type(() => IntegrationCredentialsDto) credentials?: IntegrationCredentialsDto;

  @ApiPropertyOptional({ type: IntegrationSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => IntegrationSettingsDto) settings?: IntegrationSettingsDto;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED'] })
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED']) status?: 'ACTIVE' | 'PAUSED';
}

export class IntegrationsQueryDto extends PageQuery {
  @ApiPropertyOptional({ description: 'Staff only' })
  @IsOptional() @IsString() @MaxLength(32) brandId?: string;

  @ApiPropertyOptional({ enum: CONNECTOR_PROVIDERS })
  @IsOptional() @IsIn(CONNECTOR_PROVIDERS as unknown as string[]) provider?: ConnectorProvider;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED', 'ERROR'] })
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED', 'ERROR']) status?: 'ACTIVE' | 'PAUSED' | 'ERROR';
}
