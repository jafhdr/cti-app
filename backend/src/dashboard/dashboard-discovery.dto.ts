import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class DashboardSearchQuery {
  @IsString() @MaxLength(120) q = '';
  @IsOptional() @IsString() tenantId?: string;
}

export class DashboardNotificationQuery {
  @IsOptional() @IsISO8601() snapshotAt?: string;
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit = 10;
}
