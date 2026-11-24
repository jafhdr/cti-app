import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const REVIEW_KINDS = ['ACCEPT', 'REJECT', 'REQUEST_REVIEW'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export class CorrelationDecisionDto {
  @IsIn(REVIEW_KINDS)
  kind!: ReviewKind;

  @IsString() @Length(1, 1000)
  reason!: string;

  @IsInt() @Min(1) @Max(2147483646)
  expectedRevision!: number;

  @IsString() @Length(64, 64)
  evidenceHash!: string;

  @IsString() @Length(8, 100)
  requestKey!: string;

  @IsOptional() @IsBoolean()
  inspectedEvidence?: boolean;

  @IsOptional() @IsString() @Length(1, 1000)
  overrideReason?: string;
}
