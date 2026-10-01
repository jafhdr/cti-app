import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AssetFindingStatus, AssetFindingSeverity } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateFindingDto, UpdateFindingDto } from './findings.dto';
import { AsmAlertsService } from './alerts.service';

@Injectable()
export class FindingsService {
  constructor(private readonly prisma: PrismaService, private readonly alerts: AsmAlertsService) {}

  private async tenant(user: AuthUser, requested?: string): Promise<string> {
    if (user.role === 'SUPER_ADMIN') {
      if (!requested) throw new BadRequestException('Tenant wajib');
      const tenant = await this.prisma.tenant.findUnique({ where: { id: requested }, select: { id: true } });
      if (!tenant) throw new BadRequestException('Tenant tidak ditemukan');
      return tenant.id;
    }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib');
    return user.tenantId;
  }

  private async asset(user: AuthUser, assetId: string, requested?: string) {
    const tenantId = await this.tenant(user, requested);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true, tenantId: true } });
    if (!asset) throw new NotFoundException('Asset tidak ditemukan');
    return asset;
  }

  async list(user: AuthUser, assetId: string, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    return this.prisma.assetFinding.findMany({ where: { tenantId: asset.tenantId, assetId }, orderBy: { lastSeenAt: 'desc' } });
  }

  async detail(user: AuthUser, assetId: string, findingId: string, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    const finding = await this.prisma.assetFinding.findFirst({ where: { id: findingId, tenantId: asset.tenantId, assetId } });
    if (!finding) throw new NotFoundException('Finding tidak ditemukan');
    return finding;
  }

  async create(user: AuthUser, assetId: string, input: CreateFindingDto, requested?: string) {
    const asset = await this.asset(user, assetId, requested);
    const title = input.title.trim();
    const type = input.type.trim();
    if (!title || !type || !input.description.trim()) throw new BadRequestException('Title, type, dan description wajib');
    const finding = await this.prisma.assetFinding.create({ data: {
      tenantId: asset.tenantId, assetId, title, type, description: input.description.trim(),
      severity: input.severity, source: 'MANUAL', sourceKey: `manual:${randomUUID()}`,
    } });
    if (finding.severity === 'HIGH' || finding.severity === 'CRITICAL') await this.alerts.observe({ tenantId: asset.tenantId, assetId, sourceKey: `finding:${finding.id}`, title: finding.title, description: finding.description, severity: finding.severity, findingId: finding.id });
    await this.prisma.auditLog.create({ data: { userId: user.sub, tenantId: asset.tenantId, action: 'ASSET_FINDING_CREATED', metadata: { assetId, findingId: finding.id } } });
    return finding;
  }

  async update(user: AuthUser, assetId: string, findingId: string, input: UpdateFindingDto, requested?: string) {
    const finding = await this.detail(user, assetId, findingId, requested);
    const updated = await this.prisma.assetFinding.update({ where: { id: finding.id }, data: { severity: input.severity, status: input.status } });
    await this.prisma.auditLog.create({ data: { userId: user.sub, tenantId: finding.tenantId, action: 'ASSET_FINDING_UPDATED', metadata: { assetId, findingId, status: input.status, severity: input.severity } } });
    return updated;
  }

  async risk(user: AuthUser, assetId: string, requested?: string) {
    const findings = await this.list(user, assetId, requested);
    const open = findings.filter(f => f.status === AssetFindingStatus.OPEN || f.status === AssetFindingStatus.IN_PROGRESS);
    return {
      total: findings.length,
      critical: open.filter(f => f.severity === AssetFindingSeverity.CRITICAL).length,
      high: open.filter(f => f.severity === AssetFindingSeverity.HIGH).length,
      medium: open.filter(f => f.severity === AssetFindingSeverity.MEDIUM).length,
      low: open.filter(f => f.severity === AssetFindingSeverity.LOW).length,
      open: open.length,
    };
  }
}
