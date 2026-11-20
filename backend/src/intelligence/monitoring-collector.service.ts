import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { collectionResponseSchema, connectorSecret, evidenceDigest, signConnector, verifyConnector, type CollectionRequest } from './monitoring-connector.contract';
import { MonitoringService, monitoringTenant } from './monitoring.service';

@Injectable()
export class MonitoringCollectorService {
  constructor(private readonly prisma: PrismaService, private readonly monitoring: MonitoringService) {}

  private qa(): void {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://invalid@localhost/invalid').pathname;
    if (process.env.SICTI_ISOLATED_QA !== 'true' || process.env.SICTI_MONITORING_QA_ENABLED !== 'true'
      || process.env.SICTI_MONITORING_CONNECTOR_QA_ENABLED !== 'true' || !/^\/cti_phase4a_qa_[a-z0-9]+$/.test(db)) {
      throw new ForbiddenException('Monitoring collection is disabled');
    }
  }

  private endpoint(): string {
    const value = process.env.SICTI_MONITORING_SIMULATOR_URL;
    if (!value) throw new ForbiddenException('Simulator endpoint unavailable');
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/v1/collect' || url.search || url.hash) {
      throw new ForbiddenException('Simulator must use the fixed loopback path');
    }
    return url.toString();
  }

  async configure(user: AuthUser, id: string, intervalMinutes: number, requested?: string) {
    this.qa();
    this.endpoint(); connectorSecret();
    const tenantId = monitoringTenant(user, requested);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) throw new BadRequestException('Invalid collection interval');
    const source = await this.prisma.monitoringSource.findFirst({ where: { id, tenantId, authorized: true, qaOnly: true, catalogSource: { status: 'ACTIVE' } } });
    if (!source) throw new NotFoundException('Authorized source not found');
    return this.prisma.$transaction(async tx => {
      const updated = await tx.monitoringSource.update({ where: { id }, data: { collectionEnabled: true, connectorVersion: 1, collectionIntervalMinutes: intervalMinutes, nextCollectionAt: new Date() } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'MONITORING_QA_CONNECTOR_ENABLED', metadata: { sourceId: id, version: 1, intervalMinutes } } });
      return updated;
    });
  }

  async disable(user: AuthUser, id: string, requested?: string) {
    const tenantId = monitoringTenant(user, requested);
    const changed = await this.prisma.monitoringSource.updateMany({ where: { id, tenantId }, data: { collectionEnabled: false, nextCollectionAt: null } });
    if (!changed.count) throw new NotFoundException('Source not found');
    await this.prisma.auditLog.create({ data: { tenantId, userId: user.sub, action: 'MONITORING_QA_CONNECTOR_DISABLED', metadata: { sourceId: id } } });
    return { collectionEnabled: false };
  }

  async enqueue(user: AuthUser, id: string, requested?: string) {
    this.qa();
    const tenantId = monitoringTenant(user, requested);
    const source = await this.prisma.monitoringSource.findFirst({ where: { id, tenantId, collectionEnabled: true, catalogSource: { status: 'ACTIVE' } } });
    if (!source) throw new NotFoundException('Enabled source not found');
    const recent = await this.prisma.monitoringCollectionJob.findFirst({ where: { tenantId, sourceId: id, createdAt: { gt: new Date(Date.now() - 5_000) } }, select: { id: true } });
    if (recent) throw new HttpException('Collection rate limit', HttpStatus.TOO_MANY_REQUESTS);
    const job = await this.prisma.monitoringCollectionJob.create({ data: { tenantId, sourceId: id, requestId: randomUUID() } });
    await this.prisma.auditLog.create({ data: { tenantId, userId: user.sub, action: 'MONITORING_QA_COLLECTION_QUEUED', metadata: { sourceId: id, jobId: job.id } } });
    return job;
  }

  async history(user: AuthUser, requested?: string) {
    return this.prisma.monitoringCollectionJob.findMany({ where: { tenantId: monitoringTenant(user, requested) }, select: { id: true, sourceId: true, status: true, attempt: true, createdAt: true, finishedAt: true, observationCount: true, failureReason: true, collectionLatencyMs: true, processingLatencyMs: true }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @Interval(60_000)
  async scheduleDue(tenantId?: string): Promise<number> {
    try { this.qa(); } catch { return 0; }
    const now = new Date();
    const sources = await this.prisma.monitoringSource.findMany({ where: { ...(tenantId ? { tenantId } : {}), collectionEnabled: true, nextCollectionAt: { lte: now }, catalogSource: { status: 'ACTIVE' } }, select: { id: true, tenantId: true, nextCollectionAt: true, collectionIntervalMinutes: true }, take: 50 });
    let queued = 0;
    for (const source of sources) {
      const won = await this.prisma.$transaction(async tx => {
        const changed = await tx.monitoringSource.updateMany({ where: { id: source.id, tenantId: source.tenantId, collectionEnabled: true, nextCollectionAt: source.nextCollectionAt }, data: { nextCollectionAt: new Date(now.getTime() + source.collectionIntervalMinutes * 60_000) } });
        if (!changed.count) return false;
        const job = await tx.monitoringCollectionJob.create({ data: { tenantId: source.tenantId, sourceId: source.id, requestId: randomUUID() } });
        await tx.auditLog.create({ data: { tenantId: source.tenantId, action: 'MONITORING_QA_COLLECTION_SCHEDULED', metadata: { sourceId: source.id, jobId: job.id } } });
        return true;
      });
      if (won) queued++;
    }
    return queued;
  }

  @Interval(5_000)
  async processDue(tenantId?: string): Promise<number> {
    try { this.qa(); } catch { return 0; }
    const jobs = await this.prisma.monitoringCollectionJob.findMany({ where: { ...(tenantId ? { tenantId } : {}), OR: [{ status: { in: ['QUEUED', 'RETRY'] }, dueAt: { lte: new Date() } }, { status: 'RUNNING', leaseUntil: { lt: new Date() } }] }, orderBy: { dueAt: 'asc' }, take: 10 });
    let processed = 0;
    for (const job of jobs) {
      const claimed = await this.prisma.monitoringCollectionJob.updateMany({ where: { id: job.id, status: job.status, attempt: job.attempt }, data: { status: 'RUNNING', attempt: { increment: 1 }, leaseUntil: new Date(Date.now() + 30_000), startedAt: new Date() } });
      if (!claimed.count) continue;
      processed++;
      try { await this.collect(job.id); }
      catch (error) {
        const reason = error instanceof Error && /rate limit/i.test(error.message) ? 'PROVIDER_RATE_LIMIT' : 'SIMULATOR_UNAVAILABLE_OR_INVALID';
        const final = job.attempt + 1 >= 3;
        await this.prisma.$transaction(async tx => {
          await tx.monitoringCollectionJob.update({ where: { id: job.id }, data: { status: final ? 'FAILED' : 'RETRY', failureReason: reason, leaseUntil: null, dueAt: new Date(Date.now() + (job.attempt + 1) * 5_000), finishedAt: final ? new Date() : null } });
          await tx.monitoringSource.update({ where: { id: job.sourceId }, data: { lastFailureReason: reason } });
          await tx.auditLog.create({ data: { tenantId: job.tenantId, action: final ? 'MONITORING_QA_COLLECTION_FAILED' : 'MONITORING_QA_COLLECTION_RETRY', metadata: { jobId: job.id, attempt: job.attempt + 1, reason } } });
        });
      }
    }
    return processed;
  }

  private async collect(jobId: string): Promise<void> {
    const job = await this.prisma.monitoringCollectionJob.findUniqueOrThrow({ where: { id: jobId }, include: { source: { include: { catalogSource: { select: { status: true, createdBy: true } } } } } });
    if (!job.source.collectionEnabled || job.source.catalogSource?.status !== 'ACTIVE') throw new Error('Source unavailable');
    const watch = await this.prisma.monitoringWatchlist.findFirst({ where: { tenantId: job.tenantId, active: true, kind: { in: ['DOMAIN', 'BRAND'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } });
    if (!watch) throw new Error('No authorized watch');
    const targetDomain = watch.kind === 'DOMAIN' ? watch.value : `${watch.value.replace(/\s+/g, '-')}-login.test`;
    const request: CollectionRequest = { version: 1, requestId: job.requestId, tenantId: job.tenantId, sourceId: job.sourceId, providerKey: job.source.providerKey, targetDomain, requestedAt: job.createdAt.toISOString() };
    const body = JSON.stringify(request);
    const sentAt = Date.now();
    const response = await fetch(this.endpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-sicti-signature': signConnector(body, connectorSecret()) }, body, signal: AbortSignal.timeout(3_000) });
    if (response.status === 429) throw new Error('Provider rate limit');
    if (!response.ok) throw new Error('Simulator unavailable');
    const raw = await response.text();
    if (raw.length > 40_000 || !verifyConnector(raw, response.headers.get('x-sicti-signature'), connectorSecret())) throw new Error('Simulator signature invalid');
    const payload = collectionResponseSchema.parse(JSON.parse(raw));
    if (payload.requestId !== job.requestId || payload.tenantId !== job.tenantId || payload.sourceId !== job.sourceId || payload.providerKey !== job.source.providerKey || Date.now() - new Date(payload.publishedAt).getTime() > 300_000) throw new Error('Simulator provenance invalid');
    const receivedAt = Date.now();
    const actor: AuthUser = { sub: job.source.catalogSource.createdBy, tenantId: job.tenantId, role: 'ADMIN' };
    for (const item of payload.observations) {
      const evidenceSubject = item.domain ?? item.identity;
      if (!evidenceSubject || item.evidenceDigest !== evidenceDigest(item.providerEventKey, evidenceSubject, item.observedAt)) throw new Error('Evidence digest invalid');
      const ingested = await this.monitoring.ingest(actor, { sourceId: job.sourceId, ...item });
      await this.prisma.monitoringObservation.updateMany({ where: { id: ingested.id, tenantId: job.tenantId, OR: [{ collectionJobId: null }, { collectionJobId: job.id }] }, data: { collectionJobId: job.id, collectionJobTenantId: job.tenantId, collectedAt: new Date(receivedAt), providerPublishedAt: new Date(payload.publishedAt) } });
    }
    await this.prisma.$transaction(async tx => {
      await tx.monitoringCollectionJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', leaseUntil: null, finishedAt: new Date(), observationCount: payload.observations.length, failureReason: null, collectionLatencyMs: receivedAt - sentAt, processingLatencyMs: Date.now() - receivedAt } });
      await tx.monitoringSource.update({ where: { id: job.sourceId }, data: { lastSuccessAt: new Date(), lastFailureReason: null, coverageLabel: payload.coverageLabel } });
      await tx.auditLog.create({ data: { tenantId: job.tenantId, action: 'MONITORING_QA_COLLECTION_SUCCEEDED', metadata: { jobId: job.id, observationCount: payload.observations.length } } });
    });
  }
}
