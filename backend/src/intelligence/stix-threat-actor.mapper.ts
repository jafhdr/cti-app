import type { Prisma } from '@prisma/client';
import type { StixThreatActorDto } from './threat-actors.dto';

const MAPPED_FIELDS = new Set([
  'type', 'id', 'name', 'aliases', 'description', 'primary_motivation',
  'country_codes', 'region_codes', 'goals',
]);

export type MappedThreatActor = {
  readonly externalId: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description?: string;
  readonly motivation?: string;
  readonly country?: string;
  readonly region?: string;
  readonly targetSectors: readonly string[];
  readonly metadata: Prisma.InputJsonObject;
};

export function mapStixThreatActor(input: StixThreatActorDto): MappedThreatActor {
  const metadata: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!MAPPED_FIELDS.has(key)) metadata[key] = value;
  }

  return {
    externalId: input.id,
    name: input.name,
    aliases: input.aliases ?? [],
    description: input.description,
    motivation: input.primary_motivation,
    country: input.country_codes?.[0],
    region: input.region_codes?.[0],
    targetSectors: input.goals ?? [],
    metadata,
  };
}
