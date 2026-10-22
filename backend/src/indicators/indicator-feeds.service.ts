import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IndicatorStatus, IntelligenceSourceStatus, IntelligenceSourceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { IndicatorFeedClients } from './indicator-feed.clients';
import { feedProviders } from './indicator-feeds.types';
import type { FeedProvider, FeedRuntimeResult, FeedSyncResult, NormalizedIndicator } from './indicator-feeds.types';
import { enqueueIndicatorRiskIncrease } from '../notifications/indicator-risk-event';
import { newSyncRunId, recordSyncFailure, recordSyncSuccess } from '../notifications/ti-sync-event';

const providerDetails = {
  URLHAUS: { name: 'URLhaus Feed', provider: 'URLhaus', url: 'https://urlhaus.abuse.ch/', cooldownMs: 5 * 60_000 },
  MALWAREBAZAAR: { name: 'MalwareBazaar Feed', provider: 'MalwareBazaar', url: 'https://bazaar.abuse.ch/', cooldownMs: 5 * 60_000 },
  ABUSEIPDB: { name: 'AbuseIPDB Feed', provider: 'AbuseIPDB', url: 'https://www.abuseipdb.com/', cooldownMs: 6 * 60 * 60_000 },
} as const satisfies Record<FeedProvider, { readonly name: string; readonly provider: string; readonly url: string; readonly cooldownMs: number }>;

@Injectable()
export class IndicatorFeedsService {
  private readonly logger = new Logger(IndicatorFeedsService.name);
  private readonly latestResults = new Map<string, FeedRuntimeResult>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: IndicatorFeedClients,
    private readonly config: ConfigService,
  ) {}

  async sync(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new BadRequestException('Tenant tidak ditemukan');

    this.logger.log('indicator.feed.sync.started', { tenantId });
    const results = await Promise.all(feedProviders.map(provider => this.syncProviderSafely(user, tenantId, provider)));
    const completedAt = new Date();
    for (const result of results) this.latestResults.set(this.resultKey(tenantId, result.provider), { ...result, completedAt });
    const totals = results.reduce((summary, result) => ({
      created: summary.created + result.created,
      updated: summary.updated + result.updated,
      skipped: summary.skipped + result.skipped,
      received: summary.received + result.received,
    }), { created: 0, updated: 0, skipped: 0, received: 0 });
    this.logger.log('indicator.feed.sync.finished', { tenantId, ...totals });
    return { tenantId, results, totals };
  }

  private async syncProviderSafely(user: AuthUser, tenantId: string, provider: FeedProvider): Promise<FeedSyncResult> {
    try {
      return await this.syncProvider(user, tenantId, provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown feed error';
      this.logger.error('indicator.feed.sync.failed', { provider, tenantId, error: message });
      return { provider, status: 'FAILED', created: 0, updated: 0, skipped: 0, received: 0, message };
    }
  }

  async status(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const sources = await this.prisma.intelligenceSource.findMany({
      where: { tenantId, provider: { in: Object.values(providerDetails).map(details => details.provider) } },
      select: { provider: true, status: true, lastSyncAt: true, _count: { select: { indicatorObservations: true } } },
    });
    const sourceByProvider = new Map(sources.map(source => [source.provider, source]));
    const providers = feedProviders.map(provider => {
      const details = providerDetails[provider];
      const source = sourceByProvider.get(details.provider);
      const latest = this.latestResults.get(this.resultKey(tenantId, provider));
      const configured = this.clients.isConfigured(provider);
      const failed = latest?.status === 'FAILED' || source?.status === IntelligenceSourceStatus.INACTIVE;
      return {
        provider,
        name: details.provider,
        status: configured ? (failed ? 'FAILED' : 'ACTIVE') : 'NOT_CONFIGURED',
        lastSyncAt: latest?.completedAt ?? source?.lastSyncAt ?? null,
        received: latest?.received ?? source?._count.indicatorObservations ?? 0,
        created: latest?.created ?? null,
        updated: latest?.updated ?? null,
        error: latest?.status === 'FAILED' ? latest.message ?? 'Feed sync gagal' : source?.status === IntelligenceSourceStatus.INACTIVE ? 'Intelligence source tidak aktif' : null,
      } as const;
    });
    return {
      tenantId,
      scheduler: { enabled: true, intervalMinutes: this.intervalMinutes(), nextSyncAt: null },
      providers,
    };
  }

  private async syncProvider(user: AuthUser, tenantId: string, provider: FeedProvider): Promise<FeedSyncResult> {
    if (!this.clients.isConfigured(provider)) {
      const variableName = this.clients.configurationVariable(provider);
      this.logger.warn('indicator.feed.sync.provider_unconfigured', { provider, tenantId, variableName });
      return { provider, status: 'SKIPPED', created: 0, updated: 0, skipped: 0, received: 0, message: `Environment variable ${variableName} belum dikonfigurasi` };
    }

    const details = providerDetails[provider];
    const source = await this.prisma.intelligenceSource.upsert({
      where: { tenantId_name: { tenantId, name: details.name } },
      create: {
        tenantId,
        name: details.name,
        description: `Automated indicator ingestion from ${details.provider}`,
        sourceType: IntelligenceSourceType.COMMUNITY,
        provider: details.provider,
        url: details.url,
        status: IntelligenceSourceStatus.ACTIVE,
        createdBy: user.sub,
      },
      update: { provider: details.provider, url: details.url },
    });

    if (source.status === IntelligenceSourceStatus.INACTIVE) {
      this.logger.warn('indicator.feed.sync.provider_skipped', { provider, tenantId, reason: 'source_inactive' });
      return { provider, status: 'SKIPPED', created: 0, updated: 0, skipped: 0, received: 0, message: 'Intelligence source tidak aktif' };
    }

    const syncStartedAt = new Date();
    const runId = newSyncRunId();
    const reservation = await this.prisma.intelligenceSource.updateMany({
      where: {
        id: source.id,
        OR: [{ lastSyncAt: null }, { lastSyncAt: { lte: new Date(syncStartedAt.getTime() - details.cooldownMs) } }],
      },
      data: { lastSyncAt: syncStartedAt },
    });
    if (reservation.count === 0) {
      this.logger.log('indicator.feed.sync.provider_skipped', { provider, tenantId, reason: 'cooldown_active' });
      return { provider, status: 'SKIPPED', created: 0, updated: 0, skipped: 0, received: 0, message: 'Cooldown feed masih aktif' };
    }

    try {
      const indicators = await this.clients.fetch(provider);
      const counts = await this.upsertIndicators(user, tenantId, source.id, details.provider, indicators, runId);
      this.logger.log('indicator.feed.sync.completed', { provider, tenantId, ...counts });
      return { provider, status: 'SYNCED', ...counts };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown feed error';
      await this.prisma.intelligenceSource.update({ where: { id: source.id }, data: { lastSyncAt: source.lastSyncAt } });
      await recordSyncFailure(this.prisma, { tenantId, userId: user.sub, workflow: 'FEED',
        sourceKey: `FEED:${source.id}`, sourceName: details.provider });
      this.logger.error('indicator.feed.sync.failed', { provider, tenantId, error: message });
      return { provider, status: 'FAILED', created: 0, updated: 0, skipped: 0, received: 0, message };
    }
  }

  private async upsertIndicators(
    user: AuthUser,
    tenantId: string,
    sourceId: string,
    sourceName: string,
    indicators: readonly NormalizedIndicator[],
    runId = newSyncRunId(),
  ): Promise<{ readonly created: number; readonly updated: number; readonly skipped: number; readonly received: number }> {
    const upsert = async () => this.prisma.$transaction(async transaction => {
      const ids: string[] = [];
      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const indicator of indicators) {
        const previous = await transaction.indicator.findUnique({
          where: { tenantId_type_value: { tenantId, type: indicator.type, value: indicator.value } },
          select: { severity: true, confidence: true, status: true, tags: true, description: true },
        });
        const tags = [...new Set(indicator.tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))];
        const changed = previous && (previous.severity !== indicator.severity || previous.confidence !== indicator.confidence
          || previous.status !== IndicatorStatus.ACTIVE || previous.description !== indicator.description
          || JSON.stringify(previous.tags) !== JSON.stringify(tags));
        if (!previous) created += 1;
        else if (changed) updated += 1;
        else skipped += 1;
        const record = await transaction.indicator.upsert({
          where: { tenantId_type_value: { tenantId, type: indicator.type, value: indicator.value } },
          create: {
            tenantId,
            createdById: user.sub,
            intelligenceSourceId: sourceId,
            source: sourceName,
            value: indicator.value,
            type: indicator.type,
            severity: indicator.severity,
            confidence: indicator.confidence,
            status: IndicatorStatus.ACTIVE,
            tags,
            description: indicator.description,
          },
          update: {
            severity: indicator.severity,
            confidence: indicator.confidence,
            status: IndicatorStatus.ACTIVE,
            tags,
            description: indicator.description,
          },
          select: { id: true, severity: true },
        });
        ids.push(record.id);
        if (previous) await enqueueIndicatorRiskIncrease(transaction, {
          tenantId, indicatorId: record.id, previous: previous.severity, next: record.severity, actorId: null, source: 'FEED',
        });
        await transaction.indicatorSourceObservation.upsert({
          where: { tenantId_indicatorId_sourceKey: { tenantId, indicatorId: record.id, sourceKey: sourceId } },
          create: { tenantId, indicatorId: record.id, intelligenceSourceId: sourceId, sourceKey: sourceId, sourceName, provider: sourceName, origin: 'FEED' },
          update: { sourceName, provider: sourceName, lastSeenAt: new Date() },
        });
      }
      await recordSyncSuccess(transaction, { tenantId, userId: user.sub, workflow: 'FEED',
        sourceKey: `FEED:${sourceId}`, sourceName, runId, created, updated });
      await transaction.auditLog.create({ data: { userId: user.sub, tenantId, action: 'INDICATOR_FEED_SYNCED',
        metadata: { provider: sourceName.toUpperCase(), sourceId, created, updated, skipped, received: indicators.length } satisfies Prisma.InputJsonValue } });
      return { ids, counts: { created, updated, skipped, received: indicators.length } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
    let result: Awaited<ReturnType<typeof upsert>>;
    for (let retry = 0; ; retry += 1) {
      try { result = await upsert(); break; }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || retry >= 7) throw error;
      }
    }

    if (this.config.get<string>('VIRUSTOTAL_API_KEY')?.trim()) {
      for (const indicatorId of new Set(result.ids)) {
        try {
          await this.prisma.indicatorEnrichmentJob.createMany({
            data: { tenantId, indicatorId, provider: 'VIRUSTOTAL', trigger: 'FEED_SYNC', requestedById: user.sub },
            skipDuplicates: true,
          });
        } catch (error) {
          this.logger.error('indicator.feed.enrichment_enqueue.failed', {
            tenantId, indicatorId, error: error instanceof Error ? error.message : 'Unknown enqueue error',
          });
        }
      }
    }

    return result.counts;
  }

  private resolveTenant(user: AuthUser, requestedTenantId?: string): string {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId?.trim()) throw new BadRequestException('Tenant wajib dipilih');
      return requestedTenantId.trim();
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }

  private intervalMinutes(): number {
    const configured = Number(this.config.get<string>('THREAT_FEED_SYNC_INTERVAL_MINUTES'));
    return Number.isInteger(configured) && configured > 0 ? configured : 60;
  }

  private resultKey(tenantId: string, provider: FeedProvider): string { return `${tenantId}:${provider}`; }
}
