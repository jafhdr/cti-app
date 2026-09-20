import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import {
  EnrichmentConfigurationError,
  IndicatorEnrichmentClient,
  InvalidIndicatorValueError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderTimeoutError,
  UnsupportedIndicatorTypeError,
} from './indicator-enrichment.client';
import { indicatorEnrichmentInputSchema, type IndicatorEnrichmentInput } from './indicator-enrichment.types';

@Injectable()
export class IndicatorEnrichmentService {
  constructor(private readonly prisma: PrismaService, private readonly client: IndicatorEnrichmentClient) {}

  async list(currentUser: AuthUser, indicatorId: string) {
    const indicator = await this.scopedIndicator(currentUser, indicatorId);
    return this.prisma.indicatorEnrichment.findMany({
      where: { indicatorId: indicator.id, tenantId: indicator.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async run(currentUser: AuthUser, indicatorId: string, input: IndicatorEnrichmentInput = { provider: 'AUTO' }) {
    const indicator = await this.scopedIndicator(currentUser, indicatorId);
    const { provider } = indicatorEnrichmentInputSchema.parse(input);
    try {
      const result = await this.client.enrich(indicator.type, indicator.value, provider);
      return this.prisma.indicatorEnrichment.create({
        data: { tenantId: indicator.tenantId, indicatorId, provider: result.provider, data: result.data, status: 'SUCCESS' },
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Enrichment gagal';
      return this.prisma.indicatorEnrichment.create({
        data: { tenantId: indicator.tenantId, indicatorId, provider: this.client.provider(indicator.type, provider), data: Prisma.JsonNull, status: 'FAILED', error },
      });
    }
  }

  async runVirusTotalAutomation(tenantId: string, indicatorId: string, cooldownMs: number) {
    const indicator = await this.prisma.indicator.findFirst({ where: { id: indicatorId, tenantId }, select: { id: true, tenantId: true, type: true, value: true } });
    if (!indicator) throw new NotFoundException('Indicator tidak ditemukan');
    const fresh = await this.prisma.indicatorEnrichment.findFirst({
      where: { tenantId, indicatorId, provider: 'VIRUSTOTAL', status: 'SUCCESS', createdAt: { gte: new Date(Date.now() - cooldownMs) } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (fresh) return { kind: 'fresh' as const, enrichmentId: fresh.id };
    try {
      const result = await this.client.enrich(indicator.type, indicator.value, 'VIRUSTOTAL');
      const enrichment = await this.prisma.indicatorEnrichment.create({
        data: { tenantId, indicatorId, provider: result.provider, data: result.data, status: 'SUCCESS' },
      });
      return { kind: 'success' as const, enrichmentId: enrichment.id };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Enrichment gagal';
      await this.prisma.indicatorEnrichment.create({
        data: { tenantId, indicatorId, provider: 'VIRUSTOTAL', data: Prisma.JsonNull, status: 'FAILED', error },
      });
      return {
        kind: 'failure' as const,
        retryable: cause instanceof ProviderTimeoutError
          || cause instanceof ProviderNetworkError
          || (cause instanceof ProviderHttpError && (cause.statusCode === 429 || cause.statusCode >= 500)),
        retryAfterMs: cause instanceof ProviderHttpError ? cause.retryAfterMs : null,
        message: error,
        permanent: cause instanceof EnrichmentConfigurationError || cause instanceof UnsupportedIndicatorTypeError || cause instanceof InvalidIndicatorValueError,
      };
    }
  }

  private async scopedIndicator(currentUser: AuthUser, id: string) {
    const indicator = await this.prisma.indicator.findUnique({ where: { id }, select: { id: true, tenantId: true, type: true, value: true } });
    if (!indicator) throw new NotFoundException('Indicator tidak ditemukan');
    if (currentUser.role !== 'SUPER_ADMIN' && indicator.tenantId !== currentUser.tenantId) throw new ForbiddenException('Indicator berada di tenant lain');
    return indicator;
  }
}
