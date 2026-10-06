import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IndicatorStatus, IntelligenceSourceStatus, IntelligenceSourceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { IndicatorFeedClients } from './indicator-feed.clients';
import { feedProviders } from './indicator-feeds.types';
import type { FeedProvider, FeedRuntimeResult, FeedSyncResult, NormalizedIndicator } from './indicator-feeds.types';

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
      const counts = await this.upsertIndicators(user, tenantId, source.id, details.provider, indicators);
      await this.prisma.auditLog.create({
        data: {
          userId: user.sub,
          tenantId,
          action: 'INDICATOR_FEED_SYNCED',
          metadata: { provider, sourceId: source.id, ...counts } satisfies Prisma.InputJsonValue,
        },
      });
      this.logger.log('indicator.feed.sync.completed', { provider, tenantId, ...counts });
      return { provider, status: 'SYNCED', ...counts };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown feed error';
      await this.prisma.intelligenceSource.update({ where: { id: source.id }, data: { lastSyncAt: source.lastSyncAt } });
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
  ): Promise<{ readonly created: number; readonly updated: number; readonly skipped: number; readonly received: number }> {
    const keys = indicators.map(indicator => ({ tenantId, type: indicator.type, value: indicator.value }));
    const existing = await this.prisma.indicator.findMany({ where: { OR: keys }, select: { type: true, value: true } });
    const existingKeys = new Set(existing.map(indicator => `${indicator.type}:${indicator.value}`));

    const indicatorIds = await this.prisma.$transaction(async transaction => {
      const ids: string[] = [];
      for (const indicator of indicators) {
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
            tags: [...new Set(indicator.tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))],
            description: indicator.description,
          },
          update: {
            severity: indicator.severity,
            confidence: indicator.confidence,
            status: IndicatorStatus.ACTIVE,
            tags: [...new Set(indicator.tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))],
            description: indicator.description,
          },
          select: { id: true },
        });
        ids.push(record.id);
        await transaction.indicatorSourceObservation.upsert({
          where: { tenantId_indicatorId_sourceKey: { tenantId, indicatorId: record.id, sourceKey: sourceId } },
          create: { tenantId, indicatorId: record.id, intelligenceSourceId: sourceId, sourceKey: sourceId, sourceName, provider: sourceName, origin: 'FEED' },
          update: { sourceName, provider: sourceName, lastSeenAt: new Date() },
        });
      }
      return ids;
    }, { maxWait: 10_000, timeout: 60_000 });

    if (this.config.get<string>('VIRUSTOTAL_API_KEY')?.trim()) {
      for (const indicatorId of new Set(indicatorIds)) {
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

    const updated = indicators.filter(indicator => existingKeys.has(`${indicator.type}:${indicator.value}`)).length;
    return { created: indicators.length - updated, updated, skipped: 0, received: indicators.length };
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
