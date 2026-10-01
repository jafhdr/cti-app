import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AssetFindingSeverity, AssetFindingStatus } from '@prisma/client';

export class CreateFindingDto {
  @IsString() @MaxLength(255) title!: string;
  @IsString() @MaxLength(4000) description!: string;
  @IsString() @MaxLength(120) type!: string;
  @IsEnum(AssetFindingSeverity) severity!: AssetFindingSeverity;
}

export class UpdateFindingDto {
  @IsOptional() @IsEnum(AssetFindingSeverity) severity?: AssetFindingSeverity;
  @IsOptional() @IsEnum(AssetFindingStatus) status?: AssetFindingStatus;
}
