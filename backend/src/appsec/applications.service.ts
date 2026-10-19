import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ModuleAccessService } from '../auth/module-access.service';
import type { AuthUser } from '../users/users.types';
import { AppSecTenantContext } from './tenant-context';
import { CreateApplicationDto, ListApplicationsDto, UpdateApplicationDto } from './appsec.dto';

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService, private readonly context: AppSecTenantContext, private readonly access: ModuleAccessService) {}

  async list(user: AuthUser, query: ListApplicationsDto) {
    const tenantId = await this.context.resolve(user, query.tenantId);
    const search = query.search?.trim();
    const where: Prisma.ApplicationWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.criticality ? { criticality: query.criticality } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
    const asm = await this.access.evaluateForTenant(user, tenantId, 'attack-surface-management', ['asset-management']);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({ where, include: { _count: { select: { assets: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.application.count({ where }),
    ]);
    return { items: items.map(({ _count, ...application }) => ({ ...application, linkedAssetCount: asm.accessible ? _count.assets : null })), total, page: query.page, limit: query.limit };
  }

  async get(user: AuthUser, id: string, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    const application = await this.prisma.application.findFirst({ where: { id, tenantId } });
    if (!application) throw new NotFoundException('Application tidak ditemukan');
    return application;
  }

  async create(user: AuthUser, input: CreateApplicationDto, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Nama wajib');
    try {
      return await this.prisma.$transaction(async tx => {
        const created = await tx.application.create({ data: {
          tenantId, name, description: input.description?.trim() || null,
          criticality: input.criticality, owner: input.owner?.trim() || null,
          repositoryUrl: input.repositoryUrl || null,
        } });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'APPSEC_APPLICATION_CREATED', metadata: { applicationId: created.id } } });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Nama application sudah digunakan');
      throw error;
    }
  }

  async update(user: AuthUser, id: string, input: UpdateApplicationDto, requested?: string) {
    const tenantId = await this.context.resolve(user, requested);
    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new BadRequestException('Nama wajib');
    try {
      return await this.prisma.$transaction(async tx => {
        const existing = await tx.application.findFirst({ where: { id, tenantId } });
        if (!existing) throw new NotFoundException('Application tidak ditemukan');
        const updated = await tx.application.update({ where: { id, tenantId }, data: {
          ...(name !== undefined ? { name } : {}),
          ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
          ...(input.criticality !== undefined ? { criticality: input.criticality } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.owner !== undefined ? { owner: input.owner.trim() || null } : {}),
          ...(input.repositoryUrl !== undefined ? { repositoryUrl: input.repositoryUrl || null } : {}),
        } });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'APPSEC_APPLICATION_UPDATED', metadata: { applicationId: id } } });
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Nama application sudah digunakan');
      throw error;
    }
  }
}
