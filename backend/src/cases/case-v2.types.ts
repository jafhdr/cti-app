import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CaseOriginKind, CasePriority, IndicatorSeverity } from '@prisma/client';

export class CreateCaseV2Input {
  @IsEnum(CaseOriginKind)
  kind: CaseOriginKind = CaseOriginKind.MANUAL;

  @IsOptional() @IsString() @MinLength(1)
  sourceId?: string;

  @IsString() @MinLength(1) @MaxLength(255)
  title: string = '';

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @IsOptional() @IsEnum(CasePriority)
  priority?: CasePriority;

  @IsOptional() @IsEnum(IndicatorSeverity)
  severity?: IndicatorSeverity;

  @IsOptional() @IsString()
  assigneeId?: string;

  @IsOptional() @IsString()
  tenantId?: string;
}
