import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CollectionTaskStatus } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CoverageGap, ListCoverageDto } from './requirement-coverage.dto';

const activeTaskStatuses: readonly CollectionTaskStatus[] = ['PLANNED', 'IN_PROGRESS', 'BLOCKED'];
const activeSirStatuses = ['OPEN', 'IN_COLLECTION', 'IN_ANALYSIS'] as const;
type SirRow = { id: string; pirId: string; reference: string; title: string; status: string; priority: string; analystAnswer: string | null; pir: { reference: string; title: string } };

@Injectable()
export class RequirementCoverageService {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService) {}

  private tenant(user: AuthUser, requested?: string): string {
    if (user.role === 'SUPER_ADMIN') {
      if (!requested) throw new BadRequestException('Tenant wajib dipilih');
      return requested;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }

  private async indicators(user: AuthUser, tenantId: string): Promise<boolean> {
    return (await this.access.evaluateForTenant(user, tenantId, 'threat-intelligence', ['indicator-management'])).accessible;
  }

  private reportWhere(tenantId: string, indicators: boolean): Prisma.IntelligenceReportWhereInput {
    return { tenantId, pirId: { not: null },
      ...(!indicators ? { AND: [{ analysisEvidence: { none: { evidence: { indicatorId: { not: null } } } } }] } : {}),
    };
  }

  private feedbackWhere(tenantId: string, indicators: boolean): Prisma.IntelligenceReportWhereInput {
    return { ...this.reportWhere(tenantId, indicators), disseminations: { some: { feedback: { is: { furtherIntelligenceRequest: { not: null } } } } } };
  }

  private gapCondition(gap: CoverageGap, tenantId: string, indicators: boolean, canSeeReports: boolean, now: Date): Prisma.SirWhereInput {
    switch (gap) {
      case 'NO_TASK': return { collectionTasks: { none: {} } };
      case 'NO_VISIBLE_EVIDENCE': return { status: { in: [...activeSirStatuses] }, evidence: { none: indicators ? {} : { indicatorId: null } } };
      case 'BLOCKED': return { collectionTasks: { some: { status: 'BLOCKED' } } };
      case 'OVERDUE': return { collectionTasks: { some: { status: { in: [...activeTaskStatuses] }, dueDate: { lt: now } } } };
      case 'AWAITING_REVIEW': return { status: { in: [...activeSirStatuses] }, analystAnswer: null, collectionTasks: { some: { status: 'COMPLETED', resultKind: { not: null } } } };
      case 'FURTHER_INTELLIGENCE': return canSeeReports ? { analysisReportSirs: { some: { report: this.feedbackWhere(tenantId, indicators) } } } : { id: { in: [] } };
    }
  }

  private gaps(tenantId: string, indicators: boolean, canSeeReports: boolean, now: Date): Prisma.SirWhereInput[] {
    const keys: CoverageGap[] = ['NO_TASK', 'NO_VISIBLE_EVIDENCE', 'BLOCKED', 'OVERDUE', 'AWAITING_REVIEW', 'FURTHER_INTELLIGENCE'];
    return keys.map(key => this.gapCondition(key, tenantId, indicators, canSeeReports, now));
  }

  private async rows(user: AuthUser, tenantId: string, rows: SirRow[], indicators: boolean, now: Date) {
    if (!rows.length) return [];
    const ids = rows.map(row => row.id);
    const canSeeReports = user.role !== 'USER';
    const [taskGroups, overdueGroups, sourceGroups, evidenceGroups, reportGroups, feedbackGroups] = await Promise.all([
      this.prisma.collectionTask.groupBy({ by: ['sirId', 'status', 'resultKind'], where: { tenantId, sirId: { in: ids } }, _count: { _all: true } }),
      this.prisma.collectionTask.groupBy({ by: ['sirId'], where: { tenantId, sirId: { in: ids }, status: { in: [...activeTaskStatuses] }, dueDate: { lt: now } }, _count: { _all: true } }),
      this.prisma.collectionTask.groupBy({ by: ['sirId'], where: { tenantId, sirId: { in: ids }, sourceId: { not: null } }, _count: { _all: true } }),
      this.prisma.sirEvidence.groupBy({ by: ['sirId'], where: { tenantId, sirId: { in: ids }, ...(!indicators ? { indicatorId: null } : {}) }, _count: { _all: true } }),
      canSeeReports ? this.prisma.intelligenceReportSir.groupBy({ by: ['sirId'], where: { tenantId, sirId: { in: ids }, report: this.reportWhere(tenantId, indicators) }, _count: { _all: true } }) : Promise.resolve([]),
      canSeeReports ? this.prisma.intelligenceReportSir.groupBy({ by: ['sirId'], where: { tenantId, sirId: { in: ids }, report: this.feedbackWhere(tenantId, indicators) }, _count: { _all: true } }) : Promise.resolve([]),
    ]);
    const count = (groups: readonly { sirId: string; _count: { _all: number } }[], id: string) => groups.find(group => group.sirId === id)?._count._all ?? 0;
    return rows.map(sir => {
      const task = taskGroups.filter(group => group.sirId === sir.id);
      const byStatus = (status: CollectionTaskStatus) => task.filter(group => group.status === status).reduce((sum, group) => sum + group._count._all, 0);
      const completedFindings = task.filter(group => group.status === 'COMPLETED' && group.resultKind === 'FINDINGS').reduce((sum, group) => sum + group._count._all, 0);
      const completedNoFindings = task.filter(group => group.status === 'COMPLETED' && group.resultKind === 'NO_FINDINGS').reduce((sum, group) => sum + group._count._all, 0);
      const taskTotal = task.reduce((sum, group) => sum + group._count._all, 0);
      const visibleEvidence = count(evidenceGroups, sir.id);
      const overdue = count(overdueGroups, sir.id);
      const blocked = byStatus('BLOCKED');
      const feedbackRequestReports = count(feedbackGroups, sir.id);
      const answered = Boolean(sir.analystAnswer?.trim());
      const active = activeSirStatuses.some(status => status === sir.status);
      const gaps: { code: CoverageGap; explanation: string }[] = [];
      if (!taskTotal) gaps.push({ code: 'NO_TASK', explanation: 'No collection task is linked to this SIR.' });
      if (active && !visibleEvidence) gaps.push({ code: 'NO_VISIBLE_EVIDENCE', explanation: 'No SIR evidence is visible with your current access.' });
      if (blocked) gaps.push({ code: 'BLOCKED', explanation: 'At least one collection task is blocked.' });
      if (overdue) gaps.push({ code: 'OVERDUE', explanation: 'An unfinished collection task is past its due date.' });
      if (active && !answered && completedFindings + completedNoFindings > 0) gaps.push({ code: 'AWAITING_REVIEW', explanation: 'Collection finished, but no analyst answer is recorded.' });
      if (feedbackRequestReports) gaps.push({ code: 'FURTHER_INTELLIGENCE', explanation: 'Feedback on a related report explicitly requests further intelligence; it is not attributed to this SIR alone.' });
      return { sir: { id: sir.id, pirId: sir.pirId, reference: sir.reference, title: sir.title, status: sir.status, priority: sir.priority, pir: sir.pir },
        signals: { taskTotal, activeTasks: byStatus('PLANNED') + byStatus('IN_PROGRESS') + blocked, planned: byStatus('PLANNED'), inProgress: byStatus('IN_PROGRESS'), blocked, overdue, completedFindings, completedNoFindings, documentedResults: task.filter(group => group.resultKind !== null).reduce((sum, group) => sum + group._count._all, 0), tasksWithSource: count(sourceGroups, sir.id), visibleEvidence, analystAnswer: answered, relatedReports: canSeeReports ? count(reportGroups, sir.id) : null, feedbackRequestReports: canSeeReports ? feedbackRequestReports : null },
        gaps, outstanding: gaps.length > 0,
        note: 'Workflow facts only. Task completion and counts do not prove analytical completeness.' };
    });
  }

  async list(user: AuthUser, query: ListCoverageDto) {
    const tenantId = this.tenant(user, query.tenantId);
    const indicators = await this.indicators(user, tenantId);
    const canSeeReports = user.role !== 'USER';
    const now = new Date();
    const base: Prisma.SirWhereInput = { tenantId, ...(query.pirId ? { pirId: query.pirId } : {}), ...(query.search?.trim() ? { OR: [{ reference: { contains: query.search.trim(), mode: 'insensitive' } }, { title: { contains: query.search.trim(), mode: 'insensitive' } }] } : {}) };
    const condition = query.gap ? this.gapCondition(query.gap, tenantId, indicators, canSeeReports, now) : { OR: this.gaps(tenantId, indicators, canSeeReports, now) };
    const where: Prisma.SirWhereInput = query.outstandingOnly || query.gap ? { AND: [base, condition] } : base;
    const [items, total, allTotal, outstanding] = await Promise.all([
      this.prisma.sir.findMany({ where, select: { id: true, pirId: true, reference: true, title: true, status: true, priority: true, analystAnswer: true, pir: { select: { reference: true, title: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.sir.count({ where }),
      this.prisma.sir.count({ where: base }),
      this.prisma.sir.count({ where: { AND: [base, { OR: this.gaps(tenantId, indicators, canSeeReports, now) }] } }),
    ]);
    return { items: await this.rows(user, tenantId, items, indicators, now), total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit), summary: { requirements: allTotal, withOperationalGaps: outstanding }, restricted: { reportsAndFeedback: !canSeeReports } };
  }

  async get(user: AuthUser, id: string, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const sir = await this.prisma.sir.findFirst({ where: { id, tenantId }, select: { id: true, pirId: true, reference: true, title: true, status: true, priority: true, analystAnswer: true, pir: { select: { reference: true, title: true } } } });
    if (!sir) throw new NotFoundException('SIR not found');
    const [result] = await this.rows(user, tenantId, [sir], await this.indicators(user, tenantId), new Date());
    return result;
  }
}
