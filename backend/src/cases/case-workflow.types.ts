import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { CaseTaskState } from '@prisma/client';

export class ExpectedCaseRevision {
  @IsInt() @Min(0)
  expectedRevision!: number;
}

export class CreateCaseTaskInput extends ExpectedCaseRevision {
  @IsString() @MinLength(1) @MaxLength(255)
  title: string = '';

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @IsString() @MinLength(1)
  assigneeId: string = '';
}

export class UpdateCaseTaskInput extends ExpectedCaseRevision {
  @IsOptional() @IsEnum(CaseTaskState)
  state?: CaseTaskState;

  @IsOptional() @IsString() @MinLength(1)
  assigneeId?: string;
}

export class HandoffCaseInput extends ExpectedCaseRevision {
  @IsString() @MinLength(1)
  assigneeId: string = '';

  @IsString() @MinLength(1) @MaxLength(2000)
  reason: string = '';
}

export class SetCaseDueDateInput extends ExpectedCaseRevision {
  @IsOptional() @IsDateString()
  dueAt?: string | null;
}
