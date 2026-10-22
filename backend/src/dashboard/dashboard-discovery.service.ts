import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ModuleAccessService } from '../auth/module-access.service';
import type { AuthUser } from '../users/users.types';

type Source = 'INDICATOR' | 'ASSET' | 'CASE' | 'APPLICATION' | 'APPSEC_FINDING';
type Result = { readonly id: string; readonly title: string; readonly subtitle: string; readonly route: string };
type Group = { readonly source: Source; readonly items: readonly Result[]; readonly hasMore: boolean };

@Injectable()
export class DashboardDiscoveryService {
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService) {}

  private async tenant(user: AuthUser, requested?: string): Promise<string> {
    if (user.role !== 'SUPER_ADMIN') {
      if (!user.tenantId) throw new ForbiddenException('Tenant context wajib');
      if (requested && requested !== user.tenantId) throw new ForbiddenException('Tenant tidak diizinkan');
      return user.tenantId;
    }
    if (!requested?.trim()) throw new BadRequestException('Tenant wajib dipilih');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: requested }, select: { id: true, isActive: true } });
    if (!tenant?.isActive) throw new NotFoundException('Tenant tidak ditemukan');
    return tenant.id;
  }

  private async allowed(user: AuthUser, tenantId: string, slug: string, feature: string): Promise<boolean> {
    const result = user.role === 'SUPER_ADMIN'
      ? await this.access.evaluateForTenant(user, tenantId, slug, [feature])
      : await this.access.evaluate(user, slug, [feature]);
    return result.accessible;
  }

  async search(user: AuthUser, raw: string, requested?: string) {
    const q = raw?.trim();
    if (!q || q.length < 2 || q.length > 120) throw new BadRequestException('Query harus 2–120 karakter');
    const tenantId = await this.tenant(user, requested);
    const permissions = await Promise.all([
      this.allowed(user, tenantId, 'threat-intelligence', 'indicator-management'),
      this.allowed(user, tenantId, 'attack-surface-management', 'asset-management'),
      this.allowed(user, tenantId, 'case-management', 'case-workflow'),
      this.allowed(user, tenantId, 'appsec-posture', 'application-inventory'),
      this.allowed(user, tenantId, 'appsec-posture', 'finding-management'),
    ]);
    const jobs: { readonly source: Source; readonly run: () => Promise<Group> }[] = [];
    const group = (source: Source, items: readonly Result[]): Group => ({ source, items: items.slice(0, 5), hasMore: items.length > 5 });
    if (permissions[0]) jobs.push({ source: 'INDICATOR', run: async () => {
      const rows = await this.prisma.indicator.findMany({ where: { tenantId, OR: [
        { value: { contains: q, mode: 'insensitive' } }, { source: { contains: q, mode: 'insensitive' } },
        { tags: { has: q.toLowerCase() } },
      ] }, select: { id: true, value: true, type: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 6 });
      return group('INDICATOR', rows.map(row => ({ id: row.id, title: row.value, subtitle: row.type, route: '/indicators' })));
    } });
    if (permissions[1]) jobs.push({ source: 'ASSET', run: async () => {
      const rows = await this.prisma.asset.findMany({ where: { tenantId, OR: [
        { name: { contains: q, mode: 'insensitive' } }, { value: { contains: q, mode: 'insensitive' } },
      ] }, select: { id: true, name: true, value: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 6 });
      return group('ASSET', rows.map(row => ({ id: row.id, title: row.name, subtitle: row.value, route: `/attack-surface/assets?assetId=${encodeURIComponent(row.id)}${user.role === 'SUPER_ADMIN' ? `&tenantId=${encodeURIComponent(tenantId)}` : ''}` })));
    } });
    if (permissions[2]) jobs.push({ source: 'CASE', run: async () => {
      const rows = await this.prisma.case.findMany({ where: { tenantId, OR: [
        { title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } },
        { caseNumber: { contains: q, mode: 'insensitive' } },
      ] }, select: { id: true, title: true, caseNumber: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 6 });
      return group('CASE', rows.map(row => ({ id: row.id, title: row.title, subtitle: row.caseNumber, route: `/cases/${encodeURIComponent(row.id)}${user.role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}` })));
    } });
    if (permissions[3]) jobs.push({ source: 'APPLICATION', run: async () => {
      const rows = await this.prisma.application.findMany({ where: { tenantId, name: { contains: q, mode: 'insensitive' } }, select: { id: true, name: true, criticality: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 6 });
      return group('APPLICATION', rows.map(row => ({ id: row.id, title: row.name, subtitle: row.criticality, route: `/appsec/applications/${encodeURIComponent(row.id)}${user.role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}` })));
    } });
    if (permissions[4]) jobs.push({ source: 'APPSEC_FINDING', run: async () => {
      const rows = await this.prisma.appSecFinding.findMany({ where: { tenantId, title: { contains: q, mode: 'insensitive' } }, select: { id: true, title: true, severity: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 6 });
      return group('APPSEC_FINDING', rows.map(row => ({ id: row.id, title: row.title, subtitle: row.severity, route: `/appsec/findings/${encodeURIComponent(row.id)}${user.role === 'SUPER_ADMIN' ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}` })));
    } });
    const settled = await Promise.allSettled(jobs.map(job => job.run()));
    return { query: q, tenantId, groups: settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
      partialFailures: settled.flatMap((result, index) => result.status === 'rejected' ? [jobs[index].source] : []) };
  }

}
