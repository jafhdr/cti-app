import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { AppSecTenantContext } from './tenant-context';
import { ApplicationAssetsService } from './application-assets.service';
import { PageQueryDto } from './appsec.dto';

@Injectable()
export class FindingIntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: AppSecTenantContext,
    private readonly access: ModuleAccessService,
    private readonly assets: ApplicationAssetsService,
  ) {}

  private async finding(user: AuthUser, id: string, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    const finding = await this.prisma.appSecFinding.findFirst({ where: { id, tenantId }, select: { id: true, tenantId: true, applicationId: true } });
    if (!finding) throw new NotFoundException('Finding tidak ditemukan');
    return finding;
  }

  private async require(user: AuthUser, tenantId: string, slug: string, feature: string) {
    const result = await this.access.evaluateForTenant(user, tenantId, slug, [feature]);
    if (!result.accessible) throw new ForbiddenException(result.reason);
  }

  async exposure(user: AuthUser, id: string, requested?: string) {
    const finding = await this.finding(user, id, requested);
    return this.assets.list(user, finding.applicationId, requested);
  }

  async vulnerability(user: AuthUser, id: string, requested?: string) {
    const finding = await this.finding(user, id, requested);
    await this.require(user, finding.tenantId, 'threat-intelligence', 'intelligence-hub');
    const link = await this.prisma.appSecFindingVulnerability.findFirst({
      where: { findingId: id, tenantId: finding.tenantId },
      select: { vulnerability: { select: { id: true, cveId: true, name: true, severity: true, cvssScore: true, description: true } } },
    });
    return link?.vulnerability ?? null;
  }

  async available(user: AuthUser, id: string, query: PageQueryDto) {
    const finding = await this.finding(user, id, query.tenantId);
    await this.require(user, finding.tenantId, 'threat-intelligence', 'intelligence-hub');
    const search = query.search?.trim();
    const where: Prisma.VulnerabilityWhereInput = { tenantId: finding.tenantId,
      ...(search ? { OR: [{ cveId: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.vulnerability.findMany({ where, select: { id: true, cveId: true, name: true, severity: true, cvssScore: true, description: true }, orderBy: { cveId: 'asc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.vulnerability.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async link(user: AuthUser, id: string, vulnerabilityId: string, requested?: string) {
    const finding = await this.finding(user, id, requested);
    await this.require(user, finding.tenantId, 'threat-intelligence', 'intelligence-hub');
    const vulnerability = await this.prisma.vulnerability.findFirst({ where: { id: vulnerabilityId, tenantId: finding.tenantId }, select: { id: true } });
    if (!vulnerability) throw new NotFoundException('Vulnerability tidak ditemukan');
    try {
      return await this.prisma.$transaction(async tx => {
        const link = await tx.appSecFindingVulnerability.create({ data: { findingId: id, tenantId: finding.tenantId, vulnerabilityId } });
        await tx.auditLog.create({ data: { tenantId: finding.tenantId, userId: user.sub, action: 'APPSEC_FINDING_VULNERABILITY_LINKED', metadata: { findingId: id, applicationId: finding.applicationId, vulnerabilityId } } });
        return link;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Finding sudah memiliki Vulnerability');
      throw error;
    }
  }

  async unlink(user: AuthUser, id: string, requested?: string) {
    const finding = await this.finding(user, id, requested);
    await this.require(user, finding.tenantId, 'threat-intelligence', 'intelligence-hub');
    return this.prisma.$transaction(async tx => {
      const link = await tx.appSecFindingVulnerability.findFirst({ where: { findingId: id, tenantId: finding.tenantId } });
      if (!link) throw new NotFoundException('Relasi Vulnerability tidak ditemukan');
      await tx.appSecFindingVulnerability.delete({ where: { findingId: id } });
      await tx.auditLog.create({ data: { tenantId: finding.tenantId, userId: user.sub, action: 'APPSEC_FINDING_VULNERABILITY_UNLINKED', metadata: { findingId: id, applicationId: finding.applicationId, vulnerabilityId: link.vulnerabilityId } } });
      return { unlinked: true, findingId: id, vulnerabilityId: link.vulnerabilityId };
    });
  }
}
