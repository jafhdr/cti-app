import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { CampaignStatus, IndicatorSeverity } from '@prisma/client';

export class ListCampaignsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsEnum(CampaignStatus) status?: CampaignStatus;
  @IsOptional() @IsEnum(IndicatorSeverity) severity?: IndicatorSeverity;
  @IsOptional() @IsString() threatActorId?: string;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsString() sortOrder?: string;
  @IsOptional() @IsString() tenantId?: string;
}

export class CreateCampaignDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) objective?: string;
  @IsOptional() @IsEnum(CampaignStatus) status?: CampaignStatus;
  @IsOptional() @IsEnum(IndicatorSeverity) severity?: IndicatorSeverity;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) confidence?: number;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsString() @MaxLength(160) externalId?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) referenceUrl?: string;
  @IsString() threatActorId!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) indicatorIds?: string[];
}

export class UpdateCampaignDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) objective?: string;
  @IsOptional() @IsEnum(CampaignStatus) status?: CampaignStatus;
  @IsOptional() @IsEnum(IndicatorSeverity) severity?: IndicatorSeverity;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) confidence?: number;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsString() @MaxLength(160) externalId?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) referenceUrl?: string;
  @IsOptional() @IsString() threatActorId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) indicatorIds?: string[];
}
