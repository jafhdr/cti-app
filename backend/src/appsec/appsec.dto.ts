import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApplicationCriticality, ApplicationStatus, AppSecFindingPriority, AppSecFindingSeverity, AppSecFindingStatus, AppSecValidationState, AppSecVerificationState } from '@prisma/client';

export class TenantQueryDto {
  @IsOptional() @IsString() tenantId?: string;
}

export class PageQueryDto extends TenantQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

export class ListApplicationsDto extends PageQueryDto {
  @IsOptional() @IsEnum(ApplicationStatus) status?: ApplicationStatus;
  @IsOptional() @IsEnum(ApplicationCriticality) criticality?: ApplicationCriticality;
}

export class ListAvailableAssetsDto extends PageQueryDto {}

export class CreateApplicationDto {
  @IsString() @MaxLength(255) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsEnum(ApplicationCriticality) criticality?: ApplicationCriticality;
  @IsOptional() @IsString() @MaxLength(255) owner?: string;
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(2048) repositoryUrl?: string;
}

export class UpdateApplicationDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsEnum(ApplicationCriticality) criticality?: ApplicationCriticality;
  @IsOptional() @IsEnum(ApplicationStatus) status?: ApplicationStatus;
  @IsOptional() @IsString() @MaxLength(255) owner?: string;
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(2048) repositoryUrl?: string;
}

export class ListFindingsDto extends PageQueryDto {
  @IsOptional() @IsString() applicationId?: string;
  @IsOptional() @IsEnum(AppSecFindingStatus) status?: AppSecFindingStatus;
  @IsOptional() @IsEnum(AppSecFindingSeverity) severity?: AppSecFindingSeverity;
}

export class OperationalPeriodDto extends TenantQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) @IsDateString() from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(100) ownerId?: string;
}

export class OperationalQueueDto extends OperationalPeriodDto {
  @IsOptional() @IsEnum(AppSecFindingStatus) status?: AppSecFindingStatus;
  @IsOptional() @IsEnum(AppSecFindingPriority) priority?: AppSecFindingPriority;
  @IsOptional() @IsEnum(AppSecVerificationState) verificationState?: AppSecVerificationState;
  @IsOptional() @IsIn(['true', 'false']) overdue?: 'true' | 'false';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}

export class CreateFindingDto {
  @IsString() applicationId!: string;
  @IsString() @MaxLength(255) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsEnum(AppSecFindingSeverity) severity!: AppSecFindingSeverity;
  @IsOptional() @IsString() @MaxLength(255) category?: string;
  @IsOptional() @Matches(/^CWE-[1-9][0-9]*$/) cweId?: string;
  @IsOptional() @IsString() @MaxLength(2048) location?: string;
  @IsOptional() @IsString() @MaxLength(255) sourceKey?: string;
  @IsOptional() @IsString() @MaxLength(4000) remediationNote?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class UpdateFindingDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedRevision?: number;
  @IsOptional() @IsInt() workflowVersion?: number;
  @IsOptional() @IsInt() revision?: number;
  @IsOptional() @IsInt() lifecycleCycle?: number;
  @IsOptional() @IsEnum(AppSecValidationState) validationState?: AppSecValidationState;
  @IsOptional() @IsEnum(AppSecVerificationState) verificationState?: AppSecVerificationState;
  @IsOptional() @IsEnum(AppSecFindingPriority) priority?: AppSecFindingPriority;
  @IsOptional() @IsString() priorityRationale?: string;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsDateString() resolvedAt?: string;
  @IsOptional() @IsString() @MaxLength(255) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsEnum(AppSecFindingSeverity) severity?: AppSecFindingSeverity;
  @IsOptional() @IsEnum(AppSecFindingStatus) status?: AppSecFindingStatus;
  @IsOptional() @IsString() @MaxLength(255) category?: string;
  @IsOptional() @Matches(/^CWE-[1-9][0-9]*$/) cweId?: string;
  @IsOptional() @IsString() @MaxLength(2048) location?: string;
  @IsOptional() @IsString() @MaxLength(4000) remediationNote?: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) resolution?: string;
}

export class LinkFindingVulnerabilityDto {
  @IsString() vulnerabilityId!: string;
}

export class FindingActionDto {
  @Type(() => Number) @IsInt() @Min(0) expectedRevision!: number;
  @IsOptional() @IsUUID() requestKey?: string;
}

export class ActivateFindingDto extends FindingActionDto {
  @IsString() @MaxLength(2000) reason!: string;
}

export class ValidateFindingDto extends FindingActionDto {
  @IsEnum(AppSecValidationState) decision!: AppSecValidationState;
  @IsString() @MaxLength(2000) rationale!: string;
}

export class PrioritizeFindingDto extends FindingActionDto {
  @IsEnum(AppSecFindingPriority) priority!: AppSecFindingPriority;
  @IsString() @MaxLength(2000) rationale!: string;
}

export class AssignFindingDto extends FindingActionDto {
  @IsOptional() @IsString() assigneeId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class StartRemediationDto extends FindingActionDto {}

export class SubmitRemediationEvidenceDto extends FindingActionDto {
  @IsString() @MaxLength(4000) note!: string;
  @IsOptional() @IsString() @MaxLength(2048) @Matches(/^https:\/\/[^\s]+$/i, { message: 'Reference must be an HTTPS URL' }) reference?: string;
}

export class RequestFindingVerificationDto extends FindingActionDto {
  @IsString() @MaxLength(2000) summary!: string;
}

export class DecideFindingVerificationDto extends FindingActionDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsString() @MaxLength(4000) note!: string;
}

export class AcceptFindingRiskDto extends FindingActionDto {
  @IsString() @MaxLength(4000) reason!: string;
  @IsDateString() reviewDueAt!: string;
}

export class ApproveFindingFalsePositiveDto extends FindingActionDto {
  @IsString() @MaxLength(4000) reason!: string;
  @IsOptional() @IsString() @MaxLength(2048) @Matches(/^https:\/\/[^\s]+$/i) reference?: string;
}

export class ReopenFindingDto extends FindingActionDto {
  @IsString() @MaxLength(2000) reason!: string;
}
