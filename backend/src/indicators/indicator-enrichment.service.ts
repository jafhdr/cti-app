import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { IndicatorEnrichmentClient } from './indicator-enrichment.client';

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

  async run(currentUser: AuthUser, indicatorId: string) {
    const indicator = await this.scopedIndicator(currentUser, indicatorId);
    try {
      const result = await this.client.enrich(indicator.type, indicator.value);
      return this.prisma.indicatorEnrichment.create({
        data: { tenantId: indicator.tenantId, indicatorId, provider: result.provider, data: result.data, status: 'SUCCESS' },
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Enrichment gagal';
      return this.prisma.indicatorEnrichment.create({
        data: { tenantId: indicator.tenantId, indicatorId, provider: this.client.provider(indicator.type), data: Prisma.JsonNull, status: 'FAILED', error },
      });
    }
  }

  private async scopedIndicator(currentUser: AuthUser, id: string) {
    const indicator = await this.prisma.indicator.findUnique({ where: { id }, select: { id: true, tenantId: true, type: true, value: true } });
    if (!indicator) throw new NotFoundException('Indicator tidak ditemukan');
    if (currentUser.role !== 'SUPER_ADMIN' && indicator.tenantId !== currentUser.tenantId) throw new ForbiddenException('Indicator berada di tenant lain');
    return indicator;
  }
}
