import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AssetType, AssetStatus, AssetCriticality } from '@prisma/client';

export class ListAssetsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsEnum(AssetType) type?: AssetType;
  @IsOptional() @IsEnum(AssetStatus) status?: AssetStatus;
  @IsOptional() @IsEnum(AssetCriticality) criticality?: AssetCriticality;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsString() sortOrder?: string;
  @IsOptional() @IsString() tenantId?: string;
}

export class CreateAssetDto {
  @IsString() @MaxLength(255) name!: string;
  @IsEnum(AssetType) type!: AssetType;
  @IsString() @MaxLength(1024) value!: string;
  @IsOptional() @IsEnum(AssetStatus) status?: AssetStatus;
  @IsOptional() @IsEnum(AssetCriticality) criticality?: AssetCriticality;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(255) owner?: string;
  @IsOptional() @IsString() firstSeenAt?: string;
  @IsOptional() @IsString() lastSeenAt?: string;
}

export class UpdateAssetDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsEnum(AssetType) type?: AssetType;
  @IsOptional() @IsString() @MaxLength(1024) value?: string;
  @IsOptional() @IsEnum(AssetStatus) status?: AssetStatus;
  @IsOptional() @IsEnum(AssetCriticality) criticality?: AssetCriticality;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(255) owner?: string;
  @IsOptional() @IsString() firstSeenAt?: string;
  @IsOptional() @IsString() lastSeenAt?: string;
}
