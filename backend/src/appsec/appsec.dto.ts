import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApplicationCriticality, ApplicationStatus, AppSecFindingSeverity, AppSecFindingStatus } from '@prisma/client';

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
