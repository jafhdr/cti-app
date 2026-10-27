import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AnalysisConfidence, IntelligenceReportType, TlpLevel } from '@prisma/client';

export class ListAnalysisReportsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(['DRAFT', 'IN_REVIEW', 'FINAL']) status?: 'DRAFT' | 'IN_REVIEW' | 'FINAL';
  @IsOptional() @IsString() pirId?: string;
  @IsOptional() @IsIn(['reference', 'title', 'createdAt', 'updatedAt', 'finalizedAt']) sortBy = 'updatedAt';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder: 'asc' | 'desc' = 'desc';
  @IsOptional() @IsString() tenantId?: string;
}

export class SaveAnalysisReportDto {
  @IsString() @MaxLength(40) reference!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() pirId!: string;
  @IsOptional() @IsString() stakeholderId?: string;
  @IsArray() @IsString({ each: true }) sirIds!: string[];
  @IsArray() @IsString({ each: true }) evidenceIds!: string[];
  @IsOptional() @IsString() @MaxLength(10000) summary?: string;
  @IsOptional() @IsString() @MaxLength(20000) keyFindings?: string;
  @IsOptional() @IsString() @MaxLength(30000) content?: string;
  @IsOptional() @IsString() @MaxLength(10000) recommendedActions?: string;
  @IsOptional() @IsString() @MaxLength(10000) informationGaps?: string;
  @IsOptional() @IsEnum(AnalysisConfidence) confidence?: AnalysisConfidence;
  @IsOptional() @IsEnum(TlpLevel) tlp?: TlpLevel;
  @IsOptional() @IsEnum(IntelligenceReportType) reportType?: IntelligenceReportType;
  @IsOptional() @IsString() reviewerId?: string;
}

export class ChangeAnalysisStatusDto {
  @IsIn(['DRAFT', 'IN_REVIEW']) status!: 'DRAFT' | 'IN_REVIEW';
}
