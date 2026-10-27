import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { StakeholderCategory, StakeholderScope, StakeholderType, TlpLevel } from '@prisma/client';

export class ListStakeholdersQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsEnum(StakeholderCategory) category?: StakeholderCategory;
  @IsOptional() @Transform(({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() tenantId?: string;
}

export class CreateStakeholderDto {
  @IsString() @MaxLength(160) name!: string;
  @IsEnum(StakeholderScope) scope!: StakeholderScope;
  @IsEnum(StakeholderCategory) category!: StakeholderCategory;
  @IsEnum(StakeholderType) type!: StakeholderType;
  @IsOptional() @IsString() responsibleUserId?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) intelligenceInterests?: string | null;
  @IsOptional() @IsString() @MaxLength(120) reportingFormat?: string | null;
  @IsOptional() @IsString() @MaxLength(120) reportingFrequency?: string | null;
  @IsOptional() @IsString() @MaxLength(120) distributionChannel?: string | null;
  @IsOptional() @IsEnum(TlpLevel) classificationPreference?: TlpLevel | null;
}

export class UpdateStakeholderDto extends CreateStakeholderDto {
  @IsOptional() name!: string;
  @IsOptional() scope!: StakeholderScope;
  @IsOptional() category!: StakeholderCategory;
  @IsOptional() type!: StakeholderType;
}
