import { CaseReviewDecisionKind } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class IntegrityRevisionInput {
  @IsInt() @Min(0)
  expectedRevision!: number;
}

export class ReviseCaseEvidenceInput extends IntegrityRevisionInput {
  @IsString() @MinLength(1) @MaxLength(255)
  name: string = '';
  @IsString() @MinLength(1) @MaxLength(100)
  type: string = '';
  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;
  @IsOptional() @IsString() @MaxLength(2000)
  source?: string;
}

export class RequestCaseReviewInput extends IntegrityRevisionInput {
  @IsString() @MinLength(1)
  reviewerId: string = '';
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class DecideCaseReviewInput extends IntegrityRevisionInput {
  @IsEnum(CaseReviewDecisionKind)
  kind!: CaseReviewDecisionKind;
  @IsString() @MinLength(1) @MaxLength(2000)
  reason: string = '';
}

export class CloseCaseV2Input extends IntegrityRevisionInput {
  @IsString() @MinLength(1) @MaxLength(2000)
  reason: string = '';
  @IsString() @MinLength(1) @MaxLength(10000)
  investigationSummary: string = '';
}

export class ReopenCaseV2Input extends IntegrityRevisionInput {
  @IsString() @MinLength(1) @MaxLength(2000)
  reason: string = '';
}
