import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { FeedbackFollowUpStatus, PirPriority } from '@prisma/client';

export class ListFeedbackFollowUpsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() pirId?: string;
  @IsOptional() @IsString() sirId?: string;
  @IsOptional() @IsString() reportId?: string;
  @IsOptional() @IsEnum(FeedbackFollowUpStatus) status?: FeedbackFollowUpStatus;
}

export class CreateFeedbackFollowUpDto {
  @IsString() @MaxLength(40) reference!: string;
  @IsString() @MaxLength(3000) summary!: string;
  @IsOptional() @IsEnum(PirPriority) priority?: PirPriority;
  @IsOptional() @IsBoolean() newRequirementNeeded?: boolean;
  @IsOptional() @IsString() sirId?: string;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class UpdateFeedbackFollowUpDto {
  @IsOptional() @IsEnum(PirPriority) priority?: PirPriority;
  @IsOptional() @IsBoolean() newRequirementNeeded?: boolean;
  @IsOptional() @IsString() assigneeId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() sirId?: string | null;
}

export class TransitionFeedbackFollowUpDto {
  @IsIn(['IN_PROGRESS', 'RESOLVED', 'DISMISSED']) status!: 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED';
  @IsOptional() @IsString() @MaxLength(3000) note?: string;
}
