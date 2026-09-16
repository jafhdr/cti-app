import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { MitreAttackStixClient } from './mitre-attack-stix.client';
import { parseStixThreatActorDto } from './threat-actors.dto';
import type { StixThreatActorDto } from './threat-actors.dto';
import { ThreatActorsService } from './threat-actors.service';

const intrusionSetCandidateSchema = z.object({ type: z.literal('intrusion-set') }).passthrough();

export type MitreThreatActorIngestionResult = {
  readonly total: number;
  readonly created: number;
  readonly updated: number;
  readonly failed: number;
};

@Injectable()
export class MitreThreatActorIngestionService {
  constructor(
    private readonly client: MitreAttackStixClient,
    private readonly threatActors: ThreatActorsService,
    private readonly prisma: PrismaService,
  ) {}

  async ingest(user: AuthUser, requestedTenantId?: string): Promise<MitreThreatActorIngestionResult> {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const bundle = await this.client.fetchEnterpriseBundle();
    const candidates = bundle.objects.filter(object => intrusionSetCandidateSchema.safeParse(object).success);
    const normalized: StixThreatActorDto[] = [];
    let failed = 0;
    for (const candidate of candidates) {
      try {
        normalized.push(parseStixThreatActorDto(candidate));
      } catch (error) {
        if (error instanceof BadRequestException) failed += 1;
        else throw error;
      }
    }
    const batch = normalized.length > 0
      ? await this.threatActors.batch(user, { threatActors: normalized }, requestedTenantId)
      : { created: 0, updated: 0 };
    const result = { total: candidates.length, created: batch.created, updated: batch.updated, failed };
    await this.prisma.auditLog.create({ data: { userId: user.sub, tenantId, action: 'MITRE_THREAT_ACTORS_INGESTED', metadata: result } });
    return result;
  }

  private resolveTenant(user: AuthUser, requestedTenantId?: string): string {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib dipilih');
      return requestedTenantId;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
}
