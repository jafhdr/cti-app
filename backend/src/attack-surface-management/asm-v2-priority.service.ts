import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AssetCriticality } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ModuleAccessService } from '../auth/module-access.service';
import type { AuthUser } from '../users/users.types';
import { AsmV2EvidenceService } from './asm-v2-evidence.service';
import { evaluateContextualPriority } from './priority-evaluator';
import { matchVersion } from './version-match';
import { correlationEvidence } from './correlation-evidence';

type AssetIdentity = { readonly id: string; readonly criticality: AssetCriticality };
type PriorityDb = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AsmV2PriorityService {
  constructor(private readonly prisma: PrismaService, private readonly evidence: AsmV2EvidenceService,
    private readonly access: ModuleAccessService) {}

  async requireAvailability(user: AuthUser, requestedTenantId?: string): Promise<string> {
    const tenantId = await this.evidence.tenant(user, requestedTenantId);
    if (user.role === 'SUPER_ADMIN') {
      const permission = await this.access.evaluateForTenant(user, tenantId, 'attack-surface-management', ['asset-management']);
      if (!permission.accessible) throw new ForbiddenException(permission.reason);
    }
    if (process.env.ASM_V2_PRIORITY_ENABLED !== 'true' || !(await this.evidence.enabledForTenant(tenantId))) {
      throw new ForbiddenException('ASM V2 priority belum diaktifkan');
    }
    return tenantId;
  }

  async evaluate(user: AuthUser, assetId: string, requestedTenantId?: string) {
    const tenantId = await this.requireAvailability(user, requestedTenantId);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true, criticality: true } });
    if (!asset) throw new NotFoundException('Asset tidak ditemukan');
    const result = await this.evaluateBatch(tenantId, [asset], new Date());
    return { tenantId, ...result.get(assetId) };
  }

  async evaluateBatch(tenantId: string, assets: readonly AssetIdentity[], asOf: Date, db: PriorityDb = this.prisma) {
    const results = new Map<string, ReturnType<typeof evaluateContextualPriority>>();
    if (assets.length === 0) return results;
    if (assets.length > 50) throw new Error('Priority batch exceeds 50 assets');
    const ranked = await db.$queryRaw<Array<{ id: string; assetId: string }>>(Prisma.sql`
      WITH ranked AS (
        SELECT c.id, c."assetId", ROW_NUMBER() OVER (PARTITION BY c."assetId" ORDER BY c.id) AS rn
        FROM "AssetVulnerabilityCorrelation" c
        WHERE c."tenantId" = ${tenantId} AND c."assetId" IN (${Prisma.join(assets.map(asset => asset.id))})
      )
      SELECT id, "assetId" FROM ranked WHERE rn <= 101
    `);
    const rows = await db.assetVulnerabilityCorrelation.findMany({
      where: { tenantId, id: { in: ranked.map(row => row.id) } },
      select: {
        id: true, tenantId: true, assetId: true, workflowVersion: true, status: true, reviewStatus: true,
        evidenceHash: true, reviewedEvidenceHash: true, confidence: true, lastSeenAt: true,
        service: { select: { id: true, tenantId: true, assetId: true, status: true, lastSeenAt: true, firstSeenAt: true, port: true, protocol: true, service: true, product: true, version: true, source: true } },
        vulnerability: { select: { id: true, tenantId: true, cveId: true, severity: true, cvssScore: true, affectedProduct: true, affectedVersionExact: true, affectedVersionStart: true, affectedVersionEnd: true, source: true, updatedAt: true } },
      },
    });
    const byAsset = new Map<string, typeof rows>();
    for (const row of rows) {
      const current = byAsset.get(row.assetId) ?? [];
      current.push(row);
      byAsset.set(row.assetId, current);
    }
    for (const asset of assets) {
      const candidates = (byAsset.get(asset.id) ?? []).sort((left, right) => left.id.localeCompare(right.id));
      results.set(asset.id, evaluateContextualPriority({ tenantId, assetId: asset.id, criticality: asset.criticality,
        asOf, truncated: candidates.length > 100, candidates: candidates.slice(0, 100).map(row => {
          const match = matchVersion(row.service, row.vulnerability);
          const currentSourceMatch = !!match && correlationEvidence(row.service, row.vulnerability, match).evidenceHash === row.evidenceHash;
          return { ...row, currentSourceMatch };
        }) }));
    }
    return results;
  }
}
