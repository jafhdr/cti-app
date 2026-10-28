import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppSecFindingStatus, AppSecValidationState, AppSecVerificationState, Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { AppSecTenantContext } from './tenant-context';
import type { AcceptFindingRiskDto, ApproveFindingFalsePositiveDto, DecideFindingVerificationDto, ReopenFindingDto, RequestFindingVerificationDto } from './appsec.dto';

type Action = 'request-verification' | 'verify' | 'accept-risk' | 'false-positive' | 'reopen';
type Input = RequestFindingVerificationDto | DecideFindingVerificationDto | AcceptFindingRiskDto | ApproveFindingFalsePositiveDto | ReopenFindingDto;

@Injectable()
export class FindingVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: AppSecTenantContext,
    private readonly access: ModuleAccessService,
  ) {}

  async act(user: AuthUser, id: string, action: Action, input: Input, requested?: string) {
    if (process.env.APPSEC_V2_VERIFICATION_ENABLED !== 'true') throw new ForbiddenException('Verifikasi AppSec V2 belum diaktifkan');
    const tenantId = await this.context.resolve(user, requested);
    const requestAction = action === 'request-verification';
    if (!requestAction && action !== 'verify' && user.role === 'USER') throw new ForbiddenException('Keputusan ini memerlukan ADMIN');
    const required = requestAction ? 'finding-remediation-submit' : 'finding-review';
    const grant = await this.access.evaluateForTenant(user, tenantId, 'appsec-posture', ['finding-management', required]);
    if (!grant.accessible) throw new ForbiddenException(grant.reason);
    const text = 'summary' in input ? input.summary.trim() : 'note' in input ? input.note.trim() : input.reason.trim();
    if (!text) throw new BadRequestException('Alasan wajib diisi');
    const reference = action === 'false-positive' ? (input as ApproveFindingFalsePositiveDto).reference?.trim() || null : null;
    if (reference) {
      try {
        const url = new URL(reference);
        if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) throw new Error('invalid');
      } catch { throw new BadRequestException('Reference harus berupa URL HTTPS yang sah'); }
    }
    const { expectedRevision, requestKey, ...payload } = input;
    const hash = createHash('sha256').update(JSON.stringify({ action, payload })).digest('hex');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "AppSecFinding" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const finding = await tx.appSecFinding.findFirst({ where: { id, tenantId } });
      if (!finding) throw new NotFoundException('Finding tidak ditemukan');
      const actor = await tx.user.findUnique({ where: { id: user.sub }, select: { id: true, tenantId: true, isActive: true } });
      if (!actor?.isActive) throw new ForbiddenException('Akun tidak aktif');
      if (requestAction) {
        if (actor.tenantId !== tenantId || finding.assigneeId !== user.sub) throw new ForbiddenException('Hanya assignee saat ini yang dapat meminta verifikasi');
      }
      if (user.role !== 'SUPER_ADMIN') {
        const assignment = await tx.userModuleAccess.findFirst({ where: { userId: user.sub, tenantId, module: { slug: 'appsec-posture' } }, select: { featureKeys: true } });
        if (!assignment?.featureKeys.includes('finding-management') || !assignment.featureKeys.includes(required)) throw new ForbiddenException('Grant tidak tersedia');
      }
      if (requestKey) {
        const prior = await tx.appSecFindingActionEvent.findUnique({ where: { tenantId_findingId_requestKey: { tenantId, findingId: id, requestKey } } });
        if (prior) {
          if (prior.actorId !== user.sub || prior.requestHash !== hash) throw new ConflictException('Request key telah digunakan untuk aksi lain');
          const { responseSnapshot, ...event } = prior;
          return { finding: responseSnapshot ? JSON.parse(responseSnapshot) : finding, event };
        }
      }
      if (finding.revision !== expectedRevision) throw new ConflictException('Finding berubah; muat ulang');
      const events = await tx.appSecFindingActionEvent.findMany({
        where: { tenantId, findingId: id, cycle: finding.lifecycleCycle }, orderBy: [{ revision: 'desc' }, { id: 'desc' }],
        select: { id: true, kind: true, actorId: true, revision: true, after: true },
      });
      const latestEvidence = events.find(event => event.kind === 'EVIDENCE_SUBMITTED');
      const latestRejection = events.find(event => event.kind === 'VERIFICATION_REJECTED');
      const latestRequest = events.find(event => event.kind === 'VERIFICATION_REQUESTED');
      const pending = finding.verificationState === AppSecVerificationState.REQUESTED;
      const before = {
        workflowVersion: finding.workflowVersion, cycle: finding.lifecycleCycle, status: finding.status,
        validationState: finding.validationState, verificationState: finding.verificationState,
        priority: finding.priority, assigneeId: finding.assigneeId, resolution: finding.resolution, resolvedAt: finding.resolvedAt,
      };
      let data: Prisma.AppSecFindingUncheckedUpdateManyInput;
      let kind: string;
      let details: Prisma.JsonObject = {};
      switch (action) {
        case 'request-verification':
          if (finding.workflowVersion !== 2 || finding.status !== AppSecFindingStatus.IN_PROGRESS) throw new BadRequestException('Remediasi belum siap diverifikasi');
          if (pending) throw new ConflictException('Permintaan verifikasi sudah menunggu keputusan');
          if (!latestEvidence || (latestRejection && latestEvidence.revision <= latestRejection.revision)) throw new BadRequestException('Evidence baru pada siklus saat ini diperlukan');
          data = { verificationState: AppSecVerificationState.REQUESTED };
          details = { evidenceEventId: latestEvidence.id };
          kind = 'VERIFICATION_REQUESTED';
          break;
        case 'verify': {
          if (finding.workflowVersion !== 2 || finding.status !== AppSecFindingStatus.IN_PROGRESS || !pending || !latestRequest)
            throw new ConflictException('Permintaan verifikasi tidak lagi aktif');
          const evidenceId = (latestRequest.after as { evidenceEventId?: unknown } | null)?.evidenceEventId;
          const evidence = events.find(event => event.id === evidenceId && event.kind === 'EVIDENCE_SUBMITTED');
          if (!evidence || !latestEvidence || latestEvidence.id !== evidence.id) throw new ConflictException('Evidence permintaan sudah berubah');
          if (user.sub === evidence.actorId || user.sub === latestRequest.actorId) throw new ForbiddenException('Reviewer harus independen dari submitter dan requestor');
          const decision = (input as DecideFindingVerificationDto).decision;
          if (decision !== 'APPROVE' && decision !== 'REJECT') throw new BadRequestException('Keputusan tidak sah');
          data = decision === 'APPROVE'
            ? { status: AppSecFindingStatus.RESOLVED, verificationState: AppSecVerificationState.APPROVED, resolution: text, resolvedAt: new Date() }
            : { verificationState: AppSecVerificationState.REJECTED };
          details = { evidenceEventId: evidence.id, requestEventId: latestRequest.id, requestorId: latestRequest.actorId, evidenceActorId: evidence.actorId, decision };
          kind = decision === 'APPROVE' ? 'VERIFIED_RESOLVED' : 'VERIFICATION_REJECTED';
          break;
        }
        case 'accept-risk': {
          if (finding.workflowVersion !== 2 || (finding.status !== AppSecFindingStatus.OPEN && finding.status !== AppSecFindingStatus.IN_PROGRESS) || finding.validationState !== AppSecValidationState.VALID || !finding.priority)
            throw new BadRequestException('Prioritas dan validasi wajib sebelum menerima risiko');
          if (pending) throw new ConflictException('Verifikasi sedang menunggu keputusan');
          if (latestEvidence?.actorId === user.sub || latestRequest?.actorId === user.sub) throw new ForbiddenException('Pengambil keputusan harus independen');
          const due = new Date((input as AcceptFindingRiskDto).reviewDueAt);
          if (Number.isNaN(due.getTime()) || due <= new Date()) throw new BadRequestException('Tanggal review harus di masa depan');
          data = { status: AppSecFindingStatus.ACCEPTED_RISK, verificationState: AppSecVerificationState.NONE, resolution: text, resolvedAt: new Date() };
          details = { reviewDueAt: due.toISOString() };
          kind = 'RISK_ACCEPTED';
          break;
        }
        case 'false-positive':
          if (finding.workflowVersion !== 2 || (finding.status !== AppSecFindingStatus.OPEN && finding.status !== AppSecFindingStatus.IN_PROGRESS))
            throw new BadRequestException('Finding tidak dapat ditandai false positive');
          if (pending) throw new ConflictException('Verifikasi sedang menunggu keputusan');
          if (latestEvidence?.actorId === user.sub || latestRequest?.actorId === user.sub) throw new ForbiddenException('Pengambil keputusan harus independen');
          data = { status: AppSecFindingStatus.FALSE_POSITIVE, verificationState: AppSecVerificationState.NONE, resolution: text, resolvedAt: new Date() };
          details = { reference };
          kind = 'FALSE_POSITIVE_APPROVED';
          break;
        case 'reopen':
          if (finding.status !== AppSecFindingStatus.RESOLVED && finding.status !== AppSecFindingStatus.ACCEPTED_RISK && finding.status !== AppSecFindingStatus.FALSE_POSITIVE)
            throw new BadRequestException('Hanya Finding terminal yang dapat dibuka kembali');
          data = {
            status: AppSecFindingStatus.OPEN, workflowVersion: 2, lifecycleCycle: finding.lifecycleCycle + 1,
            validationState: AppSecValidationState.PENDING, verificationState: AppSecVerificationState.NONE,
            priority: null, priorityRationale: null, assigneeId: null, resolution: null, resolvedAt: null,
          };
          details = { previousStatus: finding.status, previousResolution: finding.resolution ?? '', legacy: finding.workflowVersion === 1 };
          kind = 'REOPENED';
          break;
      }
      const count = await tx.appSecFinding.updateMany({ where: { id, tenantId, revision: finding.revision }, data: { ...data, revision: { increment: 1 } } });
      if (count.count !== 1) throw new ConflictException('Finding berubah; muat ulang');
      const updated = await tx.appSecFinding.findFirstOrThrow({ where: { id, tenantId } });
      const event = await tx.appSecFindingActionEvent.create({ data: {
        tenantId, findingId: id, cycle: updated.lifecycleCycle, kind, actorId: user.sub, reason: text,
        before, after: { ...details, status: updated.status, verificationState: updated.verificationState }, revision: updated.revision,
        requestKey: requestKey ?? null, requestHash: requestKey ? hash : null, responseSnapshot: JSON.stringify(updated),
      } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: `APPSEC_FINDING_${kind}`, metadata: { findingId: id, eventId: event.id, revision: updated.revision, cycle: updated.lifecycleCycle } } });
      const { responseSnapshot, ...publicEvent } = event;
      return { finding: updated, event: publicEvent };
    });
  }
}
