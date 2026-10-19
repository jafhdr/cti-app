import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { AppSecTenantContext } from './tenant-context';
import { ListAvailableAssetsDto } from './appsec.dto';

@Injectable()
export class ApplicationAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: AppSecTenantContext,
    private readonly access: ModuleAccessService,
  ) {}

  private async workspace(user: AuthUser, applicationId: string, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    const application = await this.prisma.application.findFirst({ where: { id: applicationId, tenantId }, select: { id: true } });
    if (!application) throw new NotFoundException('Application tidak ditemukan');
    const asm = await this.access.evaluateForTenant(user, tenantId, 'attack-surface-management', ['asset-management']);
    if (!asm.accessible) throw new ForbiddenException('Akses ASM asset-management diperlukan');
    return tenantId;
  }

  async list(user: AuthUser, applicationId: string, requested?: string) {
    const tenantId = await this.workspace(user, applicationId, requested);
    const links = await this.prisma.applicationAsset.findMany({
      where: { tenantId, applicationId }, include: { asset: { select: { id: true, name: true, value: true, type: true, status: true, criticality: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return links.map(link => ({ ...link.asset, linkedAt: link.createdAt }));
  }

  async available(user: AuthUser, applicationId: string, query: ListAvailableAssetsDto) {
    const tenantId = await this.workspace(user, applicationId, query.tenantId);
    const search = query.search?.trim();
    const where: Prisma.AssetWhereInput = {
      tenantId, applications: { none: { applicationId } },
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { value: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({ where, select: { id: true, name: true, value: true, type: true, status: true, criticality: true }, orderBy: { name: 'asc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.asset.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async link(user: AuthUser, applicationId: string, assetId: string, requested?: string) {
    const tenantId = await this.workspace(user, applicationId, requested);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true } });
    if (!asset) throw new NotFoundException('Asset tidak ditemukan');
    try {
      return await this.prisma.$transaction(async tx => {
        const link = await tx.applicationAsset.create({ data: { tenantId, applicationId, assetId } });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'APPSEC_APPLICATION_ASSET_LINKED', metadata: { applicationId, assetId } } });
        return link;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Asset sudah terhubung');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new NotFoundException('Application atau Asset tidak ditemukan');
      throw error;
    }
  }

  async unlink(user: AuthUser, applicationId: string, assetId: string, requested?: string) {
    const tenantId = await this.workspace(user, applicationId, requested);
    return this.prisma.$transaction(async tx => {
      const deleted = await tx.applicationAsset.deleteMany({ where: { tenantId, applicationId, assetId } });
      if (deleted.count === 0) throw new NotFoundException('Relasi Asset tidak ditemukan');
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'APPSEC_APPLICATION_ASSET_UNLINKED', metadata: { applicationId, assetId } } });
      return { unlinked: true, applicationId, assetId };
    });
  }
}
