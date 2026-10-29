import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class OperationsAssetsQueryDto {
  @IsOptional() @IsString() @MaxLength(80)
  tenantId?: string;

  @IsOptional() @IsIn(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NOT_ASSESSED'])
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_ASSESSED';

  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  @IsOptional() @IsString() @MaxLength(80)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(25)
  limit = 10;
}
