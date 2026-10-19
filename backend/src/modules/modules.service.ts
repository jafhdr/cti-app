import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleCategory, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { type AuthUser } from '../users/users.types';
import { ModuleAccessService } from '../auth/module-access.service';
import { type CreateModuleInput, type UpdateModuleInput, type UpdateTenantModuleInput } from './modules.types';
import { isSystemModule } from './system-modules';

const configurableRoles = [Role.ADMIN, Role.USER] as const;
type ConfigurableRole = (typeof configurableRoles)[number];

@Injectable()
export class ModulesService {
  constructor(private readonly prisma: PrismaService, private readonly moduleAccess: ModuleAccessService) {}

  async listAvailable(user: AuthUser) {
    const modules = await this.prisma.appModule.findMany({
      where: { isActive: true },
      include: { features: { orderBy: { name: 'asc' } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    const access = await Promise.all(modules.map((module) => this.moduleAccess.evaluate(user, module.slug)));
    return modules.map((module, index) => ({ ...module, source: isSystemModule(module.slug) ? 'SYSTEM' : 'CUSTOM', accessible: access[index].accessible }));
  }

  async listConfiguration(user: AuthUser, requestedTenantId?: string) {
    const tenantId = this.resolveTenant(user, requestedTenantId);
    const modules = await this.moduleAccess.listTenantPolicies(tenantId);
    return modules.map(module => ({ ...module, source: isSystemModule(module.slug) ? 'SYSTEM' : 'CUSTOM', access: module.roleAccess }));
  }

  async create(user: AuthUser, input: CreateModuleInput) {
    this.requireSuperAdmin(user);
    const data = this.createModuleData(input);
    if (isSystemModule(data.slug)) throw new ConflictException('Slug modul sistem tidak dapat digunakan');
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
    const existing = await this.findModule(moduleId);
    if (isSystemModule(existing.slug) && (input.name !== undefined || input.slug !== undefined || input.description !== undefined || input.category !== undefined)) {
      throw new ForbiddenException('Identitas modul sistem tidak dapat diedit');
    }
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

  async remove(user: AuthUser, moduleId: string) {
    this.requireSuperAdmin(user);
    const module = await this.findModule(moduleId);
    if (isSystemModule(module.slug)) throw new ForbiddenException('Modul sistem tidak dapat dihapus');
    await this.prisma.appModule.delete({ where: { id: moduleId } });
    await this.audit(user, null, 'MODULE_DELETED', { moduleId, slug: module.slug });
    return { id: moduleId, slug: module.slug };
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
    if (slug) throw new BadRequestException('Slug modul adalah identitas permanen');
    return { ...(name ? { name } : {}), ...(description ? { description } : {}), ...(input.category ? { category: input.category } : {}), ...(input.isActive === undefined ? {} : { isActive: input.isActive }) };
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
    if (requestedTenantId && requestedTenantId !== user.tenantId) throw new ForbiddenException('Anda hanya dapat mengakses konfigurasi tenant sendiri');
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
