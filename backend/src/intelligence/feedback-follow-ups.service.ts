import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { FeedbackFollowUpStatus, Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateFeedbackFollowUpDto, ListFeedbackFollowUpsDto, TransitionFeedbackFollowUpDto, UpdateFeedbackFollowUpDto } from './feedback-follow-ups.dto';

const detail = {
  report: { select: { id: true, reference: true, title: true, tlp: true, analysisSirs: { select: { sirId: true, sir: { select: { reference: true, title: true } } } } } },
  feedback: { select: { id: true, relevance: true, answeredRequirement: true, actionability: true, comments: true, furtherIntelligenceRequest: true, submittedAt: true, recipientId: true } },
  pir: { select: { id: true, reference: true, title: true, status: true } },
  sir: { select: { id: true, reference: true, title: true, status: true } },
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} satisfies Prisma.FeedbackFollowUpInclude;

@Injectable()
export class FeedbackFollowUpsService {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService) {}
  private enabled() { if (process.env.FEEDBACK_FOLLOW_UP_ENABLED !== 'true') throw new ServiceUnavailableException('Feedback follow-ups are not enabled for this database'); }

  private tenant(user: AuthUser, requested?: string) {
    if (user.role === 'SUPER_ADMIN') { if (!requested) throw new BadRequestException('Tenant wajib dipilih'); return requested; }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  private async visible(user: AuthUser, tenantId: string) {
    return (await this.access.evaluateForTenant(user, tenantId, 'threat-intelligence', ['indicator-management'])).accessible;
  }
  private reportWhere(tenantId: string, indicators: boolean): Prisma.IntelligenceReportWhereInput {
    return { tenantId, status: 'FINAL', finalSnapshot: { not: Prisma.JsonNull }, tlp: { not: 'RED' }, pirId: { not: null }, ...(!indicators ? { analysisEvidence: { none: { evidence: { indicatorId: { not: null } } } } } : {}) };
  }
  private async assignee(tenantId: string, id?: string | null) {
    if (!id) return;
    const row = await this.prisma.user.findFirst({ where: { id, tenantId, isActive: true, role: 'ADMIN' }, select: { id: true, role: true, tenantId: true } });
    if (!row) throw new BadRequestException('Responsible analyst must be an active tenant ADMIN');
    const decision = await this.access.evaluateForTenant({ sub: row.id, role: row.role, tenantId: row.tenantId }, tenantId, 'threat-intelligence', ['intelligence-hub']);
    if (!decision.accessible) throw new BadRequestException('Responsible analyst requires effective Intelligence Hub access');
  }
  private async sir(tenantId: string, reportId: string, pirId: string, sirId?: string | null) {
    if (!sirId) return;
    const link = await this.prisma.intelligenceReportSir.findFirst({ where: { reportId, sirId, tenantId, pirId }, select: { sirId: true } });
    if (!link) throw new BadRequestException('SIR must be explicitly selected on this report and belong to its PIR');
  }
  private async source(user: AuthUser, tenantId: string, feedbackId: string) {
    const canReadIndicators = await this.visible(user, tenantId);
    const feedback = await this.prisma.reportFeedback.findFirst({ where: { id: feedbackId, tenantId, report: this.reportWhere(tenantId, canReadIndicators) }, select: { id: true, reportId: true, report: { select: { pirId: true } } } });
    if (!feedback?.report.pirId) throw new NotFoundException('Feedback not found or report restricted');
    return { feedbackId: feedback.id, reportId: feedback.reportId, pirId: feedback.report.pirId };
  }
  private async scoped(user: AuthUser, id: string, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const canReadIndicators = await this.visible(user, tenantId);
    const row = await this.prisma.feedbackFollowUp.findFirst({ where: { id, tenantId, report: this.reportWhere(tenantId, canReadIndicators) }, include: detail });
    if (!row) throw new NotFoundException('Feedback follow-up not found');
    return row;
  }
  async review(user: AuthUser, query: ListFeedbackFollowUpsDto) {
    this.enabled();
    const tenantId = this.tenant(user, query.tenantId);
    const indicators = await this.visible(user, tenantId);
    const where: Prisma.ReportFeedbackWhereInput = { tenantId, followUp: null, report: { ...this.reportWhere(tenantId, indicators), ...(query.reportId ? { id: query.reportId } : {}), ...(query.pirId ? { pirId: query.pirId } : {}) } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.reportFeedback.findMany({ where, select: { id: true, relevance: true, answeredRequirement: true, actionability: true, comments: true, furtherIntelligenceRequest: true, submittedAt: true, report: { select: { id: true, reference: true, title: true, pirId: true, pir: { select: { reference: true, title: true } }, analysisSirs: { select: { sirId: true, sir: { select: { reference: true, title: true } } } } } } }, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.reportFeedback.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
  async list(user: AuthUser, query: ListFeedbackFollowUpsDto) {
    this.enabled();
    const tenantId = this.tenant(user, query.tenantId);
    const indicators = await this.visible(user, tenantId);
    const where: Prisma.FeedbackFollowUpWhereInput = { tenantId, report: this.reportWhere(tenantId, indicators), ...(query.pirId ? { pirId: query.pirId } : {}), ...(query.sirId ? { sirId: query.sirId } : {}), ...(query.reportId ? { reportId: query.reportId } : {}), ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.feedbackFollowUp.findMany({ where, include: detail, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.feedbackFollowUp.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
  async get(user: AuthUser, id: string, requested?: string) {
    this.enabled();
    const item = await this.scoped(user, id, requested);
    const history = await this.prisma.auditLog.findMany({ where: { tenantId: item.tenantId, action: { startsWith: 'FEEDBACK_FOLLOW_UP_' }, metadata: { path: ['followUpId'], equals: id } }, select: { id: true, userId: true, action: true, metadata: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 100 });
    return { ...item, history };
  }
  async create(user: AuthUser, feedbackId: string, input: CreateFeedbackFollowUpDto, requested?: string) {
    this.enabled();
    const tenantId = this.tenant(user, requested);
    const source = await this.source(user, tenantId, feedbackId);
    await this.sir(tenantId, source.reportId, source.pirId, input.sirId);
    await this.assignee(tenantId, input.assigneeId);
    const reference = input.reference.trim().toUpperCase();
    const summary = input.summary.trim();
    if (!reference || !summary) throw new BadRequestException('Reference and summary are required');
    try {
      const row = await this.prisma.$transaction(async tx => {
        const created = await tx.feedbackFollowUp.create({ data: { tenantId, ...source, reference, summary, newRequirementNeeded: input.newRequirementNeeded ?? false, priority: input.priority ?? 'MEDIUM', sirId: input.sirId || null, assigneeId: input.assigneeId || null, dueDate: input.dueDate ? new Date(input.dueDate) : null, createdById: user.sub, updatedById: user.sub } });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'FEEDBACK_FOLLOW_UP_CREATED', metadata: { followUpId: created.id, feedbackId, reportId: source.reportId, pirId: source.pirId, sirId: created.sirId, newRequirementNeeded: created.newRequirementNeeded, assigneeId: created.assigneeId, priority: created.priority, dueDate: created.dueDate?.toISOString() ?? null } } });
        return created;
      });
      return this.get(user, row.id, requested);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Feedback already has a follow-up or reference is in use');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new BadRequestException('A selected relationship changed; reload and retry');
      throw error;
    }
  }
  async update(user: AuthUser, id: string, input: UpdateFeedbackFollowUpDto, requested?: string) {
    this.enabled();
    const current = await this.scoped(user, id, requested);
    if (current.status === 'RESOLVED' || current.status === 'DISMISSED') throw new BadRequestException('Closed follow-ups cannot be edited');
    if (Object.keys(input).length === 0) throw new BadRequestException('No changes submitted');
    if (input.sirId !== undefined) await this.sir(current.tenantId, current.reportId, current.pirId, input.sirId);
    if (input.assigneeId !== undefined) await this.assignee(current.tenantId, input.assigneeId);
    await this.prisma.$transaction(async tx => {
      const changed = await tx.feedbackFollowUp.updateMany({ where: { id, tenantId: current.tenantId, status: current.status, updatedAt: current.updatedAt }, data: { ...(input.priority !== undefined ? { priority: input.priority } : {}), ...(input.newRequirementNeeded !== undefined ? { newRequirementNeeded: input.newRequirementNeeded } : {}), ...(input.sirId !== undefined ? { sirId: input.sirId || null } : {}), ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId || null } : {}), ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}), updatedById: user.sub } });
      if (changed.count !== 1) throw new ConflictException('Follow-up changed; reload and retry');
      await tx.auditLog.create({ data: { tenantId: current.tenantId, userId: user.sub, action: 'FEEDBACK_FOLLOW_UP_UPDATED', metadata: { followUpId: id, from: { priority: current.priority, newRequirementNeeded: current.newRequirementNeeded, sirId: current.sirId, assigneeId: current.assigneeId, dueDate: current.dueDate?.toISOString() ?? null }, requested: { priority: input.priority ?? null, newRequirementNeeded: input.newRequirementNeeded ?? null, sirId: input.sirId ?? null, assigneeId: input.assigneeId ?? null, dueDate: input.dueDate ?? null } } } });
    });
    return this.get(user, id, requested);
  }
  async transition(user: AuthUser, id: string, input: TransitionFeedbackFollowUpDto, requested?: string) {
    this.enabled();
    const current = await this.scoped(user, id, requested);
    const allowed: Record<FeedbackFollowUpStatus, readonly FeedbackFollowUpStatus[]> = { OPEN: ['IN_PROGRESS', 'DISMISSED'], IN_PROGRESS: ['RESOLVED', 'DISMISSED'], RESOLVED: [], DISMISSED: [] };
    if (!allowed[current.status].includes(input.status)) throw new BadRequestException('Invalid follow-up status transition');
    const note = input.note?.trim();
    if ((input.status === 'RESOLVED' || input.status === 'DISMISSED') && !note) throw new BadRequestException('Resolution or dismissal reason is required');
    await this.prisma.$transaction(async tx => {
      const changed = await tx.feedbackFollowUp.updateMany({ where: { id, tenantId: current.tenantId, status: current.status, updatedAt: current.updatedAt }, data: { status: input.status, resolutionNote: note || null, updatedById: user.sub } });
      if (changed.count !== 1) throw new ConflictException('Follow-up changed; reload and retry');
      await tx.auditLog.create({ data: { tenantId: current.tenantId, userId: user.sub, action: 'FEEDBACK_FOLLOW_UP_STATUS_CHANGED', metadata: { followUpId: id, from: current.status, to: input.status, note: note ?? null } } });
    });
    return this.get(user, id, requested);
  }
}
