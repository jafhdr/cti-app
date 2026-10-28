import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppSecFindingPriority, AppSecFindingStatus, AppSecValidationState, AppSecVerificationState, Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { AppSecTenantContext } from './tenant-context';
import type { ActivateFindingDto, AssignFindingDto, FindingActionDto, PageQueryDto, PrioritizeFindingDto, StartRemediationDto, SubmitRemediationEvidenceDto, ValidateFindingDto } from './appsec.dto';

type Action = 'activate' | 'validate' | 'priority' | 'assign' | 'start' | 'evidence';
type Input = ActivateFindingDto | ValidateFindingDto | PrioritizeFindingDto | AssignFindingDto | StartRemediationDto | SubmitRemediationEvidenceDto;
const enabled = (): boolean => process.env.APPSEC_V2_TRIAGE_ENABLED === 'true';
const remediationEnabled = (): boolean => process.env.APPSEC_V2_REMEDIATION_ENABLED === 'true';

@Injectable()
export class FindingActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: AppSecTenantContext,
    private readonly access: ModuleAccessService,
  ) {}

  private async scope(user: AuthUser, requested?: string): Promise<string> {
    const tenantId = await this.context.resolve(user, requested);
    const access = await this.access.evaluateForTenant(user, tenantId, 'appsec-posture', ['finding-management']);
    if (!access.accessible) throw new ForbiddenException(access.reason);
    return tenantId;
  }

  async assignees(user: AuthUser, requested?: string) {
    const tenantId = await this.scope(user, requested);
    return this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async history(user: AuthUser, id: string, query: PageQueryDto) {
    const tenantId = await this.scope(user, query.tenantId);
    const finding = await this.prisma.appSecFinding.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!finding) throw new NotFoundException('Finding tidak ditemukan');
    const where = { findingId: id, tenantId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.appSecFindingActionEvent.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit, take: query.limit,
        select: { id: true, kind: true, actorId: true, cycle: true, reason: true, before: true, after: true, revision: true, createdAt: true },
      }),
      this.prisma.appSecFindingActionEvent.count({ where }),
    ]);
    const actors = await this.prisma.user.findMany({
      where: {
        id: { in: items.map(item => item.actorId) },
        OR: [{ tenantId }, { role: 'SUPER_ADMIN', tenantId: null }],
      },
      select: { id: true, name: true, isActive: true },
    });
    const actorNames = new Map(actors.map(actor => [actor.id,
      actor.name.trim() ? `${actor.name.trim()}${actor.isActive ? '' : ' (inactive)'}` : 'Actor unavailable',
    ]));
    return {
      items: items.map(item => ({ ...item, actorName: actorNames.get(item.actorId) ?? 'Actor unavailable' })),
      total, page: query.page, limit: query.limit,
    };
  }

  async act(user: AuthUser, id: string, action: Action, input: Input, requested?: string) {
    const remediation = action === 'start' || action === 'evidence';
    if (remediation ? !remediationEnabled() : !enabled()) throw new ForbiddenException('Aksi AppSec V2 belum diaktifkan');
    if (!remediation && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Aksi ini memerlukan ADMIN');
    const tenantId = await this.scope(user, requested);
    if (remediation) {
      const grant = await this.access.evaluateForTenant(user, tenantId, 'appsec-posture', ['finding-management', 'finding-remediation-submit']);
      if (!grant.accessible) throw new ForbiddenException(grant.reason);
    }
    const reason = 'rationale' in input ? input.rationale.trim() : 'reason' in input ? input.reason?.trim() : 'note' in input ? input.note.trim() : undefined;
    if (action !== 'assign' && action !== 'start' && !reason) throw new BadRequestException('Alasan wajib diisi');
    const reference = action === 'evidence' ? (input as SubmitRemediationEvidenceDto).reference?.trim() || null : null;
    if (reference) {
      try {
        const url = new URL(reference);
        if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) throw new Error('invalid');
      } catch { throw new BadRequestException('Reference harus berupa URL HTTPS yang sah'); }
    }
    const hash = createHash('sha256').update(JSON.stringify({ action, input: this.payload(input) })).digest('hex');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "AppSecFinding" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const finding = await tx.appSecFinding.findFirst({ where: { id, tenantId } });
      if (!finding) throw new NotFoundException('Finding tidak ditemukan');
      if (remediation) {
        if (finding.assigneeId !== user.sub) throw new ForbiddenException('Hanya assignee saat ini yang dapat melakukan remediasi');
        const actor = await tx.user.findFirst({ where: { id: user.sub, tenantId, isActive: true }, select: { id: true } });
        if (!actor) throw new ForbiddenException('Assignee tidak aktif');
        if (user.role !== 'SUPER_ADMIN') {
          const assignment = await tx.userModuleAccess.findFirst({
            where: { userId: user.sub, tenantId, module: { slug: 'appsec-posture' } },
            select: { featureKeys: true },
          });
          if (!assignment?.featureKeys.includes('finding-remediation-submit') || !assignment.featureKeys.includes('finding-management'))
            throw new ForbiddenException('Grant remediasi tidak tersedia');
        }
      }
      if (input.requestKey) {
        const prior = await tx.appSecFindingActionEvent.findUnique({
          where: { tenantId_findingId_requestKey: { tenantId, findingId: id, requestKey: input.requestKey } },
        });
        if (prior) {
          if (prior.requestHash !== hash) throw new ConflictException('Request key telah digunakan untuk aksi lain');
          const { responseSnapshot, ...event } = prior;
          return { finding: responseSnapshot ? JSON.parse(responseSnapshot) : finding, event };
        }
      }
      if (finding.revision !== input.expectedRevision) throw new ConflictException('Finding berubah; muat ulang');
      const before = { workflowVersion: finding.workflowVersion, status: finding.status, validationState: finding.validationState, verificationState: finding.verificationState, priority: finding.priority, assigneeId: finding.assigneeId };
      let data: Prisma.AppSecFindingUncheckedUpdateManyInput;
      let kind: string;
      switch (action) {
        case 'activate':
          if (finding.workflowVersion !== 1 || !(finding.status === AppSecFindingStatus.OPEN || finding.status === AppSecFindingStatus.IN_PROGRESS))
            throw new BadRequestException('Hanya Finding legacy aktif yang dapat diaktifkan');
          data = { workflowVersion: 2, lifecycleCycle: finding.lifecycleCycle + 1, validationState: AppSecValidationState.PENDING, verificationState: AppSecVerificationState.NONE };
          kind = 'ACTIVATED';
          break;
        case 'validate': {
          if (finding.workflowVersion !== 2 || (finding.status !== AppSecFindingStatus.OPEN && finding.status !== AppSecFindingStatus.IN_PROGRESS) || (finding.validationState !== AppSecValidationState.PENDING && finding.validationState !== AppSecValidationState.REJECTED))
            throw new BadRequestException('Validasi tidak tersedia pada keadaan ini');
          const decision = (input as ValidateFindingDto).decision;
          if (decision !== AppSecValidationState.VALID && decision !== AppSecValidationState.REJECTED)
            throw new BadRequestException('Keputusan validasi tidak sah');
          data = { validationState: decision };
          kind = decision === AppSecValidationState.VALID ? 'VALIDATED' : 'VALIDATION_REJECTED';
          break;
        }
        case 'priority': {
          if (finding.workflowVersion !== 2 || (finding.status !== AppSecFindingStatus.OPEN && finding.status !== AppSecFindingStatus.IN_PROGRESS) || finding.validationState !== AppSecValidationState.VALID)
            throw new BadRequestException('Finding harus tervalidasi');
          const priority = (input as PrioritizeFindingDto).priority;
          if (!Object.values(AppSecFindingPriority).includes(priority)) throw new BadRequestException('Prioritas tidak sah');
          data = { priority, priorityRationale: reason };
          kind = 'PRIORITY_SET';
          break;
        }
        case 'assign': {
          if (finding.workflowVersion !== 2 || !(finding.status === AppSecFindingStatus.OPEN || finding.status === AppSecFindingStatus.IN_PROGRESS) || finding.validationState !== AppSecValidationState.VALID || !finding.priority)
            throw new BadRequestException('Validasi dan prioritas wajib sebelum penugasan');
          if (finding.verificationState === AppSecVerificationState.REQUESTED) throw new ConflictException('Verifikasi sedang menunggu keputusan');
          const assigneeId = (input as AssignFindingDto).assigneeId ?? null;
          if (finding.assigneeId === assigneeId) throw new BadRequestException('Penugasan tidak berubah');
          if (finding.assigneeId && !reason) throw new BadRequestException('Alasan perubahan penugasan wajib');
          if (assigneeId) {
            const assignee = await tx.user.findFirst({ where: { id: assigneeId, tenantId, isActive: true }, select: { id: true } });
            if (!assignee) throw new NotFoundException('Pengguna tidak ditemukan');
          }
          data = { assigneeId };
          kind = finding.assigneeId ? 'REASSIGNED' : 'ASSIGNED';
          break;
        }
        case 'start':
          if (finding.workflowVersion !== 2 || finding.status !== AppSecFindingStatus.OPEN || finding.validationState !== AppSecValidationState.VALID || !finding.priority || !finding.assigneeId)
            throw new BadRequestException('Finding belum siap untuk remediasi');
          data = { status: AppSecFindingStatus.IN_PROGRESS };
          kind = 'REMEDIATION_STARTED';
          break;
        case 'evidence':
          if (finding.workflowVersion !== 2 || finding.status !== AppSecFindingStatus.IN_PROGRESS)
            throw new BadRequestException('Remediasi belum berjalan');
          if (finding.verificationState === AppSecVerificationState.REQUESTED) throw new ConflictException('Verifikasi sedang menunggu keputusan');
          data = {};
          kind = 'EVIDENCE_SUBMITTED';
          break;
      }
      const updatedCount = await tx.appSecFinding.updateMany({
        where: { id, tenantId, revision: finding.revision },
        data: { ...data, revision: { increment: 1 } },
      });
      if (updatedCount.count !== 1) throw new ConflictException('Finding berubah; muat ulang');
      const updated = await tx.appSecFinding.findFirstOrThrow({ where: { id, tenantId } });
      const after = {
        workflowVersion: updated.workflowVersion, status: updated.status, validationState: updated.validationState, verificationState: updated.verificationState,
        priority: updated.priority, assigneeId: updated.assigneeId,
        ...(action === 'evidence' ? { note: reason, reference } : {}),
      };
      const event = await tx.appSecFindingActionEvent.create({ data: {
        tenantId, findingId: id, actorId: user.sub, cycle: updated.lifecycleCycle, kind,
        reason: reason || null, before, after, revision: updated.revision,
        requestKey: input.requestKey ?? null, requestHash: input.requestKey ? hash : null,
        responseSnapshot: JSON.stringify(updated),
      } });
      await tx.auditLog.create({ data: {
        tenantId, userId: user.sub, action: 'APPSEC_FINDING_' + kind,
        metadata: { findingId: id, eventId: event.id, revision: updated.revision },
      } });
      const { responseSnapshot, ...publicEvent } = event;
      return { finding: updated, event: publicEvent };
    });
  }

  private payload(input: FindingActionDto): unknown {
    const { expectedRevision, requestKey, ...payload } = input;
    return payload;
  }
}
