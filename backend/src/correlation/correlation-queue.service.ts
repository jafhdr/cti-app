import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { effectiveIndicatorEligibility } from '../indicators/indicator-eligibility';
import { correlationWindowMs, evaluateCorrelation } from './correlation-rules';

@Injectable()
export class CorrelationQueueService {
  private readonly logger = new Logger(CorrelationQueueService.name);
  private draining = false;
  constructor(private readonly prisma: PrismaService) {}

  private enabled(): boolean {
    const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/disabled').pathname.slice(1);
    return process.env.THREAT_CORRELATION_PILOT_ENABLED === 'true' && process.env.SICTI_ISOLATED_QA === 'true'
      && process.env.THREAT_CORRELATION_WORKER_ENABLED !== 'false'
      && /^cti_corr_qa_[a-z0-9_]+$/.test(database);
  }

  @Interval(250)
  async drainOnce(): Promise<number> {
    if (!this.enabled() || this.draining) return 0;
    this.draining = true;
    try {
      const ids = await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "ThreatEvent"
          WHERE "sourceKind" IN ('CONNECTOR_QA', 'MACHINE_QA') AND "attempts" < 3
            AND (("processingStatus" = 'PENDING' AND "nextAttemptAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
              OR ("processingStatus" = 'PROCESSING' AND "processingStartedAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '30 seconds'))
          ORDER BY "ingestedAt" ASC LIMIT 20 FOR UPDATE SKIP LOCKED`;
        const claimed: { id: string; attempts: number }[] = [];
        for (const row of rows) { const updated = await tx.threatEvent.update({ where: { id: row.id }, data: {
          processingStatus: 'PROCESSING', processingStartedAt: new Date(), attempts: { increment: 1 }, failureCode: null,
        } }); claimed.push({ id: row.id, attempts: updated.attempts }); }
        return claimed;
      });
      for (let offset = 0; offset < ids.length; offset += 4) {
        await Promise.all(ids.slice(offset, offset + 4).map(item => this.processOne(item.id, item.attempts)));
      }
      return ids.length;
    } finally { this.draining = false; }
  }

  private async processOne(id: string, attempts: number): Promise<void> {
    try {
      const event = await this.prisma.threatEvent.findUniqueOrThrow({ where: { id } });
      const observations = await this.prisma.indicatorSourceObservation.findMany({ where: {
        tenantId: event.tenantId, origin: 'FEED', provider: 'URLhaus',
        lastSeenAt: { gte: new Date(event.observedAt.getTime() - correlationWindowMs), lte: new Date(event.observedAt.getTime() + correlationWindowMs) },
        indicator: { tenantId: event.tenantId, type: event.observableType, status: 'ACTIVE', suppressionKind: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      }, include: { indicator: true }, orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }], take: 200 });
      await this.prisma.$transaction(async tx => {
        const [current] = await tx.$queryRaw<{ processingStatus: string; attempts: number }[]>`
          SELECT "processingStatus", "attempts" FROM "ThreatEvent" WHERE "id" = ${id} FOR UPDATE`;
        if (!current || current.processingStatus !== 'PROCESSING' || current.attempts !== attempts) return;
        const recipients = await tx.userModuleAccess.findMany({ where: { tenantId: event.tenantId,
          module: { slug: 'threat-intelligence' }, featureKeys: { has: 'indicator-management' },
          user: { isActive: true, ...(event.tlp === 'RED' ? { role: 'ADMIN' as const } : {}) } },
          select: { userId: true } });
        let matched = 0;
        for (const observation of observations) {
          const rule = evaluateCorrelation(
            { type: event.observableType, value: event.observableValue, observedAt: event.observedAt, confidence: event.confidence, ioaKind: event.ioaKind ?? '' },
            { type: observation.indicator.type, value: observation.indicator.value, observedAt: observation.lastSeenAt, confidence: observation.indicator.confidence });
          if (!rule.matched || !effectiveIndicatorEligibility(observation.indicator, new Date()).eligible) continue;
          const eligible = await tx.indicator.findFirst({ where: { id: observation.indicatorId, tenantId: event.tenantId,
            status: 'ACTIVE', suppressionKind: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } });
          if (!eligible) continue;
          const visibleAt = new Date();
          const alert = await tx.alert.create({ data: { tenantId: event.tenantId, source: 'CORRELATION', sourceKey: `EVENT:${event.id}:${observation.id}`,
            title: `Threat correlation: ${event.observableValue}`, description: `${event.ioaKind} matched URLhaus observation ${observation.id}`,
            severity: observation.indicator.severity, firstSeenAt: visibleAt, lastSeenAt: visibleAt } });
          const correlation = await tx.threatCorrelation.create({ data: { tenantId: event.tenantId, eventId: event.id,
            indicatorId: eligible.id, feedObservationId: observation.id, alertId: alert.id, score: rule.score, reason: rule.reason,
            evidence: { provider: 'URLhaus', sourceObservationId: observation.id, feedObservedAt: observation.lastSeenAt.toISOString(),
              observableType: event.observableType, observableValue: event.observableValue, ioaKind: event.ioaKind,
              telemetryConfidence: event.confidence, indicatorConfidence: observation.indicator.confidence, tlp: event.tlp },
            matchedAt: visibleAt, correlatedAt: visibleAt, alertVisibleAt: visibleAt } });
          const notice = await tx.notification.create({ data: { tenantId: event.tenantId, type: 'THREAT_CORRELATION_DETECTED', sourceModule: 'THREAT_INTELLIGENCE',
            resourceKind: 'INDICATOR', resourceId: eligible.id, priority: observation.indicator.severity,
            preview: `Connector telemetry matched a URLhaus indicator: ${event.observableValue}`,
            route: '/threat-intelligence/correlations', eventAt: visibleAt, dedupeKey: `THREAT_CORRELATION:${event.id}:${observation.id}` } });
          if (recipients.length) await tx.notificationRecipient.createMany({ data: recipients.map(recipient => ({ notificationId: notice.id,
            tenantId: event.tenantId, userId: recipient.userId })) });
          await tx.auditLog.create({ data: { tenantId: event.tenantId, action: 'THREAT_CORRELATION_DETECTED',
            metadata: { correlationId: correlation.id, alertId: alert.id, eventId: event.id, feedObservationId: observation.id,
              connectorCredentialId: event.sourceKind === 'MACHINE_QA' ? (event.provenance as { submittedBy?: string }).submittedBy : null } } });
          matched++;
        }
        await tx.threatEvent.update({ where: { id }, data: { processingStatus: matched ? 'MATCHED' : 'NO_MATCH', processedAt: new Date() } });
      });
    } catch (error) {
      const exhausted = attempts >= 3;
      const updated = await this.prisma.threatEvent.updateMany({ where: { id, attempts, processingStatus: 'PROCESSING' }, data: {
        processingStatus: exhausted ? 'FAILED' : 'PENDING',
        nextAttemptAt: new Date(Date.now() + [1000, 5000, 15000][Math.min(attempts - 1, 2)]),
        failureCode: error instanceof Error ? error.name.slice(0, 80) : 'UnknownError', processedAt: exhausted ? new Date() : null } });
      if (!updated.count) return;
      this.logger.error(`Correlation event ${id} ${exhausted ? 'failed' : 'scheduled for retry'}`);
    }
  }
}
