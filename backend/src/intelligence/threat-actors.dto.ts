import { Type } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { IndicatorSeverity, ThreatActorStatus } from '@prisma/client';
import { z } from 'zod';

export class ListThreatActorsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsEnum(IndicatorSeverity) severity?: IndicatorSeverity;
  @IsOptional() @IsEnum(ThreatActorStatus) status?: ThreatActorStatus;
  @IsOptional() @IsString() @MaxLength(120) country?: string;
  @IsOptional() @IsString() @MaxLength(120) sector?: string;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsString() sortOrder?: string;
  @IsOptional() @IsString() tenantId?: string;
}

export class CreateThreatActorDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) aliases?: string[];
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(1000) motivation?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) targetSectors?: string[];
  @IsOptional() @IsString() @MaxLength(120) country?: string;
  @IsOptional() @IsString() @MaxLength(120) region?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) confidence?: number;
  @IsOptional() @IsEnum(IndicatorSeverity) severity?: IndicatorSeverity;
  @IsOptional() @IsEnum(ThreatActorStatus) status?: ThreatActorStatus;
  @IsOptional() @IsString() @MaxLength(160) externalId?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) referenceUrl?: string;
}

export class UpdateThreatActorDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) aliases?: string[];
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(1000) motivation?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) targetSectors?: string[];
  @IsOptional() @IsString() @MaxLength(120) country?: string;
  @IsOptional() @IsString() @MaxLength(120) region?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) confidence?: number;
  @IsOptional() @IsEnum(IndicatorSeverity) severity?: IndicatorSeverity;
  @IsOptional() @IsEnum(ThreatActorStatus) status?: ThreatActorStatus;
  @IsOptional() @IsString() @MaxLength(160) externalId?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) referenceUrl?: string;
}

const stixActorProperties = {
  name: z.string().trim().min(1).max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
  description: z.string().max(4000).optional(),
  primary_motivation: z.string().max(1000).optional(),
  country_codes: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  region_codes: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  goals: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
};

const stixStObjectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('threat-actor'), id: z.string().trim().min(1).max(160).regex(/^threat-actor--/), ...stixActorProperties }).catchall(z.json()),
  z.object({ type: z.literal('intrusion-set'), id: z.string().trim().min(1).max(160).regex(/^intrusion-set--/), ...stixActorProperties }).catchall(z.json()),
]);

const stixThreatActorSchema = stixStObjectSchema.transform(data => ({ ...data, type: 'threat-actor' as const }));

export const batchThreatActorsSchema = z.object({
  threatActors: z.array(stixThreatActorSchema).min(1).max(100),
});

export type StixThreatActorDto = z.infer<typeof stixThreatActorSchema>;
export type BatchThreatActorsDto = z.infer<typeof batchThreatActorsSchema>;

export function parseStixThreatActorDto(input: unknown): StixThreatActorDto {
  const result = stixThreatActorSchema.safeParse(input);
  if (!result.success) throw new BadRequestException({ message: 'Payload STIX threat actor tidak valid', errors: result.error.flatten() });
  return result.data;
}

export function parseBatchThreatActorsDto(input: unknown): BatchThreatActorsDto {
  const result = batchThreatActorsSchema.safeParse(input);
  if (!result.success) throw new BadRequestException({ message: 'Payload batch threat actor tidak valid', errors: result.error.flatten() });
  return result.data;
}
