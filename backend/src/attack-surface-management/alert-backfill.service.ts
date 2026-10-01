import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { type AssetFinding, type IndicatorSeverity, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { SENSITIVE_MANAGEMENT_PORTS } from './alert-rules';

type Candidate = {
  readonly sourceKey: string;
  readonly title: string;
  readonly description: string;
  readonly severity: IndicatorSeverity;
  readonly vulnerabilityCorrelationId?: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
};

@Injectable()
export class AlertBackfillService {
  constructor(private readonly prisma: PrismaService) {}

  private async candidate(tx: Prisma.TransactionClient, finding: AssetFinding): Promise<Candidate | null> {
    if (finding.source === 'VULNERABILITY_CORRELATION') {
      const [serviceId, vulnerabilityId] = finding.sourceKey.split(':');
      if (!serviceId || !vulnerabilityId) return null;
      const correlation = await tx.assetVulnerabilityCorrelation.findFirst({ where: {
        tenantId: finding.tenantId, assetId: finding.assetId, serviceId, vulnerabilityId,
        confidence: 'HIGH', status: 'ACTIVE', vulnerability: { severity: { in: ['HIGH', 'CRITICAL'] } },
      }, include: { vulnerability: { select: { severity: true } } } });
      if (!correlation) return null;
      return { sourceKey: `vulnerability:${serviceId}:${vulnerabilityId}`, title: finding.title, description: finding.description,
        severity: correlation.vulnerability.severity, vulnerabilityCorrelationId: correlation.id,
        firstSeenAt: finding.firstSeenAt, lastSeenAt: finding.lastSeenAt };
    }
    if (finding.source === 'PORT_DISCOVERY') {
      const match = /^TCP:(\d+)$/.exec(finding.sourceKey);
      const port = match ? Number(match[1]) : 0;
      if (SENSITIVE_MANAGEMENT_PORTS.has(port)) {
        const service = await tx.assetPortService.findFirst({ where: { tenantId: finding.tenantId, assetId: finding.assetId, protocol: 'TCP', port, status: 'OPEN' } });
        if (!service) return null;
        return { sourceKey: `port:${finding.assetId}:TCP:${port}`, title: `Management port TCP ${port} opened`,
          description: `TCP ${port} became reachable during active discovery. Review exposure of this service.`, severity: 'HIGH',
          firstSeenAt: finding.firstSeenAt, lastSeenAt: service.lastSeenAt > finding.lastSeenAt ? service.lastSeenAt : finding.lastSeenAt };
      }
    }
    if (finding.severity !== 'HIGH' && finding.severity !== 'CRITICAL') return null;
    return { sourceKey: `finding:${finding.id}`, title: finding.title, description: finding.description,
      severity: finding.severity, firstSeenAt: finding.firstSeenAt, lastSeenAt: finding.lastSeenAt };
  }

  async run(user: AuthUser, requested?: string) {
    const tenantId = user.role === 'SUPER_ADMIN' ? requested : user.tenantId;
    if (!tenantId) throw user.role === 'SUPER_ADMIN' ? new BadRequestException('Tenant wajib') : new ForbiddenException('Tenant context wajib');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new BadRequestException('Tenant tidak ditemukan');
    const result = { tenantId, scanned: 0, created: 0, reused: 0, skipped: 0 };
    let cursor: string | undefined;
    while (true) {
      const batch = await this.prisma.assetFinding.findMany({ where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { id: 'asc' }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!batch.length) break;
      for (const finding of batch) {
        result.scanned++;
        const outcome = await this.prisma.$transaction(async tx => {
          const current = await tx.assetFinding.findFirst({ where: { id: finding.id, tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
          if (!current) return 'skipped';
          const candidate = await this.candidate(tx, current);
          if (!candidate) return 'skipped';
          const where = { tenantId_source_sourceKey: { tenantId, source: 'ASM', sourceKey: candidate.sourceKey } };
          const existing = await tx.alert.findUnique({ where });
          if (existing) {
            await tx.alert.update({ where: { id: existing.id }, data: {
              findingId: existing.findingId ?? current.id,
              vulnerabilityCorrelationId: existing.vulnerabilityCorrelationId ?? candidate.vulnerabilityCorrelationId,
              firstSeenAt: existing.firstSeenAt < candidate.firstSeenAt ? existing.firstSeenAt : candidate.firstSeenAt,
              lastSeenAt: existing.lastSeenAt > candidate.lastSeenAt ? existing.lastSeenAt : candidate.lastSeenAt,
            } });
            return 'reused';
          }
          const alert = await tx.alert.create({ data: { tenantId, assetId: current.assetId, findingId: current.id,
            vulnerabilityCorrelationId: candidate.vulnerabilityCorrelationId, source: 'ASM', sourceKey: candidate.sourceKey,
            title: candidate.title, description: candidate.description, severity: candidate.severity,
            firstSeenAt: candidate.firstSeenAt, lastSeenAt: candidate.lastSeenAt } });
          await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'ASM_ALERT_CREATED',
            metadata: { alertId: alert.id, assetId: current.assetId, findingId: current.id, origin: 'HISTORICAL_BACKFILL' } } });
          return 'created';
        });
        result[outcome]++;
      }
      cursor = batch[batch.length - 1].id;
    }
    await this.prisma.auditLog.create({ data: { tenantId, userId: user.sub, action: 'ASM_ALERT_BACKFILL_COMPLETED', metadata: { ...result } } });
    return result;
  }
}
