import { IsString, IsOptional, IsEnum, MaxLength, MinLength, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { CaseStatus, CasePriority, IndicatorSeverity } from '@prisma/client';

export class CreateCaseInput {
  @IsString()
  title: string = '';

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @IsOptional()
  @IsEnum(IndicatorSeverity)
  severity?: IndicatorSeverity;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class UpdateCaseInput {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(CaseStatus)
  status?: CaseStatus;

  @IsOptional()
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @IsOptional()
  @IsEnum(IndicatorSeverity)
  severity?: IndicatorSeverity;

  @IsOptional()
  @IsString()
  assigneeId?: string;
}

export class ListCaseQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(CaseStatus)
  status?: CaseStatus;

  @IsOptional()
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @IsOptional()
  @IsEnum(IndicatorSeverity)
  severity?: IndicatorSeverity;
}

export class AssignCaseInput {
  @IsString()
  @MinLength(1)
  assigneeId: string = '';
}

export class CaseTenantQuery {
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class LinkAsmAlertInput extends CaseTenantQuery {}

export class CreateInvestigationNoteInput {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  requestId: string = '';

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string = '';
}

export class CreateEvidenceInput {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  requestId: string = '';

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string = '';

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  type: string = '';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  source?: string;
}

export class LinkIndicatorInput {
  @IsString()
  @MinLength(1)
  indicatorId: string = '';
}

export class LinkThreatActorInput {
  @IsString()
  @MinLength(1)
  threatActorId: string = '';
}

export class LinkCampaignInput {
  @IsString()
  @MinLength(1)
  campaignId: string = '';
}


