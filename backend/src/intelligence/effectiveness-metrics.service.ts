import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { EffectivenessMetricsQueryDto } from './effectiveness-metrics.dto';
import { resolveMetricsPeriod } from './effectiveness-metrics.period';

type TaskTiming = { readonly eligible: number; readonly onTime: number };
type ReportTiming = { readonly eligible: number; readonly averageHours: number | null };
type DistributionTotals = { readonly reportsAvailable: number; readonly distributions: number; readonly viewed: number; readonly responded: number };
type StakeholderCategoryTotals = { readonly category: string; readonly distributions: number; readonly viewed: number; readonly responded: number };
const activeRequirement = ['OPEN', 'IN_COLLECTION', 'IN_ANALYSIS'] as const;
const activeTask = ['PLANNED', 'IN_PROGRESS', 'BLOCKED'] as const;

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
}

function counts<K extends string>(rows: readonly { readonly status: K; readonly _count: { readonly _all: number } }[]): Record<K, number> {
  const result: Record<string, number> = {};
  for (const row of rows) result[row.status] = row._count._all;
  return result;
}

@Injectable()
export class EffectivenessMetricsService {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService) {}

  async get(user: AuthUser, query: EffectivenessMetricsQueryDto) {
    const tenantId = user.role === 'SUPER_ADMIN' ? query.tenantId : user.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant wajib dipilih');
    if (user.role !== 'SUPER_ADMIN' && query.tenantId && query.tenantId !== tenantId) throw new ForbiddenException('Tenant context mismatch');
    for (const feature of ['intelligence-hub', 'indicator-management'] as const) {
      const decision = await this.access.evaluateForTenant(user, tenantId, 'threat-intelligence', [feature]);
      if (!decision.accessible) throw new ForbiddenException(decision.reason ?? 'Threat Intelligence access required');
    }
    const now = new Date();
    const period = resolveMetricsPeriod(query, now);
    const created = { gte: period.from, lt: period.to };
    const disseminated = { gte: period.from, lt: period.to };
    const pirWhere = { tenantId, createdAt: created };
    const sirWhere = { tenantId, createdAt: created };
    const taskWhere = { tenantId, createdAt: created };
    const reportWhere: Prisma.IntelligenceReportWhereInput = { tenantId, createdAt: created, pirId: { not: null } };
    const evidenceWhere = { tenantId, createdAt: created };

    const [pirGroups, sirGroups, pirOverdue, sirOverdue, sirUnanswered, taskGroups, taskOverdue,
      taskTimingRows, reportGroups, reportWithSir, finalDisseminated, reportTimingRows, distributionRows, stakeholderCategories,
      feedbackRatings, furtherRequests, sourceTotal, sourceAssessed, evidenceTotal, evidenceAssessed] = await Promise.all([
      this.prisma.pir.groupBy({ by: ['status'], where: pirWhere, _count: { _all: true } }),
      this.prisma.sir.groupBy({ by: ['status'], where: sirWhere, _count: { _all: true } }),
      this.prisma.pir.count({ where: { ...pirWhere, status: { in: [...activeRequirement] }, dueDate: { lt: now } } }),
      this.prisma.sir.count({ where: { ...sirWhere, status: { in: [...activeRequirement] }, dueDate: { lt: now } } }),
      this.prisma.sir.count({ where: { ...sirWhere, status: { in: [...activeRequirement] }, OR: [{ analystAnswer: null }, { analystAnswer: '' }] } }),
      this.prisma.collectionTask.groupBy({ by: ['status', 'resultKind'], where: taskWhere, _count: { _all: true } }),
      this.prisma.collectionTask.count({ where: { ...taskWhere, status: { in: [...activeTask] }, dueDate: { lt: now } } }),
      this.prisma.$queryRaw<TaskTiming[]>`SELECT COUNT(*) FILTER (WHERE status = 'COMPLETED' AND "dueDate" IS NOT NULL AND "completedAt" IS NOT NULL)::int AS eligible,
        COUNT(*) FILTER (WHERE status = 'COMPLETED' AND "dueDate" IS NOT NULL AND "completedAt" IS NOT NULL AND "completedAt" <= "dueDate")::int AS "onTime"
        FROM "CollectionTask" WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${period.from} AND "createdAt" < ${period.to}`,
      this.prisma.intelligenceReport.groupBy({ by: ['status'], where: reportWhere, _count: { _all: true } }),
      this.prisma.intelligenceReport.count({ where: { ...reportWhere, analysisSirs: { some: {} } } }),
      this.prisma.intelligenceReport.count({ where: { ...reportWhere, status: 'FINAL', disseminations: { some: {} } } }),
      this.prisma.$queryRaw<ReportTiming[]>`SELECT COUNT(*) FILTER (WHERE status = 'FINAL' AND "finalizedAt" IS NOT NULL)::int AS eligible,
        AVG(EXTRACT(EPOCH FROM ("finalizedAt" - "createdAt")) / 3600) FILTER (WHERE status = 'FINAL' AND "finalizedAt" IS NOT NULL)::float AS "averageHours"
        FROM "IntelligenceReport" WHERE "tenantId" = ${tenantId} AND "pirId" IS NOT NULL AND "createdAt" >= ${period.from} AND "createdAt" < ${period.to}`,
      this.prisma.$queryRaw<DistributionTotals[]>`SELECT COUNT(DISTINCT d."reportId")::int AS "reportsAvailable", COUNT(*)::int AS distributions,
        COUNT(*) FILTER (WHERE d."viewedAt" IS NOT NULL)::int AS viewed,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ReportFeedback" f WHERE f."disseminationId" = d.id))::int AS responded
        FROM "ReportDissemination" d JOIN "IntelligenceReport" r ON r.id = d."reportId" AND r."tenantId" = d."tenantId"
        WHERE d."tenantId" = ${tenantId} AND r."pirId" IS NOT NULL AND d."disseminatedAt" >= ${period.from} AND d."disseminatedAt" < ${period.to}`,
      this.prisma.$queryRaw<StakeholderCategoryTotals[]>`SELECT s.category::text AS category, COUNT(*)::int AS distributions,
        COUNT(*) FILTER (WHERE d."viewedAt" IS NOT NULL)::int AS viewed,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ReportFeedback" f WHERE f."disseminationId" = d.id))::int AS responded
        FROM "ReportDissemination" d JOIN "IntelligenceReport" r ON r.id = d."reportId" AND r."tenantId" = d."tenantId"
        JOIN "Stakeholder" s ON s.id = d."stakeholderId" AND s."tenantId" = d."tenantId"
        WHERE d."tenantId" = ${tenantId} AND r."pirId" IS NOT NULL AND d."disseminatedAt" >= ${period.from} AND d."disseminatedAt" < ${period.to}
        GROUP BY s.category ORDER BY s.category`,
      this.prisma.reportFeedback.aggregate({ where: { tenantId, submittedAt: disseminated, dissemination: { report: { pirId: { not: null } } } }, _avg: { relevance: true, actionability: true }, _count: { _all: true } }),
      this.prisma.reportFeedback.count({ where: { tenantId, submittedAt: disseminated, furtherIntelligenceRequest: { not: null }, dissemination: { report: { pirId: { not: null } } } } }),
      this.prisma.intelligenceSource.count({ where: { tenantId, createdAt: created } }),
      this.prisma.intelligenceSource.count({ where: { tenantId, createdAt: created, reliabilityAssessments: { some: {} } } }),
      this.prisma.sirEvidence.count({ where: evidenceWhere }),
      this.prisma.sirEvidence.count({ where: { ...evidenceWhere, credibilityAssessments: { some: {} } } }),
    ]);

    const pir = counts(pirGroups);
    const sir = counts(sirGroups);
    const taskCount = (status: string) => taskGroups.filter(row => row.status === status).reduce((sum, row) => sum + row._count._all, 0);
    const completedFindings = taskGroups.filter(row => row.status === 'COMPLETED' && row.resultKind === 'FINDINGS').reduce((sum, row) => sum + row._count._all, 0);
    const completedNoFindings = taskGroups.filter(row => row.status === 'COMPLETED' && row.resultKind === 'NO_FINDINGS').reduce((sum, row) => sum + row._count._all, 0);
    const reports = counts(reportGroups);
    const pirTotal = pirGroups.reduce((sum, row) => sum + row._count._all, 0);
    const sirTotal = sirGroups.reduce((sum, row) => sum + row._count._all, 0);
    const taskTotal = taskGroups.reduce((sum, row) => sum + row._count._all, 0);
    const reportTotal = reportGroups.reduce((sum, row) => sum + row._count._all, 0);
    const timing = taskTimingRows[0] ?? { eligible: 0, onTime: 0 };
    const production = reportTimingRows[0] ?? { eligible: 0, averageHours: null };
    const distribution = distributionRows[0] ?? { reportsAvailable: 0, distributions: 0, viewed: 0, responded: 0 };
    return {
      period: { range: period.range, from: period.from, toExclusive: period.to, timezone: 'UTC', asOf: now },
      semantics: { cohort: 'Records created in [from, to); current status and assessment coverage as of asOf.', distribution: 'Distributions created in [from, to); views and responses observed as of asOf.', feedback: 'Feedback submitted in [from, to).' },
      requirements: { pirTotal, pirStatus: pir, pirOpen: activeRequirement.reduce((sum, status) => sum + (pir[status] ?? 0), 0), pirOverdue,
        sirTotal, sirStatus: sir, sirOpen: activeRequirement.reduce((sum, status) => sum + (sir[status] ?? 0), 0), sirUnanswered, sirOverdue,
        answered: { numerator: sir.ANSWERED ?? 0, denominator: sirTotal, percent: rate(sir.ANSWERED ?? 0, sirTotal) } },
      collection: { total: taskTotal, status: Object.fromEntries(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'].map(status => [status, taskCount(status)])),
        completed: taskCount('COMPLETED'), blocked: taskCount('BLOCKED'), overdueActive: taskOverdue, completedFindings, completedNoFindings,
        onTime: { numerator: timing.onTime, denominator: timing.eligible, percent: rate(timing.onTime, timing.eligible) } },
      reporting: { total: reportTotal, status: reports, withPir: reportTotal, withSir: reportWithSir, finalizedDisseminated: finalDisseminated,
        productionHours: { average: production.averageHours, sampleSize: production.eligible } },
      dissemination: { reportsAvailable: distribution.reportsAvailable, distributions: distribution.distributions, viewed: distribution.viewed,
        feedbackSubmittedForDistributions: distribution.responded,
        responseRate: { numerator: distribution.responded, denominator: distribution.distributions, percent: rate(distribution.responded, distribution.distributions) },
        feedbackSubmittedInPeriod: feedbackRatings._count._all, relevance: { average: feedbackRatings._avg.relevance, sampleSize: feedbackRatings._count._all },
        actionability: { average: feedbackRatings._avg.actionability, sampleSize: feedbackRatings._count._all }, furtherIntelligenceRequests: furtherRequests,
        stakeholderCategories: stakeholderCategories.map(row => ({ ...row, responsePercent: rate(row.responded, row.distributions) })) },
      assessmentCoverage: { sources: { eligible: sourceTotal, assessed: sourceAssessed, unassessed: sourceTotal - sourceAssessed },
        evidence: { eligible: evidenceTotal, assessed: evidenceAssessed, unassessed: evidenceTotal - evidenceAssessed } },
    };
  }
}
