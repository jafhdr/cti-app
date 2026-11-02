import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { AsmV2PriorityService } from './asm-v2-priority.service';
import { PRIORITY_EVALUATOR_VERSION } from './priority-evaluator';
import type { OperationsAssetsQueryDto } from './asm-v2-operations.dto';

const BATCH = 25;
const FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;
const snapshot = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120000 } as const;
const definitions = {
  correlationTotal: 'Distinct V2 correlation rows; observation and decision events do not add rows.',
  reviewStates: 'Current review state of V2 correlations, independent of observation status.',
  observationStates: 'Current ACTIVE or STALE observation status, independent of review state.',
  awaitingReview: 'PENDING or REVIEW_REQUIRED, including stale observations.',
  currentlyReviewable: 'ACTIVE and PENDING or REVIEW_REQUIRED.',
  actionableCorrelations: 'Eligible IDs from assessed asm-reviewed-priority-v1 results only.',
  highPriorityAssets: 'Distinct assets with HIGH or CRITICAL contextual priority.',
  notAssessedAssets: 'Distinct assets with NOT_ASSESSED; never counted as LOW.',
  freshness: 'V2 correlation lastSeenAt within 30 days and not in the future; source freshness also checked by the evaluator.',
} as const;
const limitations = [
  'Counts for review and observation are overlapping dimensions and must not be summed.',
  'Separate HTTP requests use separate database snapshots; compare their asOf timestamps.',
  'OPEN service is observed open, not proven public internet exposure. Review does not prove exploitation.',
  'Historical V1 Finding and Risk Posture remain independent of V2 priority.',
  'More than 100 correlations on one asset produce NOT_ASSESSED, not a partial priority.',
  'MEDIUM asset criticality may be a database default; explicit selection provenance is unavailable.',
] as const;

type RawCounts = {
  total: number; pending: number; accepted: number; rejected: number; reviewRequired: number;
  active: number; stale: number; awaitingReview: number; currentlyReviewable: number;
  fresh: number; expired: number; future: number;
};

@Injectable()
export class AsmV2OperationsService {
  constructor(private readonly prisma: PrismaService, private readonly priority: AsmV2PriorityService) {}

  private async tenant(user: AuthUser, requested?: string) {
    if (process.env.ASM_V2_OPERATIONS_ENABLED !== 'true') throw new ForbiddenException('ASM V2 operations belum diaktifkan');
    return this.priority.requireAvailability(user, requested);
  }

  private async counts(tx: Prisma.TransactionClient, tenantId: string, asOf: Date): Promise<RawCounts> {
    const cutoff = new Date(asOf.getTime() - FRESHNESS_MS);
    const rows = await tx.$queryRaw<RawCounts[]>(Prisma.sql`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "reviewStatus" = 'PENDING' OR "reviewStatus" IS NULL)::int AS pending,
        COUNT(*) FILTER (WHERE "reviewStatus" = 'ACCEPTED')::int AS accepted,
        COUNT(*) FILTER (WHERE "reviewStatus" = 'REJECTED')::int AS rejected,
        COUNT(*) FILTER (WHERE "reviewStatus" = 'REVIEW_REQUIRED')::int AS "reviewRequired",
        COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
        COUNT(*) FILTER (WHERE status = 'STALE')::int AS stale,
        COUNT(*) FILTER (WHERE "reviewStatus" IN ('PENDING', 'REVIEW_REQUIRED') OR "reviewStatus" IS NULL)::int AS "awaitingReview",
        COUNT(*) FILTER (WHERE status = 'ACTIVE' AND ("reviewStatus" IN ('PENDING', 'REVIEW_REQUIRED') OR "reviewStatus" IS NULL))::int AS "currentlyReviewable",
        COUNT(*) FILTER (WHERE "lastSeenAt" >= ${cutoff} AND "lastSeenAt" <= ${asOf})::int AS fresh,
        COUNT(*) FILTER (WHERE "lastSeenAt" < ${cutoff})::int AS expired,
        COUNT(*) FILTER (WHERE "lastSeenAt" > ${asOf})::int AS future
      FROM "AssetVulnerabilityCorrelation"
      WHERE "tenantId" = ${tenantId} AND "workflowVersion" = 2
    `);
    return rows[0] ?? { total: 0, pending: 0, accepted: 0, rejected: 0, reviewRequired: 0,
      active: 0, stale: 0, awaitingReview: 0, currentlyReviewable: 0, fresh: 0, expired: 0, future: 0 };
  }

  async summary(user: AuthUser, requested?: string) {
    const tenantId = await this.tenant(user, requested);
    const asOf = new Date();
    return this.prisma.$transaction(async tx => {
      const correlations = await this.counts(tx, tenantId, asOf);
      let after: string | undefined;
      let totalAssets = 0;
      let actionableCorrelations = 0;
      let highPriorityAssets = 0;
      let notAssessedAssets = 0;
      let staleSourceExclusions = 0;
      let limitExceededAssets = 0;
      do {
        const assets = await tx.asset.findMany({ where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: 'asc' }, take: BATCH, select: { id: true, criticality: true } });
        if (assets.length === 0) break;
        const results = await this.priority.evaluateBatch(tenantId, assets, asOf, tx);
        for (const asset of assets) {
          const result = results.get(asset.id);
          if (!result) throw new Error('Missing priority evaluation');
          totalAssets++;
          actionableCorrelations += result.eligibleCount;
          if (result.priority === 'HIGH' || result.priority === 'CRITICAL') highPriorityAssets++;
          if (result.priority === 'NOT_ASSESSED') notAssessedAssets++;
          staleSourceExclusions += result.excluded.STALE_SOURCE ?? 0;
          if (result.missing.includes('CORRELATION_LIMIT_EXCEEDED')) limitExceededAssets++;
        }
        after = assets[assets.length - 1].id;
        if (assets.length < BATCH) break;
      } while (true);
      return { tenantId, asOf: asOf.toISOString(), evaluatorVersion: PRIORITY_EVALUATOR_VERSION,
        metrics: { totalAssets, correlations, actionableCorrelations, highPriorityAssets, notAssessedAssets,
          staleSourceExclusions, limitExceededAssets }, definitions, limitations,
        reviewQueueUrl: '/attack-surface/review' };
    }, snapshot);
  }

  async assets(user: AuthUser, query: OperationsAssetsQueryDto) {
    const tenantId = await this.tenant(user, query.tenantId);
    const asOf = new Date();
    const q = query.q?.trim() || undefined;
    return this.prisma.$transaction(async tx => {
      if (query.cursor && !(await tx.asset.findFirst({ where: { id: query.cursor, tenantId }, select: { id: true } }))) {
        throw new NotFoundException('Cursor tidak ditemukan');
      }
      let after: string | undefined;
      let total = 0;
      let afterCursorTotal = 0;
      const items: Array<{ assetId: string; name: string; value: string; type: string; criticality: string;
        priority: string; score: number | null; eligibleCount: number; excluded: object; missing: string[];
        mainEvidence: { correlationId: string; serviceId: string; cveId: string; serviceObservedAt: string } | null }> = [];
      let nextCursor: string | null = null;
      do {
        const assets = await tx.asset.findMany({
          where: { tenantId, ...(after ? { id: { gt: after } } : {}),
            ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { value: { contains: q, mode: 'insensitive' } }] } : {}) },
          orderBy: { id: 'asc' }, take: BATCH,
          select: { id: true, name: true, value: true, type: true, criticality: true },
        });
        if (assets.length === 0) break;
        const results = await this.priority.evaluateBatch(tenantId, assets, asOf, tx);
        for (const asset of assets) {
          const result = results.get(asset.id);
          if (!result) throw new Error('Missing priority evaluation');
          if (query.priority && result.priority !== query.priority) continue;
          total++;
          if (!query.cursor || asset.id > query.cursor) {
            afterCursorTotal++;
            if (items.length < query.limit) {
              const main = result.contributing[0];
              items.push({ assetId: asset.id, name: asset.name, value: asset.value, type: asset.type,
                criticality: asset.criticality, priority: result.priority, score: result.score,
                eligibleCount: result.eligibleCount, excluded: result.excluded, missing: result.missing,
                mainEvidence: main ? { correlationId: main.correlationId, serviceId: main.serviceId,
                  cveId: main.cveId, serviceObservedAt: main.serviceObservedAt } : null });
              nextCursor = asset.id;
            }
          }
        }
        after = assets[assets.length - 1].id;
        if (assets.length < BATCH) break;
      } while (true);
      const hasMore = afterCursorTotal > items.length;
      return { tenantId, asOf: asOf.toISOString(), evaluatorVersion: PRIORITY_EVALUATOR_VERSION,
        items, total, limit: query.limit, nextCursor: hasMore ? nextCursor : null, definitions, limitations };
    }, snapshot);
  }
}
