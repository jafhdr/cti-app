import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ModuleAccessService } from '../auth/module-access.service';
import type { AuthUser } from '../users/users.types';
import { AsmV2EvidenceService } from './asm-v2-evidence.service';
import type { CorrelationDecisionDto } from './asm-v2-review.dto';

const reviewRollout = (): boolean => process.env.ASM_V2_REVIEW_ENABLED === 'true';

@Injectable()
export class AsmV2ReviewService {
  constructor(private readonly prisma: PrismaService, private readonly evidence: AsmV2EvidenceService,
    private readonly access: ModuleAccessService) {}

  async available(user: AuthUser, requested?: string) {
    const tenantId = await this.evidence.tenant(user, requested);
    const permission = await this.access.evaluateForTenant(user, tenantId, 'attack-surface-management', ['asset-management', 'asset-correlation-review']);
    return { enabled: reviewRollout(), canReview: reviewRollout() && permission.accessible && await this.evidence.enabledForTenant(tenantId) };
  }

  async decide(user: AuthUser, assetId: string, id: string, input: CorrelationDecisionDto, requested?: string) {
    if (!reviewRollout()) throw new ForbiddenException('ASM V2 review belum diaktifkan');
    const tenantId = await this.evidence.tenant(user, requested);
    const permitted = await this.access.evaluateForTenant(user, tenantId, 'attack-surface-management', ['asset-management', 'asset-correlation-review']);
    if (!permitted.accessible) throw new ForbiddenException(permitted.reason);
    if (!(await this.evidence.enabledForTenant(tenantId))) throw new ForbiddenException('ASM V2 tenant belum diaktifkan');
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Alasan keputusan wajib');
    if (input.kind === 'ACCEPT' && input.inspectedEvidence !== true) throw new BadRequestException('Evidence saat ini wajib diperiksa');
    if (input.overrideReason !== undefined && user.role !== 'ADMIN') throw new ForbiddenException('Override hanya untuk ADMIN');
    return this.prisma.$transaction(async tx => {
      const identity = await tx.assetVulnerabilityCorrelation.findFirst({ where: { id, tenantId, assetId, workflowVersion: 2 }, select: { serviceId: true, vulnerabilityId: true } });
      if (!identity) throw new NotFoundException('Correlation tidak ditemukan');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + identity.serviceId + ':' + identity.vulnerabilityId}, 0)) IS NULL AS locked`;
      const replay = await tx.asmCorrelationDecision.findUnique({ where: { tenantId_correlationId_actorId_requestKey: { tenantId, correlationId: id, actorId: user.sub, requestKey: input.requestKey } } });
      if (replay) {
        if (replay.kind !== input.kind || replay.reason !== reason || replay.expectedRevision !== input.expectedRevision ||
          replay.evidenceHash !== input.evidenceHash || replay.inspectedEvidence !== (input.inspectedEvidence === true) ||
          replay.overrideReason !== (input.overrideReason?.trim() || null)) throw new ConflictException('Request key sudah dipakai untuk payload lain');
        return { decision: replay, replayed: true };
      }
      const current = await tx.assetVulnerabilityCorrelation.findFirst({ where: { id, tenantId, assetId, workflowVersion: 2 } });
      if (!current) throw new NotFoundException('Correlation tidak ditemukan');
      if (current.revision !== input.expectedRevision || current.evidenceHash !== input.evidenceHash) throw new ConflictException('Evidence atau revision telah berubah');
      if (current.status !== 'ACTIVE') throw new ConflictException('Observation tidak aktif');
      const previous = current.reviewStatus ?? 'PENDING';
      const next = input.kind === 'ACCEPT' ? 'ACCEPTED' : input.kind === 'REJECT' ? 'REJECTED' : 'REVIEW_REQUIRED';
      if (previous === next) throw new ConflictException('Status review sudah sama');
      const latest = await tx.asmCorrelationDecision.findFirst({ where: { tenantId, correlationId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      const reversal = latest && ['ACCEPTED', 'REJECTED'].includes(previous) && previous !== next;
      if (reversal && latest.actorId === user.sub && (!input.overrideReason?.trim() || user.role !== 'ADMIN')) {
        throw new ForbiddenException('Pembalikan keputusan memerlukan reviewer lain atau override ADMIN beralasan');
      }
      const updated = await tx.assetVulnerabilityCorrelation.update({ where: { id }, data: {
        reviewStatus: next, revision: { increment: 1 },
        ...(input.kind === 'REQUEST_REVIEW' ? {} : { reviewedEvidenceHash: current.evidenceHash, reviewedAt: new Date() }),
      } });
      const decision = await tx.asmCorrelationDecision.create({ data: {
        tenantId, correlationId: id, actorId: user.sub, kind: input.kind,
        previousReviewStatus: previous, reviewStatus: next, reason, evidenceHash: input.evidenceHash,
        expectedRevision: input.expectedRevision, resultingRevision: updated.revision,
        requestKey: input.requestKey, inspectedEvidence: input.inspectedEvidence === true,
        overrideReason: input.overrideReason?.trim() || null,
      } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'ASM_V2_CORRELATION_DECISION',
        metadata: { assetId, correlationId: id, decisionId: decision.id, kind: input.kind, revision: updated.revision, override: Boolean(decision.overrideReason) } } });
      return { decision, replayed: false };
    });
  }

  async history(user: AuthUser, assetId: string, id: string, page: number, requested?: string) {
    const current = await this.evidence.detail(user, assetId, id, requested);
    if (user.role === 'SUPER_ADMIN') {
      const permission = await this.access.evaluateForTenant(user, current.tenantId, 'attack-surface-management', ['asset-management']);
      if (!permission.accessible) throw new ForbiddenException(permission.reason);
    }
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new BadRequestException('Page tidak valid');
    const limit = 25;
    const where = { tenantId: current.tenantId, correlationId: id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.asmCorrelationDecision.findMany({ where, select: {
        id: true, kind: true, previousReviewStatus: true, reviewStatus: true, reason: true, evidenceHash: true,
        expectedRevision: true, resultingRevision: true, createdAt: true, overrideReason: true,
        actor: { select: { id: true, name: true, role: true } },
      }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.asmCorrelationDecision.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async queue(user: AuthUser, page: number, review: string | undefined, status: string | undefined,
    confidence: string | undefined, assetId: string | undefined, requested?: string) {
    const tenantId = await this.evidence.tenant(user, requested);
    if (user.role === 'SUPER_ADMIN') {
      const permission = await this.access.evaluateForTenant(user, tenantId, 'attack-surface-management', ['asset-management']);
      if (!permission.accessible) throw new ForbiddenException(permission.reason);
    }
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new BadRequestException('Page tidak valid');
    if (review && !['PENDING', 'ACCEPTED', 'REJECTED', 'REVIEW_REQUIRED'].includes(review)) throw new BadRequestException('Review filter tidak valid');
    if (status && !['ACTIVE', 'STALE'].includes(status)) throw new BadRequestException('Status filter tidak valid');
    if (confidence && !['HIGH', 'MEDIUM', 'LOW'].includes(confidence)) throw new BadRequestException('Confidence filter tidak valid');
    const where = { tenantId, workflowVersion: 2, ...(review ? { reviewStatus: review } : {}),
      ...(status ? { status } : {}), ...(confidence ? { confidence } : {}), ...(assetId ? { assetId } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.assetVulnerabilityCorrelation.findMany({ where, select: {
        id: true, assetId: true, confidence: true, status: true, reviewStatus: true, revision: true,
        evidenceHash: true, reviewedEvidenceHash: true, reviewedAt: true, lastSeenAt: true,
        asset: { select: { name: true } }, service: { select: { product: true, version: true, port: true, protocol: true } },
        vulnerability: { select: { cveId: true, severity: true } },
        decisions: { select: { kind: true, createdAt: true, actor: { select: { name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
      }, orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 25, take: 25 }),
      this.prisma.assetVulnerabilityCorrelation.count({ where }),
    ]);
    return { items, total, page, limit: 25 };
  }
}
