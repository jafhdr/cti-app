import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseOriginKind, CasePriority, CaseStatus, Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { operationalIndicatorWhere } from '../indicators/indicator-eligibility';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateCaseV2Input } from './case-v2.types';
import { writeCaseV2Audit } from './case-v2-audit';

type Source = {
  readonly sourceId: string | null;
  readonly occurredAt: Date | null;
  snapshot: Prisma.InputJsonObject;
  readonly existingCaseId: string | null;
  readonly alertId: string | null;
};

@Injectable()
export class CasesV2Service {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService) {}

  private enabled(): void {
    if (process.env.CASE_V2_ORIGIN_ENABLED !== 'true') throw new ForbiddenException('Case V2 origin belum aktif');
  }

  private tenant(user: AuthUser, selected?: string): string {
    if (user.role === 'SUPER_ADMIN') {
      if (!selected?.trim()) throw new BadRequestException('Tenant wajib dipilih');
      return selected;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    if (selected && selected !== user.tenantId) throw new NotFoundException('Tenant tidak ditemukan');
    return user.tenantId;
  }

  private async sourceAccess(user: AuthUser, tenantId: string, kind: CaseOriginKind): Promise<void> {
    const target = kind === 'INDICATOR' ? ['threat-intelligence', 'indicator-management']
      : kind === 'APPSEC_FINDING' ? ['appsec-posture', 'finding-management']
      : kind === 'MANUAL' ? null : ['attack-surface-management', 'asset-management'];
    if (!target) return;
    const result = await this.access.evaluateForTenant(user, tenantId, target[0], [target[1]]);
    if (!result.accessible) throw new ForbiddenException(result.reason);
  }

  private async source(tx: Prisma.TransactionClient | PrismaService, tenantId: string, input: CreateCaseV2Input): Promise<Source> {
    const sourceId = input.sourceId?.trim();
    if (input.kind === 'MANUAL') {
      if (sourceId) throw new BadRequestException('Manual Case tidak memiliki sourceId');
      return { sourceId: null, occurredAt: null, snapshot: { version: 1 }, existingCaseId: null, alertId: null };
    }
    if (!sourceId) throw new BadRequestException('sourceId wajib');
    switch (input.kind) {
      case 'INDICATOR': {
        const item = await tx.indicator.findFirst({ where: { id: sourceId, ...operationalIndicatorWhere(tenantId, new Date()) }, select: { id: true, severity: true, createdAt: true } });
        if (!item) throw new NotFoundException('Indicator tidak ditemukan');
        return { sourceId, occurredAt: item.createdAt, snapshot: { version: 1, severity: item.severity }, existingCaseId: null, alertId: null };
      }
      case 'ASM_ALERT': {
        const item = await tx.alert.findFirst({ where: { id: sourceId, tenantId, source: 'ASM' }, select: { id: true, caseId: true, assetId: true, severity: true, firstSeenAt: true } });
        if (!item) throw new NotFoundException('Alert tidak ditemukan');
        return { sourceId, occurredAt: item.firstSeenAt, snapshot: { version: 1, severity: item.severity, assetId: item.assetId }, existingCaseId: item.caseId, alertId: item.id };
      }
      case 'ASM_FINDING': {
        const item = await tx.assetFinding.findFirst({ where: { id: sourceId, tenantId }, select: { id: true, assetId: true, severity: true, firstSeenAt: true } });
        if (!item) throw new NotFoundException('Finding tidak ditemukan');
        const alert = await tx.alert.findUnique({ where: { tenantId_source_sourceKey: { tenantId, source: 'ASM', sourceKey: `finding:${sourceId}` } }, select: { id: true, caseId: true } });
        return { sourceId, occurredAt: item.firstSeenAt, snapshot: { version: 1, severity: item.severity, assetId: item.assetId, alertId: alert?.id ?? null }, existingCaseId: alert?.caseId ?? null, alertId: alert?.id ?? null };
      }
      case 'APPSEC_FINDING': {
        const item = await tx.appSecFinding.findFirst({ where: { id: sourceId, tenantId }, select: { id: true, severity: true, firstSeenAt: true, caseLink: { select: { caseId: true } } } });
        if (!item) throw new NotFoundException('Finding tidak ditemukan');
        return { sourceId, occurredAt: item.firstSeenAt, snapshot: { version: 1, severity: item.severity }, existingCaseId: item.caseLink?.caseId ?? null, alertId: null };
      }
      default: throw new BadRequestException('Origin tidak valid');
    }
  }

  async create(user: AuthUser, key: string, input: CreateCaseV2Input) {
    this.enabled();
    const tenantId = this.tenant(user, input.tenantId);
    await this.sourceAccess(user, tenantId, input.kind);
    const canonical = JSON.stringify({ tenantId, kind: input.kind, sourceId: input.sourceId?.trim() ?? null, title: input.title.trim(), description: input.description?.trim() ?? null, priority: input.priority ?? null, severity: input.severity ?? null, assigneeId: input.assigneeId ?? null });
    const hash = createHash('sha256').update(canonical).digest('hex');
    const replay = async () => {
      const request = await this.prisma.caseCreateRequest.findUnique({ where: { tenantId_actorId_idempotencyKey: { tenantId, actorId: user.sub, idempotencyKey: key } } });
      if (!request) return null;
      if (request.requestHash !== hash) throw new ConflictException('Idempotency-Key digunakan untuk request berbeda');
      const caseRecord = await this.prisma.case.findFirst({ where: { id: request.caseId, tenantId } });
      if (!caseRecord) throw new NotFoundException('Case tidak ditemukan');
      const origin = await this.prisma.caseOrigin.findUnique({ where: { caseId: caseRecord.id } });
      return { case: caseRecord, origin: origin ?? { kind: 'LEGACY_UNKNOWN' }, replayed: true };
    };
    const existing = await replay();
    if (existing) return existing;
    if (!input.title.trim()) throw new BadRequestException('Judul Case wajib');
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
        const previous = await tx.caseCreateRequest.findUnique({ where: { tenantId_actorId_idempotencyKey: { tenantId, actorId: user.sub, idempotencyKey: key } } });
        if (previous) throw new ConflictException('Request telah diproses; ulangi');
        if (input.assigneeId) {
          const assignee = await tx.user.findFirst({ where: { id: input.assigneeId, tenantId, isActive: true } });
          if (!assignee) throw new NotFoundException('Assignee tidak ditemukan');
        }
        const source = await this.source(tx, tenantId, input);
        if (source.existingCaseId) {
          const caseRecord = await tx.case.findFirst({ where: { id: source.existingCaseId, tenantId } });
          if (!caseRecord) throw new NotFoundException('Case tidak ditemukan');
          await tx.caseCreateRequest.create({ data: { tenantId, actorId: user.sub, idempotencyKey: key, requestHash: hash, caseId: caseRecord.id } });
          const origin = await tx.caseOrigin.findUnique({ where: { caseId: caseRecord.id } });
          return { case: caseRecord, origin: origin ?? { kind: 'LEGACY_UNKNOWN' }, reused: true };
        }
        const prefix = `CASE-${new Date().getFullYear()}-`;
        const rows = await tx.$queryRaw<Array<{ number: number }>>`SELECT COALESCE(MAX(SUBSTRING("caseNumber" FROM LENGTH(${prefix}) + 1)::integer), 0)::integer AS number FROM "Case" WHERE "tenantId" = ${tenantId} AND "caseNumber" LIKE ${`${prefix}%`} AND SUBSTRING("caseNumber" FROM LENGTH(${prefix}) + 1) ~ '^[0-9]+$'`;
        const caseNumber = `${prefix}${String((rows[0]?.number ?? 0) + 1).padStart(5, '0')}`;
        const caseRecord = await tx.case.create({ data: { tenantId, caseNumber, title: input.title.trim(), description: input.description?.trim(), status: CaseStatus.OPEN, priority: input.priority ?? CasePriority.MEDIUM, severity: input.severity, assigneeId: input.assigneeId, createdBy: user.sub } });
        if (input.kind === 'INDICATOR' && source.sourceId) await tx.caseIndicator.create({ data: { tenantId, caseId: caseRecord.id, indicatorId: source.sourceId, createdBy: user.sub } });
        if (input.kind === 'APPSEC_FINDING' && source.sourceId) await tx.appSecFindingCase.create({ data: { tenantId, caseId: caseRecord.id, findingId: source.sourceId } });
        if (input.kind === 'ASM_ALERT' && source.alertId) await tx.alert.update({ where: { id: source.alertId, tenantId, caseId: null }, data: { caseId: caseRecord.id } });
        let derivedAlertId: string | null = null;
        if (input.kind === 'ASM_FINDING' && source.sourceId) {
          const finding = await tx.assetFinding.findFirstOrThrow({ where: { id: source.sourceId, tenantId } });
          const alert = source.alertId ? await tx.alert.update({ where: { id: source.alertId, tenantId, caseId: null }, data: { caseId: caseRecord.id } })
            : await tx.alert.create({ data: { tenantId, source: 'ASM', sourceKey: `finding:${finding.id}`, assetId: finding.assetId, findingId: finding.id, title: finding.title, description: finding.description, severity: finding.severity, firstSeenAt: finding.firstSeenAt, lastSeenAt: finding.lastSeenAt, caseId: caseRecord.id } });
          derivedAlertId = alert.id;
        }
        const origin = await tx.caseOrigin.create({ data: { tenantId, caseId: caseRecord.id, kind: input.kind, sourceId: source.sourceId, sourceOccurredAt: source.occurredAt, actorId: user.sub, snapshot: derivedAlertId ? { ...source.snapshot, alertId: derivedAlertId } : source.snapshot } });
        await writeCaseV2Audit(tx, { tenantId, caseId: caseRecord.id, actorId: user.sub, action: 'CASE_V2_ORIGIN_CREATED',
          metadata: { kind: input.kind, sourceId: source.sourceId, fromStatus: null, toStatus: CaseStatus.OPEN } });
        await tx.caseCreateRequest.create({ data: { tenantId, actorId: user.sub, idempotencyKey: key, requestHash: hash, caseId: caseRecord.id } });
        return { case: caseRecord, origin, replayed: false };
      });
    } catch (error) {
      if (error instanceof ConflictException && error.message === 'Request telah diproses; ulangi') {
        const committed = await replay();
        if (committed) return committed;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2025', 'P2034'].includes(error.code)) {
        const committed = await replay();
        if (committed) return committed;
        throw new ConflictException('Case sedang dibuat; coba lagi');
      }
      throw error;
    }
  }

  async origin(user: AuthUser, caseId: string, selectedTenantId?: string) {
    this.enabled();
    const tenantId = this.tenant(user, selectedTenantId);
    const caseRecord = await this.prisma.case.findFirst({ where: { id: caseId, tenantId }, select: { id: true } });
    if (!caseRecord) throw new NotFoundException('Case tidak ditemukan');
    const origin = await this.prisma.caseOrigin.findUnique({ where: { caseId } });
    if (!origin) return { kind: 'LEGACY_UNKNOWN' };
    try {
      await this.sourceAccess(user, tenantId, origin.kind);
    } catch (error) {
      if (error instanceof ForbiddenException) return { kind: origin.kind, sourceId: origin.sourceId, sourceOccurredAt: origin.sourceOccurredAt, capturedAt: origin.capturedAt, actorId: origin.actorId, snapshot: origin.snapshot, currentSourceAvailable: null, navigationPath: null };
      throw error;
    }
    const source = origin.sourceId ? await this.source(this.prisma, tenantId, { kind: origin.kind, sourceId: origin.sourceId, title: '' }).catch(error => {
      if (error instanceof NotFoundException) return null;
      throw error;
    }) : null;
    const path = source && origin.sourceId ? ({ INDICATOR: `/indicators/${origin.sourceId}`, ASM_ALERT: `/attack-surface-management/alerts/${origin.sourceId}`, ASM_FINDING: `/attack-surface-management/findings/${origin.sourceId}`, APPSEC_FINDING: `/appsec/findings/${origin.sourceId}`, MANUAL: null })[origin.kind] : null;
    return { kind: origin.kind, sourceId: origin.sourceId, sourceOccurredAt: origin.sourceOccurredAt, capturedAt: origin.capturedAt, actorId: origin.actorId, snapshot: origin.snapshot, currentSourceAvailable: Boolean(source), navigationPath: path };
  }
}
