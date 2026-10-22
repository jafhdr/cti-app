import { randomUUID } from 'node:crypto';
import { logNotificationQueueHealth } from './notification-worker-health';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Prisma, type NotificationOutbox } from '@prisma/client';
import { z } from 'zod';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import { isSignificantRiskIncrease } from './indicator-risk-event';

const payloadSchema = z.object({ caseId: z.string().min(1), recipientId: z.string().min(1), actorId: z.string().min(1) }).strict();
const iocReviewPayloadSchema = z.object({ stagingMessageId: z.string().min(1) }).strict();
const appsecPayloadSchema = z.object({ findingId: z.string().min(1), actorId: z.string().min(1) }).strict();
const enrichmentPayloadSchema = z.object({
  jobId: z.string().min(1), indicatorId: z.string().min(1), recipientId: z.string().min(1).nullable(),
  resultKind: z.enum(['NEW', 'CACHED', 'FAILED']),
}).strict();
const riskPayloadSchema = z.object({
  indicatorId: z.string().min(1), previousSeverity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  nextSeverity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']), actorId: z.string().min(1).nullable(),
  source: z.enum(['MANUAL', 'FEED']),
}).strict();
const syncPayloadSchema = z.discriminatedUnion('workflow', [
  z.object({ workflow: z.literal('FEED'), sourceKey: z.string().regex(/^FEED:[A-Za-z0-9_-]+$/),
    sourceName: z.enum(['URLhaus', 'MalwareBazaar', 'AbuseIPDB']), created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(), runId: z.string().uuid() }).strict(),
  z.object({ workflow: z.literal('MITRE'), sourceKey: z.literal('MITRE:ATTACK'),
    sourceName: z.literal('MITRE ATT&CK'), created: z.number().int().nonnegative(),
    updated: z.literal(0), runId: z.string().uuid() }).strict(),
]);
const syncFailurePayloadSchema = z.discriminatedUnion('workflow', [
  z.object({ workflow: z.literal('FEED'), sourceKey: z.string().regex(/^FEED:[A-Za-z0-9_-]+$/),
    sourceName: z.enum(['URLhaus', 'MalwareBazaar', 'AbuseIPDB']), failureCount: z.literal(3) }).strict(),
  z.object({ workflow: z.literal('MITRE'), sourceKey: z.literal('MITRE:ATTACK'),
    sourceName: z.literal('MITRE ATT&CK'), failureCount: z.literal(3) }).strict(),
]);
const leaseMs = 60_000;
const maxAttempts = 5;
const batchSize = 10;

type Claim = { readonly event: NotificationOutbox; readonly token: string };

@Injectable()
export class NotificationOutboxWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationOutboxWorker.name);
  private running = false;
  private cycles = 0;

  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService, private readonly scheduler: SchedulerRegistry) {}

  onApplicationBootstrap(): void {
    if (process.env.NOTIFICATION_WORKER_ENABLED !== 'true') {
      this.logger.log('notification.worker.disabled');
      return;
    }
    const interval = setInterval(() => void this.runScheduled(), 15_000);
    this.scheduler.addInterval('notification-outbox-worker', interval);
    this.logger.log('notification.worker.enabled');
  }

  private async runScheduled(): Promise<void> {
    if (process.env.NOTIFICATION_WORKER_ENABLED !== 'true') return;
    try {
      await this.runOnce();
      if (++this.cycles % 4 === 0) await this.logQueueHealth();
    }
    catch (error) { this.logger.error('notification.worker.cycle_failed', error instanceof Error ? error.name : 'UnknownError'); }
  }

  async logQueueHealth(): Promise<void> {
    await logNotificationQueueHealth(this.prisma, this.logger);
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let index = 0; index < batchSize; index += 1) {
        const claim = await this.claim();
        if (!claim) break;
        await this.deliver(claim);
      }
    } finally { this.running = false; }
  }

  private async claim(): Promise<Claim | null> {
    const now = new Date();
    return this.prisma.$transaction(async tx => {
      const event = await tx.notificationOutbox.findFirst({ where: { OR: [
        { status: 'PENDING', availableAt: { lte: now } },
        { status: 'PROCESSING', leasedUntil: { lt: now } },
      ] }, orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }] });
      if (!event) return null;
      if (event.attempts >= maxAttempts) {
        await tx.notificationOutbox.updateMany({ where: { id: event.id, attempts: { gte: maxAttempts }, OR: [
          { status: 'PENDING', availableAt: { lte: now } },
          { status: 'PROCESSING', leasedUntil: { lt: now } },
        ] }, data: { status: 'FAILED', claimToken: null, leasedUntil: null, lastError: 'DELIVERY_FAILED' } });
        return null;
      }
      const token = randomUUID();
      const claimed = await tx.notificationOutbox.updateMany({ where: { id: event.id, OR: [
        { status: 'PENDING', availableAt: { lte: now } },
        { status: 'PROCESSING', leasedUntil: { lt: now } },
      ] }, data: { status: 'PROCESSING', claimToken: token, leasedUntil: new Date(now.getTime() + leaseMs), attempts: { increment: 1 } } });
      return claimed.count === 1 ? { event, token } : null;
    });
  }

  private async deliver(claim: Claim): Promise<void> {
    const { event, token } = claim;
    try {
      if (event.type === 'APPSEC_FINDING_CREATED_HIGH_RISK' || event.type === 'APPSEC_FINDING_REOPENED') {
        await this.deliverAppSec(claim);
        return;
      }
      if (event.type === 'INDICATOR_ENRICHMENT_COMPLETED' || event.type === 'INDICATOR_ENRICHMENT_FAILED') {
        await this.deliverEnrichment(claim);
        return;
      }
      if (event.type === 'INDICATOR_RISK_CHANGED') {
        await this.deliverIndicatorRisk(claim);
        return;
      }
      if (event.type === 'TI_SYNC_COMPLETED' || event.type === 'TI_SYNC_FAILED') {
        await this.deliverTiSync(claim);
        return;
      }
      if (event.type === 'IOC_CANDIDATES_PENDING_REVIEW') {
        await this.deliverIocReview(claim);
        return;
      }
      if (event.type !== 'CASE_ASSIGNED' && event.type !== 'CASE_REASSIGNED') throw new Error('UnsupportedEvent');
      if (event.payloadVersion !== 1) throw new Error('UnsupportedPayloadVersion');
      const payload = payloadSchema.parse(event.payload);
      const [caseRecord, recipient] = await Promise.all([
        this.prisma.case.findFirst({ where: { id: payload.caseId, tenantId: event.tenantId }, select: { id: true, tenantId: true, caseNumber: true, priority: true, assigneeId: true } }),
        this.prisma.user.findFirst({ where: { id: payload.recipientId, tenantId: event.tenantId, isActive: true, tenant: { isActive: true } }, select: { id: true, role: true, tenantId: true } }),
      ]);
      if (!caseRecord || caseRecord.assigneeId !== payload.recipientId || !recipient || payload.actorId === recipient.id) {
        await this.finishWithoutDelivery(event.id, token);
        return;
      }
      const allowed = await this.access.evaluate({ sub: recipient.id, tenantId: recipient.tenantId, role: recipient.role }, 'case-management', ['case-workflow']);
      if (!allowed.accessible) { await this.finishWithoutDelivery(event.id, token); return; }
      await this.deliveryTransaction(async tx => {
        const current = await tx.notificationOutbox.findFirst({ where: { id: event.id, tenantId: event.tenantId, status: 'PROCESSING', claimToken: token } });
        if (!current) return;
        const validCase = await tx.case.findFirst({ where: { id: caseRecord.id, tenantId: event.tenantId, assigneeId: recipient.id }, select: { id: true } });
        const validUser = await tx.user.findFirst({ where: { id: recipient.id, tenantId: event.tenantId, isActive: true, tenant: { isActive: true } }, select: { id: true } });
        if (validCase && validUser) {
          const notice = await tx.notification.upsert({ where: { tenantId_dedupeKey: { tenantId: event.tenantId, dedupeKey: `CASE_ASSIGNMENT:${event.id}` } },
            create: { tenantId: event.tenantId, type: event.type, sourceModule: 'CASE', resourceKind: 'CASE', resourceId: caseRecord.id,
              priority: caseRecord.priority, preview: `Case ${caseRecord.caseNumber} assigned`, route: `/cases/${encodeURIComponent(caseRecord.id)}?tenantId=${encodeURIComponent(event.tenantId)}`, eventAt: event.createdAt, dedupeKey: `CASE_ASSIGNMENT:${event.id}` }, update: {} });
          await tx.notificationRecipient.upsert({ where: { notificationId_userId: { notificationId: notice.id, userId: recipient.id } },
            create: { notificationId: notice.id, tenantId: event.tenantId, userId: recipient.id }, update: {} });
        }
        await tx.notificationOutbox.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), leasedUntil: null, claimToken: null, lastError: null } });
      });
    } catch (error) {
      await this.fail(event.id, token, error instanceof z.ZodError ? 'ZodError' : error instanceof Error ? error.message : 'UnknownError');
    }
  }

  private async deliverAppSec({ event, token }: Claim): Promise<void> {
    if (event.payloadVersion !== 1) throw new Error('UnsupportedPayloadVersion');
    const payload = appsecPayloadSchema.parse(event.payload);
    const finding = await this.prisma.appSecFinding.findFirst({
      where: { id: payload.findingId, tenantId: event.tenantId, severity: { in: ['HIGH', 'CRITICAL'] }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: { id: true, severity: true },
    });
    if (!finding) { await this.finishWithoutDelivery(event.id, token); return; }
    const admins = await this.prisma.user.findMany({
      where: { tenantId: event.tenantId, role: 'ADMIN', isActive: true, tenant: { isActive: true }, id: { not: payload.actorId } },
      select: { id: true, tenantId: true, role: true },
    });
    const decisions = await Promise.all(admins.map(async admin => ({
      admin,
      access: await this.access.evaluate({ sub: admin.id, tenantId: admin.tenantId, role: admin.role }, 'appsec-posture', ['finding-management']),
    })));
    const eligibleIds = decisions.filter(decision => decision.access.accessible).map(decision => decision.admin.id);
    await this.deliveryTransaction(async tx => {
      const current = await tx.notificationOutbox.findFirst({ where: { id: event.id, tenantId: event.tenantId, status: 'PROCESSING', claimToken: token } });
      if (!current) return;
      const validFinding = await tx.appSecFinding.findFirst({
        where: { id: finding.id, tenantId: event.tenantId, severity: { in: ['HIGH', 'CRITICAL'] }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        select: { id: true },
      });
      const validAdmins = validFinding && eligibleIds.length > 0 ? await tx.user.findMany({
        where: { id: { in: eligibleIds }, tenantId: event.tenantId, role: 'ADMIN', isActive: true, tenant: { isActive: true } },
        select: { id: true },
      }) : [];
      if (validFinding && validAdmins.length > 0) {
        const dedupeKey = `APPSEC_FINDING:${event.id}`;
        const notice = await tx.notification.upsert({
          where: { tenantId_dedupeKey: { tenantId: event.tenantId, dedupeKey } },
          create: { tenantId: event.tenantId, type: event.type, sourceModule: 'APPSEC', resourceKind: 'APPSEC_FINDING', resourceId: finding.id,
            priority: finding.severity, preview: event.type === 'APPSEC_FINDING_REOPENED' ? 'High risk finding reopened' : 'New high risk finding',
            route: `/appsec/findings/${encodeURIComponent(finding.id)}?tenantId=${encodeURIComponent(event.tenantId)}`,
            eventAt: event.createdAt, dedupeKey }, update: {},
        });
        for (const admin of validAdmins) {
          await tx.notificationRecipient.upsert({ where: { notificationId_userId: { notificationId: notice.id, userId: admin.id } },
            create: { notificationId: notice.id, tenantId: event.tenantId, userId: admin.id }, update: {} });
        }
      }
      await tx.notificationOutbox.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), leasedUntil: null, claimToken: null, lastError: null } });
    });
  }

  private async deliverEnrichment({ event, token }: Claim): Promise<void> {
    if (event.payloadVersion !== 1) throw new Error('UnsupportedPayloadVersion');
    const payload = enrichmentPayloadSchema.parse(event.payload);
    if ((event.type === 'INDICATOR_ENRICHMENT_FAILED') !== (payload.resultKind === 'FAILED')) throw new Error('UnsupportedPayloadVersion');
    const job = await this.prisma.indicatorEnrichmentJob.findFirst({ where: {
      id: payload.jobId, tenantId: event.tenantId, indicatorId: payload.indicatorId,
      status: event.type === 'INDICATOR_ENRICHMENT_COMPLETED' ? 'SUCCESS' : 'FAILED',
      requestedById: payload.recipientId,
    }, select: { id: true } });
    const indicator = await this.prisma.indicator.findFirst({ where: { id: payload.indicatorId, tenantId: event.tenantId }, select: { id: true } });
    if (!job || !indicator || !payload.recipientId) { await this.finishWithoutDelivery(event.id, token, 'NO_ELIGIBLE_RECIPIENT'); return; }
    const recipient = await this.prisma.user.findFirst({ where: {
      id: payload.recipientId, tenantId: event.tenantId, role: { in: ['ADMIN', 'USER'] }, isActive: true, tenant: { isActive: true },
    }, select: { id: true, tenantId: true, role: true } });
    if (!recipient) { await this.finishWithoutDelivery(event.id, token, 'NO_ELIGIBLE_RECIPIENT'); return; }
    const allowed = await this.access.evaluate({ sub: recipient.id, tenantId: recipient.tenantId, role: recipient.role }, 'threat-intelligence', ['indicator-management']);
    if (!allowed.accessible) { await this.finishWithoutDelivery(event.id, token, 'NO_ELIGIBLE_RECIPIENT'); return; }
    await this.deliveryTransaction(async tx => {
      const current = await tx.notificationOutbox.findFirst({ where: { id: event.id, tenantId: event.tenantId, status: 'PROCESSING', claimToken: token } });
      if (!current) return;
      const validJob = await tx.indicatorEnrichmentJob.findFirst({ where: {
        id: job.id, tenantId: event.tenantId, indicatorId: indicator.id, requestedById: recipient.id,
        status: event.type === 'INDICATOR_ENRICHMENT_COMPLETED' ? 'SUCCESS' : 'FAILED',
      }, select: { id: true } });
      const validIndicator = await tx.indicator.findFirst({ where: { id: indicator.id, tenantId: event.tenantId }, select: { id: true } });
      const validRecipient = await tx.user.findFirst({ where: {
        id: recipient.id, tenantId: event.tenantId, role: { in: ['ADMIN', 'USER'] }, isActive: true, tenant: { isActive: true },
      }, select: { id: true } });
      if (validJob && validIndicator && validRecipient) {
        const dedupeKey = `INDICATOR_ENRICHMENT:${event.id}`;
        const notice = await tx.notification.upsert({ where: { tenantId_dedupeKey: { tenantId: event.tenantId, dedupeKey } },
          create: { tenantId: event.tenantId, type: event.type, sourceModule: 'THREAT_INTELLIGENCE', resourceKind: 'INDICATOR', resourceId: indicator.id,
            preview: payload.resultKind === 'FAILED' ? 'Automatic enrichment failed' : payload.resultKind === 'CACHED' ? 'Automatic enrichment already current' : 'Automatic enrichment completed',
            route: '/indicators', eventAt: event.createdAt, dedupeKey }, update: {} });
        await tx.notificationRecipient.upsert({ where: { notificationId_userId: { notificationId: notice.id, userId: recipient.id } },
          create: { notificationId: notice.id, tenantId: event.tenantId, userId: recipient.id }, update: {} });
        await tx.notificationOutbox.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), leasedUntil: null, claimToken: null, lastError: null } });
        return;
      }
      await tx.notificationOutbox.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), leasedUntil: null, claimToken: null, lastError: 'NO_ELIGIBLE_RECIPIENT' } });
    });
  }

  private async deliverIndicatorRisk({ event, token }: Claim): Promise<void> {
    if (event.payloadVersion !== 1) throw new Error('UnsupportedPayloadVersion');
    const payload = riskPayloadSchema.parse(event.payload);
    if (!isSignificantRiskIncrease(payload.previousSeverity, payload.nextSeverity)) throw new Error('UnsupportedPayloadVersion');
    const indicator = await this.prisma.indicator.findFirst({ where: { id: payload.indicatorId, tenantId: event.tenantId }, select: { id: true } });
    if (!indicator) { await this.finishWithoutDelivery(event.id, token, 'NO_ELIGIBLE_RECIPIENT'); return; }
    const admins = await this.prisma.user.findMany({
      where: { tenantId: event.tenantId, role: 'ADMIN', isActive: true, tenant: { isActive: true },
        ...(payload.actorId ? { id: { not: payload.actorId } } : {}) },
      select: { id: true, tenantId: true, role: true },
    });
    const decisions = await Promise.all(admins.map(async admin => ({
      admin, access: await this.access.evaluate({ sub: admin.id, tenantId: admin.tenantId, role: admin.role }, 'threat-intelligence', ['indicator-management']),
    })));
    const eligibleIds = decisions.filter(decision => decision.access.accessible).map(decision => decision.admin.id);
    await this.deliveryTransaction(async tx => {
      const current = await tx.notificationOutbox.findFirst({ where: { id: event.id, tenantId: event.tenantId, status: 'PROCESSING', claimToken: token } });
      if (!current) return;
      const validIndicator = await tx.indicator.findFirst({ where: { id: indicator.id, tenantId: event.tenantId }, select: { id: true } });
      const validAdmins = validIndicator && eligibleIds.length ? await tx.user.findMany({
        where: { id: { in: eligibleIds }, tenantId: event.tenantId, role: 'ADMIN', isActive: true, tenant: { isActive: true } }, select: { id: true },
      }) : [];
      if (validAdmins.length) {
        const dedupeKey = `INDICATOR_RISK:${event.id}`;
        const notice = await tx.notification.upsert({ where: { tenantId_dedupeKey: { tenantId: event.tenantId, dedupeKey } },
          create: { tenantId: event.tenantId, type: event.type, sourceModule: 'THREAT_INTELLIGENCE', resourceKind: 'INDICATOR', resourceId: indicator.id,
            priority: payload.nextSeverity, preview: `Indicator risk increased from ${payload.previousSeverity} to ${payload.nextSeverity}`,
            route: `/indicators?indicatorId=${encodeURIComponent(indicator.id)}`, eventAt: event.createdAt, dedupeKey }, update: {} });
        for (const admin of validAdmins) await tx.notificationRecipient.upsert({ where: { notificationId_userId: { notificationId: notice.id, userId: admin.id } },
          create: { notificationId: notice.id, tenantId: event.tenantId, userId: admin.id }, update: {} });
      }
      await tx.notificationOutbox.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), leasedUntil: null, claimToken: null,
        lastError: validAdmins.length ? null : 'NO_ELIGIBLE_RECIPIENT' } });
    });
  }

  private async deliverTiSync({ event, token }: Claim): Promise<void> {
    if (event.payloadVersion !== 1) throw new Error('UnsupportedPayloadVersion');
    const failed = event.type === 'TI_SYNC_FAILED';
    const payload = failed ? syncFailurePayloadSchema.parse(event.payload) : syncPayloadSchema.parse(event.payload);
    if (!failed && 'created' in payload && payload.created + payload.updated === 0) throw new Error('UnsupportedPayloadVersion');
    const admins = await this.prisma.user.findMany({ where: { tenantId: event.tenantId, role: 'ADMIN', isActive: true,
      tenant: { isActive: true } }, select: { id: true, tenantId: true, role: true } });
    const decisions = await Promise.all(admins.map(async admin => ({ admin,
      access: await this.access.evaluate({ sub: admin.id, tenantId: admin.tenantId, role: admin.role },
        'threat-intelligence', payload.workflow === 'MITRE' ? ['indicator-management', 'intelligence-hub'] : ['indicator-management']) })));
    const eligibleIds = decisions.filter(decision => decision.access.accessible).map(decision => decision.admin.id);
    await this.deliveryTransaction(async tx => {
      const current = await tx.notificationOutbox.findFirst({ where: { id: event.id, tenantId: event.tenantId,
        status: 'PROCESSING', claimToken: token } });
      if (!current) return;
      const validAdmins = eligibleIds.length ? await tx.user.findMany({ where: { id: { in: eligibleIds },
        tenantId: event.tenantId, role: 'ADMIN', isActive: true, tenant: { isActive: true } }, select: { id: true } }) : [];
      if (validAdmins.length) {
        const dedupeKey = `TI_SYNC:${event.id}`;
        const preview = 'created' in payload
          ? payload.workflow === 'MITRE' ? `${payload.sourceName} synchronized: ${payload.created} new threat actor${payload.created === 1 ? '' : 's'}`
            : `${payload.sourceName} synchronized: ${payload.created} new, ${payload.updated} updated`
          : `${payload.sourceName} synchronization failed repeatedly`;
        const notice = await tx.notification.upsert({ where: { tenantId_dedupeKey: { tenantId: event.tenantId, dedupeKey } },
          create: { tenantId: event.tenantId, type: event.type, sourceModule: 'THREAT_INTELLIGENCE',
            resourceKind: 'TENANT', resourceId: event.tenantId, priority: failed ? 'HIGH' : 'LOW', preview,
            route: payload.workflow === 'MITRE' ? '/threat-intelligence/mitre-attack' : '/threat-intelligence/feeds',
            eventAt: event.createdAt, dedupeKey }, update: {} });
        for (const admin of validAdmins) await tx.notificationRecipient.upsert({
          where: { notificationId_userId: { notificationId: notice.id, userId: admin.id } },
          create: { notificationId: notice.id, tenantId: event.tenantId, userId: admin.id }, update: {} });
      }
      await tx.notificationOutbox.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(),
        leasedUntil: null, claimToken: null, lastError: validAdmins.length ? null : 'NO_ELIGIBLE_RECIPIENT' } });
    });
  }

  private async deliverIocReview({ event, token }: Claim): Promise<void> {
    if (event.payloadVersion !== 1) throw new Error('UnsupportedPayloadVersion');
    iocReviewPayloadSchema.parse(event.payload);
    const pending = await this.prisma.iocCandidate.count({ where: { tenantId: event.tenantId, status: 'PENDING' } });
    const admins = pending ? await this.prisma.user.findMany({ where: { tenantId: event.tenantId, role: 'ADMIN', isActive: true,
      tenant: { isActive: true } }, select: { id: true, tenantId: true, role: true } }) : [];
    const decisions = await Promise.all(admins.map(async admin => ({ admin,
      access: await this.access.evaluate({ sub: admin.id, tenantId: admin.tenantId, role: admin.role },
        'threat-intelligence', ['indicator-management']) })));
    const eligibleIds = decisions.filter(decision => decision.access.accessible).map(decision => decision.admin.id);
    await this.deliveryTransaction(async tx => {
      const current = await tx.notificationOutbox.findFirst({ where: { id: event.id, tenantId: event.tenantId,
        status: 'PROCESSING', claimToken: token } });
      if (!current) return;
      const validAdmins = eligibleIds.length ? await tx.user.findMany({ where: { id: { in: eligibleIds },
        tenantId: event.tenantId, role: 'ADMIN', isActive: true, tenant: { isActive: true } }, select: { id: true } }) : [];
      if (pending && validAdmins.length) {
        const dedupeKey = `IOC_REVIEW:${event.id}`;
        const notice = await tx.notification.upsert({ where: { tenantId_dedupeKey: { tenantId: event.tenantId, dedupeKey } },
          create: { tenantId: event.tenantId, type: event.type, sourceModule: 'THREAT_INTELLIGENCE',
            resourceKind: 'TENANT', resourceId: event.tenantId, priority: 'MEDIUM',
            preview: 'New IOC candidates are ready for review', route: '/threat-intelligence/ioc-candidates',
            eventAt: event.createdAt, dedupeKey }, update: {} });
        for (const admin of validAdmins) await tx.notificationRecipient.upsert({
          where: { notificationId_userId: { notificationId: notice.id, userId: admin.id } },
          create: { notificationId: notice.id, tenantId: event.tenantId, userId: admin.id }, update: {} });
      }
      await tx.notificationOutbox.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(),
        leasedUntil: null, claimToken: null, lastError: validAdmins.length ? null : 'NO_ELIGIBLE_RECIPIENT' } });
    });
  }

  private async deliveryTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let retry = 0; ; retry += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || retry >= 7) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(20 * 2 ** retry, 250) + Math.floor(Math.random() * 20)));
      }
    }
  }

  private async finishWithoutDelivery(id: string, token: string, outcome: string | null = null): Promise<void> {
    await this.prisma.notificationOutbox.updateMany({ where: { id, status: 'PROCESSING', claimToken: token },
      data: { status: 'PROCESSED', processedAt: new Date(), leasedUntil: null, claimToken: null, lastError: outcome } });
  }

  private async fail(id: string, token: string, code: string): Promise<void> {
    const current = await this.prisma.notificationOutbox.findFirst({ where: { id, status: 'PROCESSING', claimToken: token }, select: { attempts: true } });
    if (!current) return;
    const terminal = current.attempts >= maxAttempts || code === 'ZodError' || code === 'UnsupportedEvent' || code === 'UnsupportedPayloadVersion';
    const backoff = Math.min(30_000 * 2 ** Math.max(0, current.attempts - 1), 15 * 60_000);
    await this.prisma.notificationOutbox.updateMany({ where: { id, status: 'PROCESSING', claimToken: token }, data: {
      status: terminal ? 'FAILED' : 'PENDING', availableAt: new Date(Date.now() + backoff), leasedUntil: null, claimToken: null,
      lastError: code === 'ZodError' ? 'INVALID_PAYLOAD' : code === 'UnsupportedEvent' || code === 'UnsupportedPayloadVersion' ? code : 'DELIVERY_FAILED',
    } });
    this.logger.warn('notification.delivery.failed', { eventId: id, terminal });
  }
}
