import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseReviewDecisionKind, CaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { CaseIntegrityCore } from './case-integrity.core';
import type { CloseCaseV2Input, DecideCaseReviewInput, ReopenCaseV2Input, RequestCaseReviewInput } from './case-integrity.types';

@Injectable()
export class CasesReviewV2Service {
  constructor(private readonly prisma: PrismaService, private readonly core: CaseIntegrityCore) {}

  async get(user: AuthUser, caseId: string, selected?: string) {
    const tenantId = this.core.scope(user, selected);
    const record = await this.core.record(caseId, tenantId);
    const [reviews, closures, reopens, grants] = await Promise.all([
      this.prisma.caseReviewRequest.findMany({ where: { caseId, tenantId }, include: { reviewer: { select: { id: true, name: true } }, decision: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.caseClosure.findMany({ where: { caseId, tenantId }, orderBy: { closedAt: 'desc' } }),
      this.prisma.caseReopen.findMany({ where: { caseId, tenantId }, orderBy: { reopenedAt: 'desc' } }),
      this.prisma.userModuleAccess.findMany({ where: { tenantId, module: { slug: 'case-management' }, featureKeys: { has: 'case-v2-reviewer' }, user: { isActive: true, role: { in: ['ADMIN', 'SUPER_ADMIN'] } } }, include: { user: { select: { id: true, name: true, role: true, tenantId: true } } } }),
    ]);
    const investigators = await this.core.investigatorIds(caseId, tenantId, record.investigationCycle);
    const snapshot = await this.prisma.$transaction(tx => this.core.investigationSnapshot(tx, caseId, tenantId));
    const latest = reviews.find(item => item.cycle === record.investigationCycle);
    const approved = latest?.decision?.kind === CaseReviewDecisionKind.APPROVED;
    return { status: record.status, revision: record.revision, cycle: record.investigationCycle, canManage: user.role !== 'USER',
      currentUserId: user.sub, reviewerGrant: await this.core.reviewerGrant(user.sub, tenantId),
      reviewerCandidates: grants.map(item => item.user).filter(person => (person.tenantId === tenantId || person.role === 'SUPER_ADMIN') && !investigators.has(person.id)),
      checklist: { resolved: record.status === CaseStatus.RESOLVED, evidence: snapshot.evidence.some(item => item.latestRevision > 0),
        tasksComplete: snapshot.tasks.every(task => task.state !== 'TODO' && task.state !== 'IN_PROGRESS'),
        approved, unchanged: approved && latest?.decision?.investigationSnapshotHash === snapshot.hash && latest.decision.investigationActivityCount === snapshot.activityCount },
      reviews: reviews.map(item => ({ ...item, status: item.decision?.kind ?? 'REQUESTED' })), closures, reopens };
  }

  async request(user: AuthUser, caseId: string, selected: string | undefined, input: RequestCaseReviewInput) {
    const tenantId = this.core.scope(user, selected);
    const record = await this.core.record(caseId, tenantId);
    if (record.status !== CaseStatus.RESOLVED) throw new ConflictException('Case harus RESOLVED sebelum review');
    const reviewer = await this.prisma.user.findFirst({ where: { id: input.reviewerId, isActive: true, role: { in: ['ADMIN', 'SUPER_ADMIN'] } } });
    if (!reviewer || (reviewer.tenantId !== tenantId && reviewer.role !== 'SUPER_ADMIN')) throw new NotFoundException('Reviewer tidak ditemukan di tenant ini');
    if (!(await this.core.reviewerGrant(reviewer.id, tenantId))) throw new ForbiddenException('Reviewer belum memiliki entitlement');
    if ((await this.core.investigatorIds(caseId, tenantId, record.investigationCycle, user.sub)).has(reviewer.id)) throw new ForbiddenException('Reviewer harus independen dari investigasi');
    const latest = await this.prisma.caseReviewRequest.findFirst({ where: { caseId, tenantId, cycle: record.investigationCycle }, include: { decision: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (latest && !latest.decision) throw new ConflictException('Review sebelumnya belum diputuskan');
    return this.prisma.$transaction(async tx => {
      await this.core.bump(tx, caseId, tenantId, input.expectedRevision);
      const review = await tx.caseReviewRequest.create({ data: { tenantId, caseId, cycle: record.investigationCycle, requestedBy: user.sub, reviewerId: reviewer.id, reason: input.reason?.trim() || null } });
      await this.core.event(tx, user, tenantId, caseId, 'CASE_REVIEW_REQUESTED', { reviewId: review.id, cycle: review.cycle, reviewerId: reviewer.id });
      return review;
    });
  }

  async decide(user: AuthUser, caseId: string, reviewId: string, selected: string | undefined, input: DecideCaseReviewInput) {
    const tenantId = this.core.scope(user, selected);
    const record = await this.core.record(caseId, tenantId);
    const review = await this.prisma.caseReviewRequest.findFirst({ where: { id: reviewId, caseId, tenantId }, include: { decision: true } });
    if (!review) throw new NotFoundException('Review tidak ditemukan');
    if (review.cycle !== record.investigationCycle || record.status !== CaseStatus.RESOLVED) throw new ConflictException('Siklus review tidak aktif');
    if (review.decision) throw new ConflictException('Review sudah diputuskan');
    if (review.reviewerId !== user.sub || user.role === 'USER' || !(await this.core.reviewerGrant(user.sub, tenantId))) throw new ForbiddenException('Keputusan hanya untuk reviewer yang ditugaskan');
    if ((await this.core.investigatorIds(caseId, tenantId, record.investigationCycle, review.requestedBy)).has(user.sub)) throw new ForbiddenException('Reviewer harus independen dari investigasi');
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Alasan keputusan wajib');
    return this.prisma.$transaction(async tx => {
      await this.core.bump(tx, caseId, tenantId, input.expectedRevision);
      const snapshot = await this.core.investigationSnapshot(tx, caseId, tenantId);
      if (input.kind === CaseReviewDecisionKind.APPROVED && (!snapshot.evidence.some(item => item.latestRevision > 0) || snapshot.tasks.some(task => task.state === 'TODO' || task.state === 'IN_PROGRESS'))) {
        throw new ConflictException('Evidence wajib dan task aktif harus selesai sebelum persetujuan');
      }
      const decision = await tx.caseReviewDecision.create({ data: { tenantId, caseId, reviewId, kind: input.kind, reason, actorId: user.sub,
        caseRevision: input.expectedRevision + 1, investigationSnapshotHash: snapshot.hash, investigationActivityCount: snapshot.activityCount } });
      await this.core.event(tx, user, tenantId, caseId, 'CASE_REVIEW_DECIDED', { reviewId, decisionId: decision.id, kind: decision.kind, reason, fromReviewState: 'REQUESTED', toReviewState: decision.kind });
      return decision;
    });
  }

  async close(user: AuthUser, caseId: string, selected: string | undefined, input: CloseCaseV2Input) {
    const tenantId = this.core.scope(user, selected);
    const record = await this.core.record(caseId, tenantId);
    if (record.status !== CaseStatus.RESOLVED) throw new ConflictException('Case harus RESOLVED sebelum closure');
    const reason = input.reason.trim();
    const summary = input.investigationSummary.trim();
    if (!reason || !summary) throw new BadRequestException('Alasan dan ringkasan investigasi wajib');
    const latest = await this.prisma.caseReviewRequest.findFirst({ where: { caseId, tenantId, cycle: record.investigationCycle }, include: { decision: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const decision = latest?.decision;
    if (!decision || decision.kind !== CaseReviewDecisionKind.APPROVED) throw new ConflictException('Review independen yang disetujui wajib');
    return this.prisma.$transaction(async tx => {
      await this.core.bump(tx, caseId, tenantId, input.expectedRevision);
      const snapshot = await this.core.investigationSnapshot(tx, caseId, tenantId);
      if (!snapshot.evidence.some(item => item.latestRevision > 0) || snapshot.tasks.some(task => task.state === 'TODO' || task.state === 'IN_PROGRESS')) throw new ConflictException('Checklist evidence dan task belum lengkap');
      if (snapshot.hash !== decision.investigationSnapshotHash || snapshot.activityCount !== decision.investigationActivityCount) throw new ConflictException('Investigasi berubah setelah persetujuan; minta review baru');
      const closure = await tx.caseClosure.create({ data: { tenantId, caseId, cycle: record.investigationCycle, reviewDecisionId: decision.id,
        reviewerId: latest.reviewerId, actorId: user.sub, reason, investigationSummary: summary, evidenceSnapshot: snapshot.evidence } });
      await tx.case.update({ where: { id: caseId, tenantId }, data: { status: CaseStatus.CLOSED } });
      await this.core.event(tx, user, tenantId, caseId, 'CASE_CLOSED_V2', { closureId: closure.id, reviewDecisionId: decision.id, cycle: closure.cycle, reason, fromStatus: CaseStatus.RESOLVED, toStatus: CaseStatus.CLOSED });
      return closure;
    });
  }

  async reopen(user: AuthUser, caseId: string, selected: string | undefined, input: ReopenCaseV2Input) {
    const tenantId = this.core.scope(user, selected);
    const record = await this.core.record(caseId, tenantId);
    if (record.status !== CaseStatus.CLOSED) throw new ConflictException('Hanya Case CLOSED dapat dibuka kembali');
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Alasan reopen wajib');
    const closure = await this.prisma.caseClosure.findUnique({ where: { caseId_cycle: { caseId, cycle: record.investigationCycle } } });
    if (!closure || closure.tenantId !== tenantId) throw new ConflictException('Closure V2 tidak ditemukan');
    return this.prisma.$transaction(async tx => {
      await this.core.bump(tx, caseId, tenantId, input.expectedRevision);
      const reopened = await tx.caseReopen.create({ data: { tenantId, caseId, fromCycle: record.investigationCycle, toCycle: record.investigationCycle + 1,
        closureId: closure.id, actorId: user.sub, reason } });
      await tx.case.update({ where: { id: caseId, tenantId }, data: { status: CaseStatus.IN_PROGRESS, investigationCycle: { increment: 1 } } });
      await this.core.event(tx, user, tenantId, caseId, 'CASE_REOPENED_V2', { reopenId: reopened.id, closureId: closure.id, fromCycle: reopened.fromCycle, toCycle: reopened.toCycle, reason, fromStatus: CaseStatus.CLOSED, toStatus: CaseStatus.IN_PROGRESS });
      return reopened;
    });
  }
}
