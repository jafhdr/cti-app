import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const evidenceTypes = ['INDICATOR', 'THREAT_ACTOR', 'CAMPAIGN'] as const;
export type EvidenceType = typeof evidenceTypes[number];

export class SearchSirEvidenceDto {
  @IsIn(evidenceTypes) type!: EvidenceType;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() tenantId?: string;
}

export class AttachSirEvidenceDto {
  @IsIn(evidenceTypes) type!: EvidenceType;
  @IsString() sourceId!: string;
  @IsOptional() @IsString() @MaxLength(1000) relevanceNote?: string | null;
}

export class UpdateSirEvidenceDto {
  @IsOptional() @IsString() @MaxLength(1000) relevanceNote?: string | null;
}
