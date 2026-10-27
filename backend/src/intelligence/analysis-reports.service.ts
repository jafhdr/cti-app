import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { ListAnalysisReportsDto, SaveAnalysisReportDto } from './analysis-reports.dto';

const detail = {
  pir: { select: { id: true, reference: true, title: true, question: true, stakeholderId: true } },
  stakeholder: { select: { id: true, name: true, category: true } },
  author: { select: { id: true, name: true } },
  reviewer: { select: { id: true, name: true } },
  analysisSirs: { include: { sir: { select: { id: true, reference: true, title: true, question: true, analystAnswer: true, evidenceNotes: true } } } },
  analysisEvidence: { include: { evidence: { include: {
    indicator: { select: { id: true, value: true, type: true } },
    threatActor: { select: { id: true, entity: { select: { name: true } } } },
    campaign: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
  } } } },
} satisfies Prisma.IntelligenceReportInclude;
type Report = Prisma.IntelligenceReportGetPayload<{ include: typeof detail }>;

@Injectable()
export class AnalysisReportsService {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService) {}
  private tenant(user: AuthUser, requested?: string) {
    if (user.role === 'SUPER_ADMIN') { if (!requested) throw new BadRequestException('Tenant wajib dipilih'); return requested; }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  private async canReadIndicators(user: AuthUser, tenantId: string) {
    return (await this.access.evaluateForTenant(user, tenantId, 'threat-intelligence', ['indicator-management'])).accessible;
  }
  private evidence(row: Report['analysisEvidence'][number]['evidence']) {
    const source = row.indicator ? { type: 'INDICATOR', id: row.indicator.id, name: row.indicator.value, context: row.indicator.type, href: `/indicators?indicatorId=${encodeURIComponent(row.indicator.id)}` }
      : row.threatActor ? { type: 'THREAT_ACTOR', id: row.threatActor.id, name: row.threatActor.entity.name, href: `/intelligence/threat-actors?actorId=${encodeURIComponent(row.threatActor.id)}` }
      : row.campaign ? { type: 'CAMPAIGN', id: row.campaign.id, name: row.campaign.name, href: `/threat-intelligence/campaigns?campaignId=${encodeURIComponent(row.campaign.id)}` } : null;
    return { id: row.id, sirId: row.sirId, relevanceNote: row.relevanceNote, createdBy: row.createdBy, createdAt: row.createdAt, source };
  }
  private present(row: Report) {
    const { analysisSirs, analysisEvidence, finalSnapshot, ...base } = row;
    return { ...base, sirIds: analysisSirs.map(link => link.sirId), evidenceIds: analysisEvidence.map(link => link.evidenceId), sirs: analysisSirs.map(link => link.sir), evidence: analysisEvidence.map(link => this.evidence(link.evidence)), finalSnapshot };
  }
  private async scoped(user: AuthUser, id: string, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const row = await this.prisma.intelligenceReport.findFirst({ where: { id, tenantId, pirId: { not: null }, ...(user.role === 'USER' ? { status: 'FINAL', disseminations: { some: { recipientId: user.sub } } } : {}) }, include: detail });
    if (!row) throw new NotFoundException('Analysis report not found');
    if (user.role === 'USER') throw new ForbiddenException('Use Received Reports to view shared analysis');
    if (!(await this.canReadIndicators(user, tenantId)) && row.analysisEvidence.some(link => link.evidence.indicatorId)) throw new ForbiddenException('Indicator Management access required');
    return row;
  }
  async get(user: AuthUser, id: string, requested?: string) { return this.present(await this.scoped(user, id, requested)); }
  async list(user: AuthUser, query: ListAnalysisReportsDto) {
    if (user.role === 'USER') throw new ForbiddenException('Use Received Reports to view shared analysis');
    const tenantId = this.tenant(user, query.tenantId);
    const canReadIndicators = await this.canReadIndicators(user, tenantId);
    const search = query.search?.trim();
    const where: Prisma.IntelligenceReportWhereInput = { tenantId, pirId: { not: null }, ...(query.status ? { status: query.status } : {}), ...(query.pirId ? { pirId: query.pirId } : {}), ...(!canReadIndicators ? { analysisEvidence: { none: { evidence: { indicatorId: { not: null } } } } } : {}), ...(search ? { OR: [{ reference: { contains: search, mode: 'insensitive' } }, { title: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.intelligenceReport.findMany({ where, include: detail, orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }), this.prisma.intelligenceReport.count({ where })]);
    return { items: items.map(item => this.present(item)), total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
  }
  async context(user: AuthUser, pirId: string, requested?: string) {
    if (user.role === 'USER') throw new ForbiddenException('Analysis authoring context requires ADMIN access');
    const tenantId = this.tenant(user, requested);
    const pir = await this.prisma.pir.findFirst({ where: { id: pirId, tenantId }, select: { id: true, reference: true, title: true, question: true, status: true, stakeholder: { select: { id: true, name: true, category: true } }, sirs: { select: { id: true, reference: true, title: true, question: true, analystAnswer: true, evidenceNotes: true, evidence: { include: { indicator: { select: { id: true, value: true, type: true } }, threatActor: { select: { id: true, entity: { select: { name: true } } } }, campaign: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } } } }, orderBy: { reference: 'asc' } } } });
    if (!pir) throw new NotFoundException('PIR not found');
    const canReadIndicators = await this.canReadIndicators(user, tenantId);
    return { ...pir, sirs: pir.sirs.map(({ evidence, ...sir }) => ({ ...sir, evidence: evidence.filter(item => canReadIndicators || !item.indicatorId).map(item => this.evidence(item)) })) };
  }
  private async validate(user: AuthUser, tenantId: string, input: SaveAnalysisReportDto) {
    const reference = input.reference.trim().toUpperCase();
    const title = input.title.trim();
    if (!reference || !title) throw new BadRequestException('Reference and title are required');
    const pir = await this.prisma.pir.findFirst({ where: { id: input.pirId, tenantId }, select: { id: true, stakeholderId: true } });
    if (!pir) throw new BadRequestException('PIR must belong to this tenant');
    if (input.stakeholderId && input.stakeholderId !== pir.stakeholderId) throw new BadRequestException('Stakeholder must match the PIR');
    const sirIds = [...new Set(input.sirIds)];
    const evidenceIds = [...new Set(input.evidenceIds)];
    if (sirIds.length !== input.sirIds.length || evidenceIds.length !== input.evidenceIds.length) throw new BadRequestException('Duplicate SIR or evidence selection');
    const sirs = await this.prisma.sir.findMany({ where: { id: { in: sirIds }, tenantId, pirId: pir.id }, select: { id: true } });
    if (sirs.length !== sirIds.length) throw new BadRequestException('Selected SIR must belong to the PIR');
    const evidence = await this.prisma.sirEvidence.findMany({ where: { id: { in: evidenceIds }, tenantId, sirId: { in: sirIds } }, select: { id: true, sirId: true, indicatorId: true } });
    if (evidence.length !== evidenceIds.length) throw new BadRequestException('Evidence must belong to a selected SIR');
    if (evidence.some(item => item.indicatorId) && !(await this.canReadIndicators(user, tenantId))) throw new ForbiddenException('Indicator Management access required');
    if (input.reviewerId && !await this.prisma.user.findFirst({ where: { id: input.reviewerId, tenantId, isActive: true }, select: { id: true } })) throw new BadRequestException('Reviewer must be an active tenant user');
    return { reference, title, stakeholderId: pir.stakeholderId, sirIds, evidence };
  }
  async save(user: AuthUser, input: SaveAnalysisReportDto, id?: string, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const existing = id ? await this.scoped(user, id, requested) : null;
    if (existing && existing.status !== 'DRAFT') throw new ConflictException('Only drafts can be edited');
    const selection = await this.validate(user, tenantId, input);
    const data = { reference: selection.reference, title: selection.title, pirId: input.pirId, stakeholderId: selection.stakeholderId, summary: input.summary?.trim() ?? '', keyFindings: input.keyFindings?.trim() || null, content: input.content?.trim() ?? '', recommendedActions: input.recommendedActions?.trim() || null, informationGaps: input.informationGaps?.trim() || null, confidence: input.confidence ?? null, tlp: input.tlp ?? 'AMBER', reportType: input.reportType ?? 'STRATEGIC', reviewerId: input.reviewerId || null } as const;
    try {
      const reportId = await this.prisma.$transaction(async tx => {
        let reportId: string;
        if (existing) {
          reportId = existing.id;
          await tx.intelligenceReportEvidence.deleteMany({ where: { reportId } });
          await tx.intelligenceReportSir.deleteMany({ where: { reportId } });
          const changed = await tx.intelligenceReport.updateMany({ where: { id, tenantId, status: 'DRAFT' }, data });
          if (changed.count !== 1) throw new ConflictException('Report changed; reload before editing');
        } else {
          const created = await tx.intelligenceReport.create({ data: { ...data, tenantId, authorId: user.sub, status: 'DRAFT' }, select: { id: true } });
          reportId = created.id;
        }
        if (selection.sirIds.length) await tx.intelligenceReportSir.createMany({ data: selection.sirIds.map(sirId => ({ reportId, sirId, tenantId, pirId: input.pirId })) });
        if (selection.evidence.length) await tx.intelligenceReportEvidence.createMany({ data: selection.evidence.map(item => ({ reportId, evidenceId: item.id, sirId: item.sirId, tenantId })) });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: existing ? 'ANALYSIS_REPORT_UPDATED' : 'ANALYSIS_REPORT_CREATED', metadata: { reportId, reference: selection.reference, pirId: input.pirId, sirIds: selection.sirIds, evidenceIds: selection.evidence.map(item => item.id) } } });
        return reportId;
      });
      return this.get(user, reportId, requested);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Report reference or title already exists in this tenant');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new BadRequestException('A selected relationship changed; reload and retry');
      throw error;
    }
  }
  async status(user: AuthUser, id: string, status: 'DRAFT' | 'IN_REVIEW', requested?: string) {
    const existing = await this.scoped(user, id, requested);
    if (!((existing.status === 'DRAFT' && status === 'IN_REVIEW') || (existing.status === 'IN_REVIEW' && status === 'DRAFT'))) throw new BadRequestException('Invalid report status transition');
    await this.prisma.$transaction(async tx => {
      const changed = await tx.intelligenceReport.updateMany({ where: { id, tenantId: existing.tenantId, status: existing.status }, data: { status } });
      if (changed.count !== 1) throw new ConflictException('Report changed; reload and retry');
      await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: 'ANALYSIS_REPORT_STATUS_CHANGED', metadata: { reportId: id, from: existing.status, to: status } } });
    });
    return this.get(user, id, requested);
  }
  async finalize(user: AuthUser, id: string, requested?: string) {
    const existing = await this.scoped(user, id, requested);
    if (existing.status !== 'IN_REVIEW') throw new BadRequestException('Report must be in review before finalization');
    if (!existing.summary.trim() || !existing.content.trim() || !existing.keyFindings?.trim() || !existing.confidence || existing.analysisSirs.length === 0 || existing.analysisEvidence.length === 0) throw new BadRequestException('Summary, findings, assessment, confidence, SIR and evidence are required to finalize');
    const snapshot = this.present(existing);
    await this.prisma.$transaction(async tx => {
      const changed = await tx.intelligenceReport.updateMany({ where: { id, tenantId: existing.tenantId, status: 'IN_REVIEW' }, data: { status: 'FINAL', finalizedAt: new Date(), finalSnapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue } });
      if (changed.count !== 1) throw new ConflictException('Report changed; reload and retry');
      await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: 'ANALYSIS_REPORT_FINALIZED', metadata: { reportId: id, reference: existing.reference, evidenceIds: existing.analysisEvidence.map(link => link.evidenceId) } } });
    });
    return this.get(user, id, requested);
  }
}
