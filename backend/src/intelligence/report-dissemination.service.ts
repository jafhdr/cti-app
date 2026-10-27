import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { SendReportDto, SubmitReportFeedbackDto } from './report-dissemination.dto';

@Injectable()
export class ReportDisseminationService {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService) {}
  private tenant(user: AuthUser, requested?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!requested) throw new BadRequestException('Tenant wajib dipilih');
      return requested;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  private async report(user: AuthUser, id: string, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const report = await this.prisma.intelligenceReport.findFirst({ where: { id, tenantId, pirId: { not: null } }, select: {
      id: true, tenantId: true, pirId: true, reference: true, status: true, tlp: true, finalSnapshot: true, stakeholderId: true,
      stakeholder: { select: { id: true, name: true, isActive: true, responsibleUser: { select: { id: true, name: true, email: true, tenantId: true, role: true, isActive: true } } } },
      analysisEvidence: { select: { evidence: { select: { indicatorId: true } } } },
    } });
    if (!report) throw new NotFoundException('Analysis report not found');
    return report;
  }
  private async eligible(report: Awaited<ReturnType<ReportDisseminationService['report']>>) {
    const person = report.stakeholder?.responsibleUser;
    if (!report.stakeholder?.isActive || !person || !person.isActive || person.tenantId !== report.tenantId || !report.stakeholderId) return null;
    const actor: AuthUser = { sub: person.id, tenantId: person.tenantId, role: person.role };
    if (!(await this.access.evaluateForTenant(actor, report.tenantId, 'threat-intelligence', ['intelligence-hub'])).accessible) return null;
    if (report.analysisEvidence.some(link => link.evidence.indicatorId) && !(await this.access.evaluateForTenant(actor, report.tenantId, 'threat-intelligence', ['indicator-management'])).accessible) return null;
    return { id: person.id, name: person.name, email: person.email };
  }
  private distributable(report: Awaited<ReturnType<ReportDisseminationService['report']>>) {
    if (report.status !== 'FINAL' || report.finalSnapshot === null) throw new BadRequestException('Only a finalized report snapshot can be disseminated');
    if (report.tlp === 'RED') throw new BadRequestException('TLP:RED distribution is unavailable in V1');
    if (!report.stakeholderId) throw new BadRequestException('Report has no intended stakeholder');
  }
  async recipients(user: AuthUser, id: string, requested?: string) {
    const report = await this.report(user, id, requested);
    if (report.status !== 'FINAL' || report.finalSnapshot === null) return { recipients: [], reason: 'Finalize this report first.' };
    if (report.tlp === 'RED') return { recipients: [], reason: 'TLP:RED distribution is unavailable in V1.' };
    const person = await this.eligible(report);
    if (!person) return { recipients: [], reason: 'No active stakeholder responsible user with required Threat Intelligence access.' };
    const prior = await this.prisma.reportDissemination.findUnique({ where: { reportId_recipientId: { reportId: id, recipientId: person.id } }, select: { id: true } });
    return prior ? { recipients: [], reason: 'This report was already disseminated to the responsible user.' } : { recipients: [person], reason: null };
  }
  async send(user: AuthUser, id: string, input: SendReportDto, requested?: string) {
    const report = await this.report(user, id, requested);
    this.distributable(report);
    const stakeholderId = report.stakeholderId;
    if (!stakeholderId) throw new BadRequestException('Report has no intended stakeholder');
    const person = await this.eligible(report);
    if (!person) throw new BadRequestException('No authorized internal recipient is available');
    if (person.id !== input.recipientId) throw new BadRequestException('Recipient must be the stakeholder responsible user');
    try {
      return await this.prisma.$transaction(async tx => {
        const current = await tx.intelligenceReport.findFirst({ where: { id, tenantId: report.tenantId, status: 'FINAL', finalSnapshot: { not: Prisma.JsonNull }, stakeholderId: report.stakeholderId }, select: { id: true } });
        const stakeholder = await tx.stakeholder.findFirst({ where: { id: stakeholderId, tenantId: report.tenantId, isActive: true, responsibleUserId: person.id }, select: { id: true } });
        const recipient = await tx.user.findFirst({ where: { id: person.id, tenantId: report.tenantId, isActive: true }, select: { id: true } });
        if (!current || !stakeholder || !recipient) throw new ConflictException('Report or recipient changed; reload before dissemination');
        const item = await tx.reportDissemination.create({ data: { tenantId: report.tenantId, reportId: id, stakeholderId, recipientId: person.id, senderId: user.sub, message: input.message?.trim() || null } });
        await tx.auditLog.create({ data: { tenantId: report.tenantId, userId: user.sub, action: 'ANALYSIS_REPORT_DISSEMINATED', metadata: { reportId: id, disseminationId: item.id, stakeholderId: item.stakeholderId, recipientId: person.id } } });
        return item;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Report was already disseminated to this recipient');
      throw error;
    }
  }
  async history(user: AuthUser, id: string, requested?: string) {
    const report = await this.report(user, id, requested);
    return this.prisma.reportDissemination.findMany({ where: { tenantId: report.tenantId, reportId: id }, include: { recipient: { select: { id: true, name: true, email: true } }, sender: { select: { id: true, name: true } }, feedback: true }, orderBy: { disseminatedAt: 'desc' } });
  }
  private ownTenant(user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException('A tenant account is required to receive reports');
    return user.tenantId;
  }
  async received(user: AuthUser) {
    const tenantId = this.ownTenant(user);
    const canReadIndicators = (await this.access.evaluateForTenant(user, tenantId, 'threat-intelligence', ['indicator-management'])).accessible;
    return this.prisma.reportDissemination.findMany({ where: { tenantId, recipientId: user.sub, report: { status: 'FINAL', ...(!canReadIndicators ? { analysisEvidence: { none: { evidence: { indicatorId: { not: null } } } } } : {}) } }, select: { id: true, status: true, message: true, disseminatedAt: true, viewedAt: true, feedback: { select: { id: true, submittedAt: true, ...(process.env.FEEDBACK_FOLLOW_UP_ENABLED === 'true' ? { followUp: { select: { status: true, updatedAt: true } } } : {}) } }, report: { select: { id: true, reference: true, title: true, tlp: true, pir: { select: { reference: true, title: true } }, stakeholder: { select: { name: true } } } }, sender: { select: { name: true } } }, orderBy: { disseminatedAt: 'desc' } });
  }
  private async owned(user: AuthUser, id: string) {
    const tenantId = this.ownTenant(user);
    const item = await this.prisma.reportDissemination.findFirst({ where: { id, tenantId, recipientId: user.sub, report: { status: 'FINAL' } }, include: { report: { select: { id: true, tlp: true, finalSnapshot: true, analysisEvidence: { select: { evidence: { select: { indicatorId: true } } } } } }, feedback: process.env.FEEDBACK_FOLLOW_UP_ENABLED === 'true' ? { include: { followUp: { select: { status: true, updatedAt: true } } } } : true } });
    if (!item) throw new NotFoundException('Received report not found');
    if (item.report.tlp === 'RED' || item.report.finalSnapshot === null) throw new ForbiddenException('Report is unavailable');
    if (item.report.analysisEvidence.some(link => link.evidence.indicatorId) && !(await this.access.evaluateForTenant(user, tenantId, 'threat-intelligence', ['indicator-management'])).accessible) throw new ForbiddenException('Indicator Management access required');
    return item;
  }
  async view(user: AuthUser, id: string) {
    const item = await this.owned(user, id);
    if (!item.viewedAt) await this.prisma.$transaction(async tx => {
      const changed = await tx.reportDissemination.updateMany({ where: { id, tenantId: item.tenantId, recipientId: user.sub, viewedAt: null }, data: { viewedAt: new Date(), status: 'VIEWED' } });
      if (changed.count) await tx.auditLog.create({ data: { tenantId: item.tenantId, userId: user.sub, action: 'ANALYSIS_REPORT_VIEWED', metadata: { reportId: item.reportId, disseminationId: id } } });
    });
    return { id: item.id, reportId: item.reportId, message: item.message, snapshot: item.report.finalSnapshot, feedback: item.feedback, status: 'VIEWED' };
  }
  async feedback(user: AuthUser, id: string, input: SubmitReportFeedbackDto) {
    const item = await this.owned(user, id);
    if (!item.viewedAt) throw new BadRequestException('View the received report before submitting feedback');
    try {
      return await this.prisma.$transaction(async tx => {
        const row = await tx.reportFeedback.create({ data: { disseminationId: id, tenantId: item.tenantId, recipientId: user.sub, reportId: item.reportId, relevance: input.relevance, answeredRequirement: input.answeredRequirement, actionability: input.actionability, comments: input.comments?.trim() || null, furtherIntelligenceRequest: input.furtherIntelligenceRequest?.trim() || null } });
        await tx.auditLog.create({ data: { tenantId: item.tenantId, userId: user.sub, action: 'ANALYSIS_REPORT_FEEDBACK_SUBMITTED', metadata: { reportId: item.reportId, disseminationId: id, feedbackId: row.id } } });
        return row;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Feedback has already been submitted');
      throw error;
    }
  }
}
