import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import type { CreateStakeholderDto, ListStakeholdersQueryDto, UpdateStakeholderDto } from './stakeholders.dto';

@Injectable()
export class StakeholdersService {
  constructor(private readonly prisma: PrismaService) {}
  private tenant(user: AuthUser, requested?: string): string {
    if (user.role === 'SUPER_ADMIN') { if (!requested) throw new BadRequestException('Tenant wajib dipilih'); return requested; }
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }
  async list(user: AuthUser, query: ListStakeholdersQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.StakeholderWhereInput = { tenantId: this.tenant(user, query.tenantId), ...(query.category ? { category: query.category } : {}), ...(query.isActive === undefined ? {} : { isActive: query.isActive }), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { intelligenceInterests: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.stakeholder.findMany({ where, include: { responsibleUser: { select: { id: true, name: true, email: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }), this.prisma.stakeholder.count({ where })]);
    return { items, total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
  }
  async get(user: AuthUser, id: string, requested?: string) {
    const item = await this.prisma.stakeholder.findFirst({ where: { id, tenantId: this.tenant(user, requested) }, include: { responsibleUser: { select: { id: true, name: true, email: true } } } });
    if (!item) throw new NotFoundException('Stakeholder tidak ditemukan');
    return item;
  }
  async users(user: AuthUser, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const rows = await this.prisma.userModuleAccess.findMany({ where: { tenantId, user: { isActive: true }, module: { slug: 'threat-intelligence' }, featureKeys: { has: 'intelligence-hub' } }, select: { user: { select: { id: true, name: true, email: true, role: true } } } });
    return rows.map(row => row.user);
  }
  private async checkUser(tenantId: string, id?: string | null) {
    if (!id) return;
    const rows = await this.users({ sub: '', tenantId: null, role: 'SUPER_ADMIN' }, tenantId);
    if (!rows.some(row => row.id === id)) throw new BadRequestException('Penanggung jawab harus pengguna SICTI aktif pada tenant yang sama');
  }
  async create(user: AuthUser, input: CreateStakeholderDto, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Nama stakeholder wajib diisi');
    await this.checkUser(tenantId, input.responsibleUserId);
    return this.prisma.$transaction(async tx => {
      const item = await tx.stakeholder.create({ data: { tenantId, name, scope: input.scope, category: input.category, type: input.type, responsibleUserId: input.responsibleUserId || null, description: input.description?.trim() || null, intelligenceInterests: input.intelligenceInterests?.trim() || null, reportingFormat: input.reportingFormat?.trim() || null, reportingFrequency: input.reportingFrequency?.trim() || null, distributionChannel: input.distributionChannel?.trim() || null, classificationPreference: input.classificationPreference || null, createdById: user.sub, updatedById: user.sub } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'STAKEHOLDER_CREATED', metadata: { stakeholderId: item.id } } });
      return item;
    });
  }
  async update(user: AuthUser, id: string, input: UpdateStakeholderDto, requested?: string) {
    const existing = await this.get(user, id, requested);
    if (input.name !== undefined && !input.name.trim()) throw new BadRequestException('Nama stakeholder wajib diisi');
    if (input.responsibleUserId !== undefined) await this.checkUser(existing.tenantId, input.responsibleUserId);
    const data: Prisma.StakeholderUncheckedUpdateInput = { updatedById: user.sub };
    for (const key of ['description', 'intelligenceInterests', 'reportingFormat', 'reportingFrequency', 'distributionChannel'] as const) if (input[key] !== undefined) data[key] = input[key]?.trim() || null;
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.scope !== undefined) data.scope = input.scope;
    if (input.category !== undefined) data.category = input.category;
    if (input.type !== undefined) data.type = input.type;
    if (input.classificationPreference !== undefined) data.classificationPreference = input.classificationPreference;
    if (input.responsibleUserId !== undefined) data.responsibleUserId = input.responsibleUserId || null;
    return this.prisma.$transaction(async tx => {
      const item = await tx.stakeholder.update({ where: { id }, data });
      await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: 'STAKEHOLDER_UPDATED', metadata: { stakeholderId: id } } });
      return item;
    });
  }
  async setActive(user: AuthUser, id: string, isActive: boolean, requested?: string) {
    if (typeof isActive !== 'boolean') throw new BadRequestException('isActive harus boolean');
    const existing = await this.get(user, id, requested);
    return this.prisma.$transaction(async tx => {
      const item = await tx.stakeholder.update({ where: { id }, data: { isActive, updatedById: user.sub } });
      await tx.auditLog.create({ data: { tenantId: existing.tenantId, userId: user.sub, action: isActive ? 'STAKEHOLDER_ACTIVATED' : 'STAKEHOLDER_DEACTIVATED', metadata: { stakeholderId: id } } });
      return item;
    });
  }
}
