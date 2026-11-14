import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { TelemetryInput } from './correlation.dto';
import { normalizeObservable } from './correlation-rules';

const fingerprint = (input: TelemetryInput): string => createHash('sha256').update(JSON.stringify({
  observedAt: input.observedAt, observableType: input.observableType,
  observableValue: normalizeObservable(input.observableType, input.observableValue),
  ioaKind: input.ioaKind, sourceName: input.sourceName, confidence: input.confidence, tlp: input.tlp,
})).digest('hex');

@Injectable()
export class CorrelationConnectorService {
  constructor(private readonly prisma: PrismaService) {}

  private enabled(): void {
    const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/disabled').pathname.slice(1);
    if (process.env.THREAT_CORRELATION_PILOT_ENABLED !== 'true' || process.env.SICTI_ISOLATED_QA !== 'true'
      || !/^cti_corr_qa_[a-z0-9_]+$/.test(database)) throw new NotFoundException('Correlation connector unavailable');
  }

  private async tenantId(user: AuthUser, requested?: string): Promise<string> {
    const id = user.role === 'SUPER_ADMIN' ? requested : user.tenantId;
    if (!id || (user.role !== 'SUPER_ADMIN' && requested && requested !== user.tenantId)) throw new ForbiddenException('Tenant context denied');
    if (!await this.prisma.tenant.findFirst({ where: { id, isActive: true }, select: { id: true } })) throw new NotFoundException('Tenant unavailable');
    return id;
  }

  async enqueue(user: AuthUser, input: TelemetryInput) {
    this.enabled();
    const tenantId = await this.tenantId(user, input.tenantId);
    return this.enqueueForTenant(tenantId, 'CONNECTOR_QA', user.sub, input);
  }

  async enqueueMachine(tenantId: string, credentialId: string, input: TelemetryInput) {
    this.enabled();
    if (input.tenantId && input.tenantId !== tenantId) throw new ForbiddenException('Tenant context denied');
    return this.enqueueForTenant(tenantId, 'MACHINE_QA', credentialId, input);
  }

  private async enqueueForTenant(tenantId: string, sourceKind: string, submittedBy: string, input: TelemetryInput) {
    const hash = fingerprint(input);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
      const prior = await tx.threatEvent.findUnique({ where: { tenantId_sourceKind_sourceKey: { tenantId, sourceKind, sourceKey: input.sourceKey } }, include: { correlations: { select: { id: true } } } });
      if (prior) {
        const provenance = prior.provenance as { fingerprint?: string };
        if (provenance.fingerprint !== hash) throw new ConflictException('Source key reused with different telemetry');
        return { status: 'DUPLICATE', eventId: prior.id, correlationIds: prior.correlations.map(row => row.id) };
      }
      const queued = await tx.threatEvent.count({ where: { tenantId, processingStatus: { in: ['PENDING', 'PROCESSING'] } } });
      if (queued >= 500) throw new HttpException('Tenant correlation queue is full', HttpStatus.TOO_MANY_REQUESTS);
      const event = await tx.threatEvent.create({ data: {
        tenantId, sourceKind, sourceKey: input.sourceKey, sourceName: input.sourceName,
        observableType: input.observableType, observableValue: normalizeObservable(input.observableType, input.observableValue),
        ioaKind: input.ioaKind, confidence: input.confidence, tlp: input.tlp,
        observedAt: new Date(input.observedAt), provenance: { channel: sourceKind, fingerprint: hash, submittedBy },
      } });
      return { status: 'QUEUED', eventId: event.id, receivedAt: event.ingestedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async status(user: AuthUser, eventId: string, requested?: string) {
    this.enabled();
    const tenantId = await this.tenantId(user, requested);
    const event = await this.prisma.threatEvent.findFirst({ where: { id: eventId, tenantId, sourceKind: { in: ['CONNECTOR_QA', 'MACHINE_QA'] },
      ...(user.role === 'USER' ? { tlp: { not: 'RED' as const } } : {}) },
      select: { id: true, processingStatus: true, attempts: true, failureCode: true, observedAt: true, ingestedAt: true, processedAt: true,
        correlations: { select: { id: true, alertId: true, alertVisibleAt: true, score: true } } } });
    if (!event) throw new NotFoundException('Telemetry event unavailable');
    return { ...event, upstreamAcquisitionDelayMs: event.ingestedAt.getTime() - event.observedAt.getTime(),
      processingLatencyMs: event.processedAt ? event.processedAt.getTime() - event.ingestedAt.getTime() : null };
  }

  async health(user: AuthUser, requested?: string) {
    this.enabled();
    const tenantId = await this.tenantId(user, requested);
    const counts = await this.prisma.threatEvent.groupBy({ by: ['processingStatus'], where: { tenantId, sourceKind: { in: ['CONNECTOR_QA', 'MACHINE_QA'] } }, _count: { _all: true } });
    const oldest = await this.prisma.threatEvent.findFirst({ where: { tenantId, sourceKind: { in: ['CONNECTOR_QA', 'MACHINE_QA'] }, processingStatus: { in: ['PENDING', 'PROCESSING'] } }, orderBy: { ingestedAt: 'asc' }, select: { ingestedAt: true } });
    return { counts: Object.fromEntries(counts.map(row => [row.processingStatus, row._count._all])), oldestPendingAt: oldest?.ingestedAt ?? null };
  }
}
