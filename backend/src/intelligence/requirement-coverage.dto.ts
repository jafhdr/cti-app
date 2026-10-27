import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const coverageGaps = ['NO_TASK', 'NO_VISIBLE_EVIDENCE', 'BLOCKED', 'OVERDUE', 'AWAITING_REVIEW', 'FURTHER_INTELLIGENCE'] as const;
export type CoverageGap = typeof coverageGaps[number];

export class ListCoverageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit = 10;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsString() pirId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() outstandingOnly = false;
  @IsOptional() @IsIn(coverageGaps) gap?: CoverageGap;
}
