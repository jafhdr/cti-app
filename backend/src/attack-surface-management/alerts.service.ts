import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus, type IndicatorSeverity } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';

@Injectable()
export class AsmAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  private async asset(user: AuthUser, assetId: string, requested?: string) {
    const tenantId = user.role === 'SUPER_ADMIN' ? requested : user.tenantId;
    if (!tenantId) throw user.role === 'SUPER_ADMIN' ? new BadRequestException('Tenant wajib') : new ForbiddenException('Tenant context wajib');
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true, tenantId: true, value: true } });
    if (!asset) throw new NotFoundException('Asset tidak ditemukan');
    return asset;
  }

  async list(user: AuthUser, assetId: string, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    return this.prisma.alert.findMany({ where: { tenantId: asset.tenantId, assetId, source: 'ASM' }, orderBy: { lastSeenAt: 'desc' }, include: { case: { select: { id: true, caseNumber: true, status: true } } } });
  }

  async detail(user: AuthUser, assetId: string, alertId: string, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    const alert = await this.prisma.alert.findFirst({ where: { id: alertId, tenantId: asset.tenantId, assetId, source: 'ASM' }, include: { case: { select: { id: true, caseNumber: true, status: true } } } });
    if (!alert) throw new NotFoundException('Alert tidak ditemukan');
    return alert;
  }

  async acknowledge(user: AuthUser, assetId: string, alertId: string, requested?: string) {
    const alert = await this.detail(user, assetId, alertId, requested);
    if (alert.status !== AlertStatus.OPEN) return alert;
    return this.prisma.$transaction(async tx => {
      const updated = await tx.alert.update({ where: { id: alertId }, data: { status: AlertStatus.ACKNOWLEDGED, acknowledgedAt: new Date(), acknowledgedBy: user.sub } });
      await tx.auditLog.create({ data: { tenantId: alert.tenantId, userId: user.sub, action: 'ASM_ALERT_ACKNOWLEDGED', metadata: { alertId, assetId } } });
      return updated;
    });
  }

  async resolve(user: AuthUser, assetId: string, alertId: string, requested?: string) {
    const alert = await this.detail(user, assetId, alertId, requested);
    if (alert.status === AlertStatus.CLOSED) return alert;
    return this.prisma.$transaction(async tx => {
      const updated = await tx.alert.update({ where: { id: alertId }, data: { status: AlertStatus.CLOSED } });
      await tx.auditLog.create({ data: { tenantId: alert.tenantId, userId: user.sub, action: 'ASM_ALERT_RESOLVED', metadata: { alertId, assetId } } });
      return updated;
    });
  }

  async observe(input: { readonly tenantId: string; readonly assetId: string; readonly sourceKey: string; readonly title: string; readonly description: string; readonly severity: IndicatorSeverity; readonly findingId?: string; readonly changeEventId?: string; readonly vulnerabilityCorrelationId?: string }) {
    const now = new Date();
    const existing = await this.prisma.alert.findUnique({ where: { tenantId_source_sourceKey: { tenantId: input.tenantId, source: 'ASM', sourceKey: input.sourceKey } } });
    const alert = await this.prisma.alert.upsert({
      where: { tenantId_source_sourceKey: { tenantId: input.tenantId, source: 'ASM', sourceKey: input.sourceKey } },
      create: { ...input, source: 'ASM', firstSeenAt: now, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
    if (!existing) await this.prisma.auditLog.create({ data: { tenantId: input.tenantId, action: 'ASM_ALERT_CREATED', metadata: { alertId: alert.id, assetId: input.assetId, sourceKey: input.sourceKey } } });
    return alert;
  }
}
