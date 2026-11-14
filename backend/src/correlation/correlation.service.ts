import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { effectiveIndicatorEligibility } from '../indicators/indicator-eligibility';
import type { TelemetryInput } from './correlation.dto';
import { correlationWindowMs, evaluateCorrelation, normalizeObservable } from './correlation-rules';

@Injectable()
export class CorrelationService {
  constructor(private readonly prisma: PrismaService) {}

  private enabled(): void {
    const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/disabled').pathname.slice(1);
    if (process.env.THREAT_CORRELATION_PILOT_ENABLED !== 'true' || process.env.SICTI_ISOLATED_QA !== 'true'
      || !/^cti_corr_qa_[a-z0-9_]+$/.test(database)) throw new NotFoundException('Correlation pilot unavailable');
  }

  private async tenantId(user: AuthUser, requested?: string): Promise<string> {
    const tenantId = user.role === 'SUPER_ADMIN' ? requested : user.tenantId;
    if (!tenantId || (user.role !== 'SUPER_ADMIN' && requested && requested !== user.tenantId)) throw new ForbiddenException('Tenant context denied');
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Tenant unavailable');
    return tenantId;
  }

  async list(user: AuthUser, requested?: string) {
    this.enabled();
    const tenantId = await this.tenantId(user, requested);
    return this.prisma.threatCorrelation.findMany({ where: { tenantId, ...(user.role === 'USER' ? { event: { tlp: { not: 'RED' as const } } } : {}) }, orderBy: { correlatedAt: 'desc' }, take: 50,
      include: { event: true, indicator: { select: { id: true, value: true, type: true, severity: true } }, alert: { select: { id: true, title: true, status: true, severity: true } } } });
  }

  async ingest(user: AuthUser, input: TelemetryInput) {
    this.enabled();
    const tenantId = await this.tenantId(user, input.tenantId);
    const observedAt = new Date(input.observedAt);
    const value = normalizeObservable(input.observableType, input.observableValue);
    const prior = await this.prisma.threatEvent.findUnique({ where: { tenantId_sourceKind_sourceKey: { tenantId, sourceKind: 'SYNTHETIC_INTERNAL', sourceKey: input.sourceKey } }, include: { correlations: true } });
    if (prior) return { status: 'DUPLICATE' as const, eventId: prior.id, correlationId: prior.correlations[0]?.id ?? null };

    const observations = await this.prisma.indicatorSourceObservation.findMany({ where: {
      tenantId, origin: 'FEED', provider: 'URLhaus',
      lastSeenAt: { gte: new Date(observedAt.getTime() - correlationWindowMs), lte: new Date(observedAt.getTime() + correlationWindowMs) },
      indicator: { tenantId, type: input.observableType, status: 'ACTIVE', suppressionKind: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    }, include: { indicator: { select: { id: true, value: true, type: true, confidence: true, severity: true, status: true, expiresAt: true, suppressionKind: true } } },
    orderBy: { lastSeenAt: 'desc' }, take: 200 });
    const match = observations.map(observation => ({ observation, result: evaluateCorrelation(
      { type: input.observableType, value, observedAt, confidence: input.confidence, ioaKind: input.ioaKind },
      { type: observation.indicator.type, value: observation.indicator.value, observedAt: observation.lastSeenAt, confidence: observation.indicator.confidence }) }))
      .find(candidate => candidate.result.matched && effectiveIndicatorEligibility(candidate.observation.indicator, new Date()).eligible);

    try {
      return await this.prisma.$transaction(async tx => {
        const event = await tx.threatEvent.create({ data: { tenantId, sourceKind: 'SYNTHETIC_INTERNAL', sourceKey: input.sourceKey,
          sourceName: input.sourceName, observableType: input.observableType, observableValue: value, ioaKind: input.ioaKind,
          provenance: { channel: 'SYNTHETIC_QA', sourceName: input.sourceName }, confidence: input.confidence, tlp: input.tlp, observedAt } });
        if (!match || !match.result.matched) { await tx.threatEvent.update({ where: { id: event.id }, data: { processingStatus: 'NO_MATCH', processedAt: new Date() } }); return { status: 'NO_MATCH' as const, eventId: event.id, correlationId: null }; }
        const indicator = await tx.indicator.findFirst({ where: { id: match.observation.indicator.id, tenantId, status: 'ACTIVE', suppressionKind: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } });
        if (!indicator) { await tx.threatEvent.update({ where: { id: event.id }, data: { processingStatus: 'NO_MATCH', processedAt: new Date() } }); return { status: 'NO_MATCH' as const, eventId: event.id, correlationId: null }; }
        const seen = new Date();
        const alert = await tx.alert.create({ data: { tenantId, source: 'CORRELATION', sourceKey: `EVENT:${event.id}`,
          title: `Threat correlation: ${value}`, description: `${input.ioaKind} matched URLhaus indicator ${match.observation.indicator.value}`,
          severity: match.observation.indicator.severity, firstSeenAt: seen, lastSeenAt: seen } });
        const correlation = await tx.threatCorrelation.create({ data: { tenantId, eventId: event.id, indicatorId: indicator.id,
          feedObservationId: match.observation.id, alertId: alert.id, score: match.result.score, reason: match.result.reason,
          evidence: { provider: 'URLhaus', sourceObservationId: match.observation.id, observableType: input.observableType,
            observableValue: value, ioaKind: input.ioaKind, feedObservedAt: match.observation.lastSeenAt.toISOString() },
          matchedAt: seen, correlatedAt: seen, alertVisibleAt: seen } });
        const notice = await tx.notification.create({ data: { tenantId, type: 'THREAT_CORRELATION_DETECTED', sourceModule: 'THREAT_INTELLIGENCE',
          resourceKind: 'INDICATOR', resourceId: indicator.id, priority: match.observation.indicator.severity,
          preview: `Synthetic telemetry matched a URLhaus indicator: ${value}`, route: '/threat-intelligence/correlations',
          eventAt: seen, dedupeKey: `THREAT_CORRELATION:${event.id}` } });
        if (user.tenantId === tenantId) await tx.notificationRecipient.create({ data: { notificationId: notice.id, tenantId, userId: user.sub } });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'THREAT_CORRELATION_DETECTED', metadata: { correlationId: correlation.id, alertId: alert.id, eventId: event.id } } });
        await tx.threatEvent.update({ where: { id: event.id }, data: { processingStatus: 'MATCHED', processedAt: new Date() } });
        return { status: 'MATCHED' as const, eventId: event.id, correlationId: correlation.id, alertId: alert.id,
          processingLatencyMs: seen.getTime() - event.ingestedAt.getTime() };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.prisma.threatEvent.findUnique({ where: { tenantId_sourceKind_sourceKey: { tenantId, sourceKind: 'SYNTHETIC_INTERNAL', sourceKey: input.sourceKey } }, include: { correlations: true } });
        if (replay) return { status: 'DUPLICATE' as const, eventId: replay.id, correlationId: replay.correlations[0]?.id ?? null };
      }
      throw error;
    }
  }
}
