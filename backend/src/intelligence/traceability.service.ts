import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { CollectionTasksService } from './collection-tasks.service';
import type { TracePageDto } from './traceability.dto';

@Injectable()
export class TraceabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ModuleAccessService,
    private readonly tasks: CollectionTasksService,
  ) {}

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

  private page(query: TracePageDto) {
    return { skip: (query.page - 1) * query.limit, take: query.limit };
  }

  async sir(user: AuthUser, id: string, query: TracePageDto) {
    const tenantId = this.tenant(user, query.tenantId);
    const sir = await this.prisma.sir.findFirst({
      where: { id, tenantId },
      select: { id: true, reference: true, title: true, pir: { select: { id: true, reference: true, title: true } } },
    });
    if (!sir) throw new NotFoundException('SIR not found');
    const indicators = await this.indicators(user, tenantId);
    const evidenceWhere: Prisma.SirEvidenceWhereInput = { tenantId, sirId: id, ...(!indicators ? { indicatorId: null } : {}) };
    const reportWhere: Prisma.IntelligenceReportWhereInput = { ...this.reportWhere(tenantId, indicators), analysisSirs: { some: { sirId: id, tenantId } } };
    const [tasks, progress, evidence, evidenceTotal, reportRows, reportTotal] = await Promise.all([
      this.tasks.list(user, { page: query.page, limit: query.limit, sirId: id, sortBy: 'updatedAt', sortOrder: 'desc' }),
      this.tasks.progress(user, id, query.tenantId),
      this.prisma.sirEvidence.findMany({ where: evidenceWhere, select: { id: true, relevanceNote: true, indicatorId: true, threatActorId: true, campaignId: true }, orderBy: { createdAt: 'desc' }, ...this.page(query) }),
      this.prisma.sirEvidence.count({ where: evidenceWhere }),
      user.role === 'USER' ? Promise.resolve([]) : this.prisma.intelligenceReport.findMany({ where: reportWhere, select: { id: true, reference: true, title: true, status: true, tlp: true, finalizedAt: true }, orderBy: { updatedAt: 'desc' }, ...this.page(query) }),
      user.role === 'USER' ? Promise.resolve(0) : this.prisma.intelligenceReport.count({ where: reportWhere }),
    ]);
    return { sir, progress, tasks, evidence: { items: evidence, total: evidenceTotal, page: query.page }, reports: { items: reportRows, total: reportTotal, page: query.page, restricted: user.role === 'USER' }, relationship: 'Current live associations; task links do not establish original discovery.' };
  }

  async task(user: AuthUser, id: string, query: TracePageDto) {
    const tenantId = this.tenant(user, query.tenantId);
    const task = await this.tasks.get(user, id, query.tenantId);
    const sir = await this.prisma.sir.findFirst({ where: { id: task.sirId, tenantId }, select: { id: true, reference: true, title: true, pir: { select: { id: true, reference: true, title: true } } } });
    if (!sir) throw new NotFoundException('SIR not found');
    const indicators = await this.indicators(user, tenantId);
    const ids = task.evidence.map(link => link.evidenceId);
    const where: Prisma.IntelligenceReportWhereInput = { ...this.reportWhere(tenantId, indicators), analysisEvidence: { some: { tenantId, evidenceId: { in: ids } } } };
    const [items, total] = user.role === 'USER' || ids.length === 0 ? [[], 0] : await Promise.all([
      this.prisma.intelligenceReport.findMany({ where, select: { id: true, reference: true, title: true, status: true, tlp: true, analysisEvidence: { where: { evidenceId: { in: ids } }, select: { evidenceId: true }, take: 20 } }, orderBy: { updatedAt: 'desc' }, ...this.page(query) }),
      this.prisma.intelligenceReport.count({ where }),
    ]);
    return { task, sir, citingReports: { items, total, page: query.page, restricted: user.role === 'USER' }, relationship: 'Evidence is currently associated with this task; original discovery is not established.' };
  }

  async evidenceReports(user: AuthUser, id: string, query: TracePageDto) {
    const tenantId = this.tenant(user, query.tenantId);
    const indicators = await this.indicators(user, tenantId);
    const evidence = await this.prisma.sirEvidence.findFirst({ where: { id, tenantId, ...(!indicators ? { indicatorId: null } : {}) }, select: { id: true } });
    if (!evidence) throw new NotFoundException('SIR evidence not found');
    if (user.role === 'USER') return { items: [], total: 0, page: query.page, restricted: true };
    const where: Prisma.IntelligenceReportWhereInput = { ...this.reportWhere(tenantId, indicators), analysisEvidence: { some: { tenantId, evidenceId: id } } };
    const [items, total] = await Promise.all([
      this.prisma.intelligenceReport.findMany({ where, select: { id: true, reference: true, title: true, status: true, tlp: true }, orderBy: { updatedAt: 'desc' }, ...this.page(query) }),
      this.prisma.intelligenceReport.count({ where }),
    ]);
    return { items, total, page: query.page, restricted: false };
  }

  async report(user: AuthUser, id: string, query: TracePageDto) {
    const tenantId = this.tenant(user, query.tenantId);
    const indicators = await this.indicators(user, tenantId);
    const report = await this.prisma.intelligenceReport.findFirst({
      where: { id, ...this.reportWhere(tenantId, indicators) },
      select: { id: true, reference: true, title: true, status: true, tlp: true, finalizedAt: true,
        pir: { select: { id: true, reference: true, title: true } },
        analysisSirs: { select: { sir: { select: { id: true, reference: true, title: true } } }, take: 20, orderBy: { sirId: 'asc' } },
      },
    });
    if (!report || !report.pir) throw new NotFoundException('Analysis report not found');
    const associationsWhere: Prisma.CollectionTaskEvidenceWhereInput = { tenantId, task: { tenantId }, evidence: { analysisReportEvidence: { some: { reportId: id, tenantId } } } };
    const [citations, citationTotal, associations, associationTotal, distributions, distributionTotal] = await Promise.all([
      this.prisma.intelligenceReportEvidence.findMany({ where: { reportId: id, tenantId }, select: { evidenceId: true, evidence: { select: { id: true, sirId: true, relevanceNote: true, indicator: { select: { value: true } }, threatActor: { select: { entity: { select: { name: true } } } }, campaign: { select: { name: true } } } } }, orderBy: { evidenceId: 'asc' }, ...this.page(query) }),
      this.prisma.intelligenceReportEvidence.count({ where: { reportId: id, tenantId } }),
      this.prisma.collectionTaskEvidence.findMany({ where: associationsWhere, select: { evidenceId: true, task: { select: { id: true, reference: true, title: true, sirId: true, status: true } } }, orderBy: { createdAt: 'desc' }, ...this.page(query) }),
      this.prisma.collectionTaskEvidence.count({ where: associationsWhere }),
      this.prisma.reportDissemination.findMany({ where: { tenantId, reportId: id }, select: { id: true, status: true, disseminatedAt: true, viewedAt: true, recipient: { select: { name: true } }, feedback: { select: { id: true, relevance: true, answeredRequirement: true, actionability: true, submittedAt: true } } }, orderBy: { disseminatedAt: 'desc' }, ...this.page(query) }),
      this.prisma.reportDissemination.count({ where: { tenantId, reportId: id } }),
    ]);
    return {
      report: { id: report.id, reference: report.reference, title: report.title, status: report.status, tlp: report.tlp, pir: report.pir, sirs: report.analysisSirs.map(link => link.sir), finalizedAt: report.finalizedAt, frozen: report.status === 'FINAL' && report.finalizedAt !== null },
      citations: { items: citations.map(link => ({ id: link.evidence.id, sirId: link.evidence.sirId, source: link.evidence.indicator ? { type: 'INDICATOR', name: link.evidence.indicator.value } : link.evidence.threatActor ? { type: 'THREAT_ACTOR', name: link.evidence.threatActor.entity.name } : link.evidence.campaign ? { type: 'CAMPAIGN', name: link.evidence.campaign.name } : null })), total: citationTotal, page: query.page },
      associations: { items: associations, total: associationTotal, page: query.page },
      dissemination: { items: distributions, total: distributionTotal, page: query.page },
      relationship: 'Report citations are analyst-selected; task associations show current live links only.',
    };
  }
}
