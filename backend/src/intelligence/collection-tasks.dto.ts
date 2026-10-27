import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CollectionMethod, CollectionResultKind, CollectionTaskStatus, PirPriority } from '@prisma/client';

export class ListCollectionTasksDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() sirId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(CollectionTaskStatus) status?: CollectionTaskStatus;
  @IsOptional() @IsEnum(PirPriority) priority?: PirPriority;
  @IsOptional() @IsEnum(CollectionMethod) method?: CollectionMethod;
  @IsOptional() @IsString() sourceId?: string;
  @IsOptional() @IsString() responsibleUserId?: string;
  @IsOptional() @IsIn(['updatedAt', 'dueDate', 'priority', 'reference']) sortBy = 'updatedAt';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder: 'asc' | 'desc' = 'desc';
}
export class CreateCollectionTaskDto {
  @IsString() sirId!: string;
  @IsString() @MaxLength(40) reference!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(4000) objective!: string;
  @IsString() @MaxLength(4000) informationRequired!: string;
  @IsEnum(CollectionMethod) method!: CollectionMethod;
  @IsOptional() @IsString() sourceId?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) guidance?: string | null;
  @IsOptional() @IsEnum(PirPriority) priority?: PirPriority;
  @IsOptional() @IsString() responsibleUserId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
}
export class UpdateCollectionTaskDto extends CreateCollectionTaskDto {
  @IsOptional() sirId!: string;
  @IsOptional() reference!: string;
  @IsOptional() title!: string;
  @IsOptional() objective!: string;
  @IsOptional() informationRequired!: string;
  @IsOptional() method!: CollectionMethod;
}
export class AssignCollectionTaskDto { @IsOptional() @IsString() responsibleUserId!: string | null; }
export class StatusCollectionTaskDto { @IsEnum(CollectionTaskStatus) status!: CollectionTaskStatus; }
export class ResultCollectionTaskDto {
  @IsEnum(CollectionResultKind) resultKind!: CollectionResultKind;
  @IsString() @MaxLength(8000) resultSummary!: string;
  @IsOptional() @IsString() @MaxLength(4000) informationGaps?: string | null;
}
export class LinkCollectionEvidenceDto { @IsString() evidenceId!: string; }
