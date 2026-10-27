import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PirPriority, PirStatus } from '@prisma/client';

export class ListSirsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() pirId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(PirPriority) priority?: PirPriority;
  @IsOptional() @IsEnum(PirStatus) status?: PirStatus;
  @IsOptional() @IsIn(['updatedAt', 'dueDate', 'priority', 'reference']) sortBy = 'updatedAt';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder: 'asc' | 'desc' = 'desc';
  @IsOptional() @IsString() tenantId?: string;
}

export class CreateSirDto {
  @IsString() pirId!: string;
  @IsString() @MaxLength(40) reference!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(4000) question!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) intelligenceContext?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) knowledgeGaps?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) collectionGuidance?: string | null;
  @IsOptional() @IsEnum(PirPriority) priority?: PirPriority;
  @IsOptional() @IsString() responsibleUserId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) expectedAnswerCriteria?: string | null;
}

export class UpdateSirDto extends CreateSirDto {
  @IsOptional() pirId!: string;
  @IsOptional() reference!: string;
  @IsOptional() title!: string;
  @IsOptional() question!: string;
}

export class AnswerSirDto {
  @IsString() @MaxLength(8000) analystAnswer!: string;
  @IsOptional() @IsString() @MaxLength(4000) evidenceNotes?: string | null;
}

export class ChangeSirStatusDto { @IsEnum(PirStatus) status!: PirStatus; }
