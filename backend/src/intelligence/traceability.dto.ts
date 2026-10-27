import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class TracePageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit = 5;
  @IsOptional() @IsString() tenantId?: string;
}
