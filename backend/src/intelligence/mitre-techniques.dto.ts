import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';

export class ListMitreTechniquesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsString() @MaxLength(120) tactic?: string;
  @IsOptional() @IsString() @MaxLength(120) platform?: string;
  @IsOptional() @IsString() tenantId?: string;
}

export class CreateMitreTechniqueDto {
  @IsString() @MaxLength(40) externalId!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(8000) description?: string;
  @IsString() @MaxLength(120) tactic!: string;
  @IsString() @MaxLength(120) platform!: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) url?: string;
}

export class UpdateMitreTechniqueDto {
  @IsOptional() @IsString() @MaxLength(40) externalId?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(8000) description?: string;
  @IsOptional() @IsString() @MaxLength(120) tactic?: string;
  @IsOptional() @IsString() @MaxLength(120) platform?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) url?: string;
}
