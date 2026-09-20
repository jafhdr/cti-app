import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { IntelligenceSourceReliability, IntelligenceSourceStatus, IntelligenceSourceType, TlpLevel } from '@prisma/client';

export class ListSourcesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsEnum(IntelligenceSourceType) sourceType?: IntelligenceSourceType;
  @IsOptional() @IsEnum(IntelligenceSourceStatus) status?: IntelligenceSourceStatus;
  @IsOptional() @IsEnum(TlpLevel) tlp?: TlpLevel;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsString() sortOrder?: string;
  @IsOptional() @IsString() tenantId?: string;
}

export class CreateSourceDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsEnum(IntelligenceSourceType) sourceType!: IntelligenceSourceType;
  @IsOptional() @IsString() @MaxLength(160) provider?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) url?: string;
  @IsOptional() @IsEnum(IntelligenceSourceReliability) reliability?: IntelligenceSourceReliability;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) confidence?: number;
  @IsOptional() @IsEnum(TlpLevel) tlp?: TlpLevel;
  @IsOptional() @IsEnum(IntelligenceSourceStatus) status?: IntelligenceSourceStatus;
  @IsOptional() @IsString() lastSyncAt?: string;
  @IsOptional() @IsString() @MaxLength(32) telegramChatId?: string;
}

export class UpdateSourceDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsEnum(IntelligenceSourceType) sourceType?: IntelligenceSourceType;
  @IsOptional() @IsString() @MaxLength(160) provider?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) url?: string;
  @IsOptional() @IsEnum(IntelligenceSourceReliability) reliability?: IntelligenceSourceReliability;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) confidence?: number;
  @IsOptional() @IsEnum(TlpLevel) tlp?: TlpLevel;
  @IsOptional() @IsEnum(IntelligenceSourceStatus) status?: IntelligenceSourceStatus;
  @IsOptional() @IsString() lastSyncAt?: string;
  @IsOptional() @IsString() @MaxLength(32) telegramChatId?: string;
}
