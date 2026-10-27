import { IntelligenceSourceReliability } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AssessmentHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) limit = 10;
  @IsOptional() @IsString() tenantId?: string;
}

export class SourceAssessmentDto {
  @IsEnum(IntelligenceSourceReliability) grade!: IntelligenceSourceReliability;
  @IsString() @IsNotEmpty() @MaxLength(2000) rationale!: string;
  @IsOptional() @IsString() @MaxLength(1000) consistency?: string;
  @IsOptional() @IsString() @MaxLength(1000) accuracy?: string;
  @IsOptional() @IsString() @MaxLength(1000) timeliness?: string;
  @IsOptional() @IsString() @MaxLength(1000) trackRecord?: string;
  @IsOptional() @IsISO8601() reviewAt?: string;
}

export const credibilityGrades = ['1', '2', '3', '4', '5'] as const;
export class EvidenceAssessmentDto {
  @IsIn(credibilityGrades) grade!: typeof credibilityGrades[number];
  @IsString() @IsNotEmpty() @MaxLength(2000) rationale!: string;
  @IsOptional() @IsString() @MaxLength(1000) supportingInformation?: string;
  @IsOptional() @IsString() @MaxLength(1000) conflictingInformation?: string;
}
