import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { IndicatorSeverity, ThreatActorStatus } from '@prisma/client';

export class ListThreatActorsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsEnum(IndicatorSeverity) severity?: IndicatorSeverity;
  @IsOptional() @IsEnum(ThreatActorStatus) status?: ThreatActorStatus;
  @IsOptional() @IsString() @MaxLength(120) country?: string;
  @IsOptional() @IsString() @MaxLength(120) sector?: string;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsString() sortOrder?: string;
  @IsOptional() @IsString() tenantId?: string;
}

export class CreateThreatActorDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) aliases?: string[];
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(1000) motivation?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) targetSectors?: string[];
  @IsOptional() @IsString() @MaxLength(120) country?: string;
  @IsOptional() @IsString() @MaxLength(120) region?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) confidence?: number;
  @IsOptional() @IsEnum(IndicatorSeverity) severity?: IndicatorSeverity;
  @IsOptional() @IsEnum(ThreatActorStatus) status?: ThreatActorStatus;
  @IsOptional() @IsString() @MaxLength(160) externalId?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) referenceUrl?: string;
}

export class UpdateThreatActorDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) aliases?: string[];
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(1000) motivation?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) targetSectors?: string[];
  @IsOptional() @IsString() @MaxLength(120) country?: string;
  @IsOptional() @IsString() @MaxLength(120) region?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) confidence?: number;
  @IsOptional() @IsEnum(IndicatorSeverity) severity?: IndicatorSeverity;
  @IsOptional() @IsEnum(ThreatActorStatus) status?: ThreatActorStatus;
  @IsOptional() @IsString() @MaxLength(160) externalId?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) referenceUrl?: string;
}
