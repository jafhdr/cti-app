import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PirPriority, PirStatus } from '@prisma/client';

export class ListPirsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsEnum(PirPriority) priority?: PirPriority;
  @IsOptional() @IsEnum(PirStatus) status?: PirStatus;
  @IsOptional() @IsString() stakeholderId?: string;
  @IsOptional() @IsIn(['updatedAt', 'dueDate', 'priority', 'reference']) sortBy = 'updatedAt';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder: 'asc' | 'desc' = 'desc';
  @IsOptional() @IsString() tenantId?: string;
}

export class CreatePirDto {
  @IsString() @MaxLength(40) reference!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(4000) question!: string;
  @IsString() stakeholderId!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) strategicContext?: string | null;
  @IsOptional() @IsEnum(PirPriority) priority?: PirPriority;
  @IsOptional() @IsString() responsibleUserId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) timeHorizon?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) expectedOutcome?: string | null;
}

export class UpdatePirDto extends CreatePirDto {
  @IsOptional() reference!: string;
  @IsOptional() title!: string;
  @IsOptional() question!: string;
  @IsOptional() stakeholderId!: string;
}

export class ChangePirStatusDto {
  @IsEnum(PirStatus) status!: PirStatus;
}
