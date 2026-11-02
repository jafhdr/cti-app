import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AssetPortService, Prisma, Vulnerability } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { correlationEvidence, MATCHER_VERSION } from './correlation-evidence';
import { matchVersion, type Match } from './version-match';
import { latestFingerprint, lockFingerprintService } from './fingerprint-order';

const rollout = (): boolean => process.env.ASM_V2_EVIDENCE_ENABLED === 'true';

@Injectable()
export class AsmV2EvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async tenant(user: AuthUser, requested?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') {
      if (!requested) throw new BadRequestException('Tenant wajib');
      const tenant = await this.prisma.tenant.findUnique({ where: { id: requested }, select: { id: true } });
      if (!tenant) throw new BadRequestException('Tenant tidak ditemukan');
      return tenant.id;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib');
    if (requested && requested !== user.tenantId) throw new ForbiddenException('Tenant context tidak sesuai');
    return user.tenantId;
  }

  private async asset(user: AuthUser, assetId: string, requested?: string) {
    const tenantId = await this.tenant(user, requested);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true, tenantId: true } });
    if (!asset) throw new NotFoundException('Asset tidak ditemukan');
    return asset;
  }

  async enrollment(user: AuthUser, requested?: string) {
    const tenantId = await this.tenant(user, requested);
    const record = await this.prisma.asmV2Enrollment.findUnique({ where: { tenantId } });
    return { rolloutEnabled: rollout(), enrolled: record?.enabled === true, active: rollout() && record?.enabled === true };
  }

  async enabledForTenant(tenantId: string): Promise<boolean> {
    if (!rollout()) return false;
    return (await this.prisma.asmV2Enrollment.findUnique({ where: { tenantId }, select: { enabled: true } }))?.enabled === true;
  }

  async setEnrollment(user: AuthUser, enabled: boolean, requested?: string) {
    if (!rollout()) throw new ForbiddenException('ASM V2 belum diaktifkan');
    const tenantId = await this.tenant(user, requested);
    const record = await this.prisma.$transaction(async tx => {
      const current = await tx.asmV2Enrollment.findUnique({ where: { tenantId } });
      const next = await tx.asmV2Enrollment.upsert({ where: { tenantId }, create: { tenantId, enabled }, update: { enabled } });
      if (current?.enabled !== enabled) await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'ASM_V2_ENROLLMENT_CHANGED', metadata: { enabled } } });
      return next;
    });
    return { enrolled: record.enabled };
  }

  async activate(user: AuthUser, assetId: string, id: string, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    if (!(await this.enabledForTenant(asset.tenantId))) throw new ForbiddenException('ASM V2 tenant belum diaktifkan');
    return this.prisma.$transaction(async tx => {
      const identity = await tx.assetVulnerabilityCorrelation.findFirst({ where: { id, tenantId: asset.tenantId, assetId }, select: { serviceId: true, vulnerabilityId: true } });
      if (!identity) throw new NotFoundException('Correlation tidak ditemukan');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${asset.tenantId + ':' + identity.serviceId + ':' + identity.vulnerabilityId}, 0)) IS NULL AS locked`;
      const current = await tx.assetVulnerabilityCorrelation.findFirst({ where: { id, tenantId: asset.tenantId, assetId }, include: { service: true, vulnerability: true } });
      if (!current) throw new NotFoundException('Correlation tidak ditemukan');
      if (current.workflowVersion === 2) return { id: current.id, workflowVersion: 2, revision: current.revision };
      const match = matchVersion(current.service, current.vulnerability);
      if (!match) throw new BadRequestException('Korelasi tidak memiliki evidence aktif untuk aktivasi');
      const evidence = correlationEvidence(current.service, current.vulnerability, match);
      const updated = await tx.assetVulnerabilityCorrelation.update({ where: { id }, data: {
        workflowVersion: 2, revision: 1, reviewStatus: 'PENDING', status: 'ACTIVE', confidence: match.confidence,
        evidenceHash: evidence.evidenceHash, matchReason: match.reason,
      } });
      await tx.asmCorrelationObservation.create({ data: {
        tenantId: asset.tenantId, assetId, correlationId: id, serviceId: current.serviceId,
        vulnerabilityId: current.vulnerabilityId, kind: 'MATCHED', confidence: match.confidence,
        matchReason: match.reason, matcherVersion: MATCHER_VERSION, evidenceHash: evidence.evidenceHash,
        serviceSnapshot: evidence.serviceSnapshot, tiSnapshot: evidence.tiSnapshot,
        fingerprintSource: current.service.source,
      } });
      await tx.auditLog.create({ data: { tenantId: asset.tenantId, userId: user.sub, action: 'ASM_V2_CORRELATION_ACTIVATED', metadata: { assetId, correlationId: id } } });
      return updated;
    });
  }

  async observe(tenantId: string, assetId: string, service: AssetPortService, vulnerability: Vulnerability, match: Match, runId?: string, transaction?: Prisma.TransactionClient) {
    if (!rollout() || !runId) return;
    const execute = async (tx: Prisma.TransactionClient) => {
      await lockFingerprintService(tx, tenantId, service.id);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + service.id + ':' + vulnerability.id}, 0)) IS NULL AS locked`;
      const [scopedService, scopedVulnerability] = await Promise.all([
        tx.assetPortService.findFirst({ where: { id: service.id, tenantId, assetId, status: 'OPEN' } }),
        tx.vulnerability.findFirst({ where: { id: vulnerability.id, tenantId }, select: { id: true } }),
      ]);
      if (!scopedService || !scopedVulnerability) throw new NotFoundException('Correlation source tidak ditemukan');
      const key = { tenantId_serviceId_vulnerabilityId: { tenantId, serviceId: service.id, vulnerabilityId: vulnerability.id } };
      const prior = await tx.assetVulnerabilityCorrelation.findUnique({ where: key });
      if (prior && prior.workflowVersion !== 2) return;
      const run = await tx.asmDiscoveryRun.findFirst({ where: { id: runId, tenantId, status: 'COMPLETED', failed: 0 },
        select: { assetId: true, startedAt: true, completedAt: true } });
      if (!run?.completedAt) return;
      if (run.assetId !== assetId && !(await tx.assetRelationship.findFirst({ where: { tenantId, rootAssetId: run.assetId,
        targetAssetId: assetId, lastSeenAt: { gte: run.startedAt, lte: run.completedAt } }, select: { id: true } }))) return;
      const fingerprint = await tx.asmServiceFingerprintObservation.findFirst({ where: { tenantId, assetId,
        serviceId: service.id, discoveryRunId: runId, observedAt: { gte: run.startedAt, lte: run.completedAt } } });
      if (!fingerprint || (await latestFingerprint(tx, tenantId, service.id))?.id !== fingerprint.id ||
        fingerprint.product !== scopedService.product || fingerprint.version !== scopedService.version ||
        fingerprint.source !== scopedService.source) return;
      const currentMatch = matchVersion(scopedService, vulnerability);
      if (!currentMatch) return;
      const evidence = correlationEvidence(scopedService, vulnerability, currentMatch);
      const material = !prior || prior.evidenceHash !== evidence.evidenceHash || prior.status !== 'ACTIVE';
      const current = await tx.assetVulnerabilityCorrelation.upsert({ where: key,
        create: { tenantId, assetId, serviceId: service.id, vulnerabilityId: vulnerability.id, workflowVersion: 2,
          revision: 1, reviewStatus: 'PENDING', confidence: currentMatch.confidence, status: 'ACTIVE', matchReason: currentMatch.reason,
          evidenceHash: evidence.evidenceHash, evidence: { ...evidence.serviceSnapshot, vulnerabilityId: vulnerability.id }, firstSeenAt: new Date(), lastSeenAt: new Date() },
        update: { confidence: currentMatch.confidence, status: 'ACTIVE', matchReason: currentMatch.reason, evidenceHash: evidence.evidenceHash,
          evidence: { ...evidence.serviceSnapshot, vulnerabilityId: vulnerability.id }, lastSeenAt: new Date(),
          ...(prior?.evidenceHash !== evidence.evidenceHash && prior?.reviewStatus && prior.reviewStatus !== 'PENDING'
            ? { reviewStatus: 'REVIEW_REQUIRED' } : {}),
          ...(material ? { revision: { increment: 1 } } : {}) },
      });
      if (material) await tx.asmCorrelationObservation.create({ data: {
        tenantId, assetId, serviceId: service.id, vulnerabilityId: vulnerability.id, correlationId: current.id,
        discoveryRunId: runId, kind: 'MATCHED', confidence: currentMatch.confidence, matchReason: currentMatch.reason,
        matcherVersion: MATCHER_VERSION, evidenceHash: evidence.evidenceHash,
        serviceSnapshot: evidence.serviceSnapshot, tiSnapshot: evidence.tiSnapshot, fingerprintSource: scopedService.source,
      } });
    };
    if (transaction) await execute(transaction);
    else await this.prisma.$transaction(execute);
  }

  async markNotObserved(tenantId: string, assetId: string, correlationId: string, runId: string, transaction?: Prisma.TransactionClient): Promise<boolean> {
    if (!rollout()) return false;
    const execute = async (tx: Prisma.TransactionClient): Promise<boolean> => {
      const identity = await tx.assetVulnerabilityCorrelation.findFirst({ where: { id: correlationId, tenantId, assetId }, select: { serviceId: true, vulnerabilityId: true } });
      if (!identity) return false;
      await lockFingerprintService(tx, tenantId, identity.serviceId);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + identity.serviceId + ':' + identity.vulnerabilityId}, 0)) IS NULL AS locked`;
      const current = await tx.assetVulnerabilityCorrelation.findFirst({ where: { id: correlationId, tenantId, assetId, workflowVersion: 2 }, include: { service: true, vulnerability: true } });
      if (!current || current.status !== 'ACTIVE' || current.service.assetId !== assetId || current.service.tenantId !== tenantId ||
        current.vulnerability.tenantId !== tenantId || current.service.status !== 'OPEN') return false;
      const run = await tx.asmDiscoveryRun.findFirst({ where: { id: runId, tenantId, status: 'COMPLETED', failed: 0 },
        select: { assetId: true, startedAt: true, completedAt: true } });
      if (!run?.completedAt) return false;
      if (run.assetId !== assetId && !(await tx.assetRelationship.findFirst({ where: { tenantId, rootAssetId: run.assetId,
        targetAssetId: assetId, lastSeenAt: { gte: run.startedAt, lte: run.completedAt } }, select: { id: true } }))) return false;
      const fingerprint = await tx.asmServiceFingerprintObservation.findFirst({ where: {
        discoveryRunId: runId, tenantId, assetId, serviceId: current.serviceId,
        observedAt: { gte: run.startedAt, lte: run.completedAt },
      } });
      if (!fingerprint || (await latestFingerprint(tx, tenantId, identity.serviceId))?.id !== fingerprint.id ||
        fingerprint.product !== current.service.product || fingerprint.version !== current.service.version ||
        fingerprint.source !== current.service.source || matchVersion(current.service, current.vulnerability)) return false;
      const latest = await tx.asmCorrelationObservation.findFirst({ where: { tenantId, correlationId }, orderBy: [{ observedAt: 'desc' }, { id: 'desc' }] });
      const hash = createHash('sha256').update(JSON.stringify([runId, fingerprint.id, fingerprint.bannerHash,
        fingerprint.product, fingerprint.version, current.vulnerabilityId])).digest('hex');
      await tx.assetVulnerabilityCorrelation.update({ where: { id: correlationId }, data: { status: 'STALE', revision: { increment: 1 } } });
      await tx.asmCorrelationObservation.create({ data: {
        tenantId, assetId, serviceId: current.serviceId, vulnerabilityId: current.vulnerabilityId, correlationId,
        discoveryRunId: runId, kind: 'NOT_OBSERVED', matcherVersion: MATCHER_VERSION, evidenceHash: hash,
        matchReason: 'Fresh fingerprint no longer matches vulnerability after completed discovery', confidence: null,
        serviceSnapshot: { protocol: current.service.protocol, port: current.service.port, product: fingerprint.product,
          version: fingerprint.version, fingerprintSource: fingerprint.source, bannerHash: fingerprint.bannerHash,
          observedAt: fingerprint.observedAt.toISOString(), fingerprintObservationId: fingerprint.id },
        tiSnapshot: latest?.tiSnapshot ?? {}, fingerprintSource: fingerprint.source,
      } });
      await tx.assetFinding.updateMany({ where: { tenantId, assetId, source: 'VULNERABILITY_CORRELATION',
        sourceKey: `${current.serviceId}:${current.vulnerabilityId}`, status: 'OPEN' }, data: { status: 'RESOLVED' } });
      return true;
    };
    return transaction ? execute(transaction) : this.prisma.$transaction(execute);
  }

  async list(user: AuthUser, assetId: string, page: number, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new BadRequestException('Page tidak valid');
    return this.prisma.assetVulnerabilityCorrelation.findMany({ where: { tenantId: asset.tenantId, assetId, workflowVersion: 2 },
      select: { id: true, assetId: true, confidence: true, status: true, workflowVersion: true, revision: true,
        reviewStatus: true, evidenceHash: true, reviewedEvidenceHash: true, reviewedAt: true, matchReason: true, firstSeenAt: true, lastSeenAt: true,
        service: { select: { id: true, protocol: true, port: true, service: true, product: true, version: true, source: true } },
        vulnerability: { select: { id: true, cveId: true, name: true, severity: true, cvssScore: true, source: true } } },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 100, take: 100 });
  }

  async detail(user: AuthUser, assetId: string, id: string, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    const current = await this.prisma.assetVulnerabilityCorrelation.findFirst({ where: { id, tenantId: asset.tenantId, assetId, workflowVersion: 2 },
      select: { id: true, assetId: true, tenantId: true, confidence: true, status: true, workflowVersion: true, revision: true,
        reviewStatus: true, evidenceHash: true, reviewedEvidenceHash: true, reviewedAt: true, matchReason: true, firstSeenAt: true, lastSeenAt: true,
        service: { select: { id: true, protocol: true, port: true, service: true, product: true, version: true, source: true } },
        vulnerability: { select: { id: true, cveId: true, name: true, severity: true, cvssScore: true, source: true } } } });
    if (!current) throw new NotFoundException('Correlation tidak ditemukan');
    return current;
  }

  async observations(user: AuthUser, assetId: string, id: string, page: number, requested?: string) {
    const current = await this.detail(user, assetId, id, requested);
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new BadRequestException('Page tidak valid');
    const limit = 25;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.asmCorrelationObservation.findMany({ where: { tenantId: current.tenantId, correlationId: id }, orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.asmCorrelationObservation.count({ where: { tenantId: current.tenantId, correlationId: id } }),
    ]);
    return { items, page, limit, total };
  }
}
