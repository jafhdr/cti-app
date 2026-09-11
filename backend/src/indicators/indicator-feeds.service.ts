import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { IndicatorStatus, IntelligenceSourceStatus, IntelligenceSourceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { IndicatorFeedClients } from './indicator-feed.clients';
import { feedProviders } from './indicator-feeds.types';
import type { FeedProvider, FeedSyncResult, NormalizedIndicator } from './indicator-feeds.types';

const providerDetails = {
  URLHAUS: { name: 'URLhaus Feed', provider: 'URLhaus', url: 'https://urlhaus.abuse.ch/', cooldownMs: 5 * 60_000 },
  MALWAREBAZAAR: { name: 'MalwareBazaar Feed', provider: 'MalwareBazaar', url: 'https://bazaar.abuse.ch/', cooldownMs: 5 * 60_000 },
  ABUSEIPDB: { name: 'AbuseIPDB Feed', provider: 'AbuseIPDB', url: 'https://www.abuseipdb.com/', cooldownMs: 6 * 60 * 60_000 },
} as const satisfies Record<FeedProvider, { readonly name: string; readonly provider: string; readonly url: string; readonly cooldownMs: number }>;

@Injectable()
export class IndicatorFeedsService {
  private readonly logger = new Logger(IndicatorFeedsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: IndicatorFeedClients,
  ) {}

  async sync(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new BadRequestException('Tenant tidak ditemukan');

    this.logger.log('indicator.feed.sync.started', { tenantId });
    const results = await Promise.all(feedProviders.map(provider => this.syncProvider(user, tenantId, provider)));
    const totals = results.reduce((summary, result) => ({
      created: summary.created + result.created,
      updated: summary.updated + result.updated,
      skipped: summary.skipped + result.skipped,
      received: summary.received + result.received,
    }), { created: 0, updated: 0, skipped: 0, received: 0 });
    this.logger.log('indicator.feed.sync.finished', { tenantId, ...totals });
    return { tenantId, results, totals };
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

    await this.prisma.$transaction(indicators.map(indicator => this.prisma.indicator.upsert({
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
        intelligenceSourceId: sourceId,
        source: sourceName,
        severity: indicator.severity,
        confidence: indicator.confidence,
        status: IndicatorStatus.ACTIVE,
        tags: [...new Set(indicator.tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))],
        description: indicator.description,
      },
    })));

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
}
