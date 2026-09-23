import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleCategory, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { type AuthUser } from '../users/users.types';
import { type CreateModuleInput, type UpdateModuleInput, type UpdateTenantModuleInput } from './modules.types';

const configurableRoles = [Role.ADMIN, Role.USER] as const;
type ConfigurableRole = (typeof configurableRoles)[number];

@Injectable()
export class ModulesService {
  constructor(private readonly prisma: PrismaService) {}

  async listAvailable(user: AuthUser) {
    if (user.role === 'SUPER_ADMIN') {
      const modules = await this.prisma.appModule.findMany({
        where: { isActive: true },
        include: { features: { orderBy: { name: 'asc' } } },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      });
      return modules.map((module) => ({ ...module, accessible: true }));
    }
    const modules = await this.prisma.appModule.findMany({
      where: { isActive: true },
      include: {
        features: { orderBy: { name: 'asc' } },
        settings: { where: { tenantId: this.tenantId(user), isEnabled: true }, include: { access: { where: { role: user.role } } } },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return modules
      .filter((module) => module.settings.some((setting) => setting.access[0]?.isAllowed))
      .map((module) => ({ id: module.id, slug: module.slug, name: module.name, description: module.description, category: module.category, isActive: module.isActive, features: module.features, accessible: true }));
  }

  async listConfiguration(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const modules = await this.prisma.appModule.findMany({
      include: {
        features: { orderBy: { name: 'asc' } },
        settings: {
          where: { tenantId },
          include: { access: { where: { role: { in: [...configurableRoles] } } } },
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return modules.map((module) => {
      const setting = module.settings[0];
      return {
        id: module.id,
        slug: module.slug,
        name: module.name,
        description: module.description,
        category: module.category,
        isActive: module.isActive,
        features: module.features,
        tenantEnabled: setting?.isEnabled ?? false,
        access: {
          ADMIN: setting?.access.find((entry) => entry.role === Role.ADMIN)?.isAllowed ?? false,
          USER: setting?.access.find((entry) => entry.role === Role.USER)?.isAllowed ?? false,
        },
      };
    });
  }

  async create(user: AuthUser, input: CreateModuleInput) {
    this.requireSuperAdmin(user);
    const data = this.createModuleData(input);
    try {
      const module = await this.prisma.appModule.create({ data });
      await this.audit(user, null, 'MODULE_CREATED', { moduleId: module.id, slug: module.slug });
      return module;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Slug modul sudah digunakan');
      throw error;
    }
  }

  async update(user: AuthUser, moduleId: string, input: UpdateModuleInput) {
    this.requireSuperAdmin(user);
    await this.findModule(moduleId);
    const data = this.updateModuleData(input);
    if (Object.keys(data).length === 0) throw new BadRequestException('Tidak ada perubahan modul');
    try {
      const module = await this.prisma.appModule.update({ where: { id: moduleId }, data });
      await this.audit(user, null, 'MODULE_UPDATED', { moduleId, changed: Object.keys(data) });
      return module;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Slug modul sudah digunakan');
      throw error;
    }
  }

  async updateTenantAccess(user: AuthUser, moduleId: string, input: UpdateTenantModuleInput) {
    const module = await this.findModule(moduleId);
    const tenantId = this.resolveTenant(user, input.tenantId);
    if (input.isEnabled === undefined && !input.access) throw new BadRequestException('Status modul atau akses role wajib diisi');
    if (user.role === 'ADMIN' && input.access?.ADMIN !== undefined) throw new ForbiddenException('ADMIN tidak dapat mengubah akses role ADMIN');

    await this.prisma.$transaction(async (transaction) => {
      const setting = await transaction.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId, moduleId } },
        create: { tenantId, moduleId, isEnabled: input.isEnabled ?? true },
        update: input.isEnabled === undefined ? {} : { isEnabled: input.isEnabled },
      });
      const roleUpdates = configurableRoles
        .filter((role): role is ConfigurableRole => input.access?.[role] !== undefined)
        .map((role) => transaction.moduleRoleAccess.upsert({
          where: { tenantModuleId_role: { tenantModuleId: setting.id, role } },
          create: { tenantModuleId: setting.id, role, isAllowed: input.access?.[role] ?? false },
          update: { isAllowed: input.access?.[role] ?? false },
        }));
      await Promise.all(roleUpdates);
      await transaction.auditLog.create({
        data: {
          userId: user.sub,
          tenantId,
          action: 'MODULE_TENANT_ACCESS_UPDATED',
          metadata: { moduleId: module.id, isEnabled: input.isEnabled ?? null, access: input.access ?? {} },
        },
      });
    });
    return this.listConfiguration(user, tenantId);
  }

  private createModuleData(input: CreateModuleInput): Prisma.AppModuleCreateInput {
    const name = input.name?.trim();
    const slug = input.slug?.trim().toLowerCase();
    const description = input.description?.trim();
    if (!name || !slug || !description || !this.isCategory(input.category)) throw new BadRequestException('Nama, slug, deskripsi, dan kategori wajib valid');
    if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new BadRequestException('Slug hanya boleh huruf kecil, angka, dan tanda hubung');
    return { name, slug, description, category: input.category, ...(input.isActive === undefined ? {} : { isActive: input.isActive }) };
  }

  private updateModuleData(input: UpdateModuleInput): Prisma.AppModuleUpdateInput {
    const name = input.name?.trim();
    const slug = input.slug?.trim().toLowerCase();
    const description = input.description?.trim();
    if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new BadRequestException('Slug hanya boleh huruf kecil, angka, dan tanda hubung');
    if (input.category && !this.isCategory(input.category)) throw new BadRequestException('Kategori modul tidak valid');
    return { ...(name ? { name } : {}), ...(slug ? { slug } : {}), ...(description ? { description } : {}), ...(input.category ? { category: input.category } : {}), ...(input.isActive === undefined ? {} : { isActive: input.isActive }) };
  }

  private async findModule(id: string) {
    const module = await this.prisma.appModule.findUnique({ where: { id } });
    if (!module) throw new NotFoundException('Modul tidak ditemukan');
    return module;
  }

  private resolveTenant(user: AuthUser, requestedTenantId?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!requestedTenantId) throw new BadRequestException('Tenant wajib dipilih');
      return requestedTenantId;
    }
    return this.tenantId(user);
  }

  private tenantId(user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return user.tenantId;
  }

  private requireSuperAdmin(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Hanya SUPER_ADMIN yang dapat mengelola katalog modul');
  }

  private isCategory(value?: string): value is ModuleCategory { return Object.values(ModuleCategory).includes(value as ModuleCategory); }

  private audit(actor: AuthUser, tenantId: string | null, action: string, metadata: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action, metadata: metadata as Prisma.InputJsonValue } });
  }
}
