import { IsString, IsOptional, IsEnum } from 'class-validator';
import { CaseStatus, CasePriority, IndicatorSeverity } from '@prisma/client';

export class CreateCaseInput {
  @IsString()
  title: string = '';

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
  page?: number;

  @IsOptional()
  limit?: number;

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


