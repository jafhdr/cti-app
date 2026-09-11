import { Type } from 'class-transformer';
import { IntelligenceReportStatus, IntelligenceReportType, TlpLevel } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListReportsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsEnum(IntelligenceReportStatus) status?: IntelligenceReportStatus;
  @IsOptional() @IsEnum(IntelligenceReportType) reportType?: IntelligenceReportType;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsString() sortOrder?: string;
  @IsOptional() @IsString() tenantId?: string;
}

export class CreateReportDto {
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(4000) summary!: string;
  @IsString() @MaxLength(100000) content!: string;
  @IsEnum(IntelligenceReportType) reportType!: IntelligenceReportType;
  @IsEnum(TlpLevel) tlp!: TlpLevel;
  @IsEnum(IntelligenceReportStatus) status!: IntelligenceReportStatus;
  @IsOptional() @IsDateString() publishedAt?: string;
}

export class UpdateReportDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) summary?: string;
  @IsOptional() @IsString() @MaxLength(100000) content?: string;
  @IsOptional() @IsEnum(IntelligenceReportType) reportType?: IntelligenceReportType;
  @IsOptional() @IsEnum(TlpLevel) tlp?: TlpLevel;
  @IsOptional() @IsEnum(IntelligenceReportStatus) status?: IntelligenceReportStatus;
  @IsOptional() @IsDateString() publishedAt?: string;
}
