import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthUser, BulkModuleAccessInput, ModuleAccessInput, UserRole } from './users.types';

type CreateUserInput = { name: string; email: string; password: string; role: UserRole; tenantId?: string };
type UpdateUserInput = { name: string; email: string };

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly publicUser = {
    id: true, name: true, email: true, role: true, isActive: true,
    deactivatedAt: true, tenantId: true, createdAt: true, updatedAt: true,
    tenant: { select: { id: true, name: true, slug: true } },
  } as const;

  async findAll(currentUser: AuthUser, requestedTenantId?: string) {
    if (requestedTenantId && currentUser.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('ADMIN hanya dapat melihat tenant sendiri');
    }
    return this.prisma.user.findMany({
      where: currentUser.role === 'SUPER_ADMIN'
        ? (requestedTenantId ? { tenantId: requestedTenantId } : {})
        : { tenantId: this.tenantId(currentUser) },
      select: this.publicUser,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findTenants() {
    return this.prisma.tenant.findMany({
      select: { id: true, name: true, slug: true, createdAt: true, _count: { select: { users: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(currentUser: AuthUser, data: CreateUserInput) {
    const name = data.name?.trim();
    const email = data.email?.toLowerCase().trim();
    if (!name || !email || !data.password) throw new BadRequestException('Nama, email, dan password wajib diisi');
    if (data.password.length < 8) throw new BadRequestException('Password minimal 8 karakter');
    if (data.role === 'SUPER_ADMIN') throw new ForbiddenException('SUPER_ADMIN hanya dapat dibuat melalui prosedur khusus');
    if (currentUser.role === 'ADMIN' && data.role !== 'USER') throw new ForbiddenException('ADMIN hanya dapat membuat USER');

    const tenantId = currentUser.role === 'SUPER_ADMIN' ? data.tenantId : this.tenantId(currentUser);
    if (!tenantId) throw new BadRequestException('Tenant wajib ditentukan');
    const [existing, tenant] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
    ]);
    if (existing) throw new ConflictException('Email sudah digunakan');
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');

    const user = await this.prisma.user.create({
      data: { name, email, passwordHash: await bcrypt.hash(data.password, 12), role: data.role, tenantId },
      select: this.publicUser,
    });
    await this.audit(currentUser, tenantId, 'USER_CREATED', { targetUserId: user.id, targetUserRole: user.role });
    return user;
  }

  async updateProfile(currentUser: AuthUser, userId: string, data: UpdateUserInput) {
    const target = await this.manageableTarget(currentUser, userId);
    const name = data.name?.trim();
    const email = data.email?.toLowerCase().trim();
    if (!name || !email) throw new BadRequestException('Nama dan email wajib diisi');
    if (email !== target.email && await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Email sudah digunakan');
    }
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { name, email }, select: this.publicUser });
    await this.audit(currentUser, target.tenantId, 'USER_UPDATED', { targetUserId: userId, changed: ['name', 'email'] });
    return updated;
  }

  async updateRole(currentUser: AuthUser, userId: string, role: UserRole) {
    if (role === 'SUPER_ADMIN') throw new ForbiddenException('Role SUPER_ADMIN tidak dapat diberikan melalui User Management');
    const target = await this.manageableTarget(currentUser, userId);
    if (currentUser.role === 'ADMIN' && role !== 'USER') throw new ForbiddenException('ADMIN hanya dapat memberikan role USER');
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { role }, select: this.publicUser });
    await this.audit(currentUser, target.tenantId, 'USER_ROLE_UPDATED', { targetUserId: userId, oldRole: target.role, newRole: role });
    return updated;
  }

  async resetPassword(currentUser: AuthUser, userId: string, password: string) {
    if (!password || password.length < 8) throw new BadRequestException('Password minimal 8 karakter');
    const target = await this.manageableTarget(currentUser, userId);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, 12) } });
    await this.audit(currentUser, target.tenantId, 'USER_PASSWORD_RESET_BY_ADMIN', { targetUserId: userId });
    return { message: 'Password pengguna berhasil direset' };
  }

  async updateStatus(currentUser: AuthUser, userId: string, isActive: boolean) {
    const target = await this.manageableTarget(currentUser, userId);
    if (target.isActive === isActive) return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: this.publicUser });
    const updated = await this.prisma.user.update({
      where: { id: userId }, data: { isActive, deactivatedAt: isActive ? null : new Date() }, select: this.publicUser,
    });
    await this.audit(currentUser, target.tenantId, isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', { targetUserId: userId });
    return updated;
  }

  async getModuleAccess(currentUser: AuthUser, userId: string) {
    const target = await this.assignmentTarget(currentUser, userId);
    const [modules, assignments] = await Promise.all([
      this.prisma.appModule.findMany({ where: { isActive: true }, include: { features: true }, orderBy: { name: 'asc' } }),
      this.prisma.userModuleAccess.findMany({ where: { userId, tenantId: target.tenantId }, select: { moduleId: true, featureKeys: true } }),
    ]);
    return modules.map((module) => ({
      ...module,
      assigned: assignments.some((entry) => entry.moduleId === module.id),
      featureKeys: assignments.find((entry) => entry.moduleId === module.id)?.featureKeys ?? [],
    }));
  }

  async updateModuleAccess(currentUser: AuthUser, userId: string, access: readonly ModuleAccessInput[]) {
    const target = await this.assignmentTarget(currentUser, userId);
    if (!Array.isArray(access)) throw new BadRequestException('Daftar akses modul wajib berupa array');
    const uniqueModuleIds = [...new Set(access.map((entry) => entry.moduleId))];
    if (uniqueModuleIds.length !== access.length || access.some((entry) => !entry.moduleId)) throw new BadRequestException('Assignment modul tidak valid atau duplikat');
    const available = await this.prisma.appModule.findMany({ where: { isActive: true }, include: { features: true } });
    const availableById = new Map(available.map((module) => [module.id, module]));
    for (const entry of access) {
      const module = availableById.get(entry.moduleId);
      if (!module) throw new BadRequestException('Modul assignment tidak termasuk subscription tenant');
      const allowedFeatureKeys = new Set(module.features.map((feature) => feature.key));
      const featureKeys: readonly string[] = entry.featureKeys ?? [];
      if (featureKeys.some((key: string) => !allowedFeatureKeys.has(key))) throw new BadRequestException('Fitur assignment tidak valid');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.userModuleAccess.deleteMany({ where: { userId, tenantId: target.tenantId } });
      if (access.length > 0) await tx.userModuleAccess.createMany({
        data: access.map((entry): Prisma.UserModuleAccessCreateManyInput => ({ userId, tenantId: target.tenantId, moduleId: entry.moduleId, featureKeys: Array.from(new Set<string>(entry.featureKeys ?? [])) })),
      });
    });
    await this.audit(currentUser, target.tenantId, 'USER_MODULE_ACCESS_REPLACED', { targetUserId: userId, moduleIds: uniqueModuleIds });
    return this.getModuleAccess(currentUser, userId);
  }

  async listTenantUserModuleAccess(currentUser: AuthUser, requestedTenantId: string) {
    const tenantId = await this.accessTenant(currentUser, requestedTenantId);
    const [tenant, modules, users] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true, name: true, slug: true } }),
      this.prisma.appModule.findMany({ where: { isActive: true }, include: { features: true }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({
        where: { tenantId, role: { not: 'SUPER_ADMIN' } },
        select: {
          id: true, name: true, email: true, role: true, isActive: true,
          moduleAccess: { where: { tenantId }, select: { moduleId: true, featureKeys: true } },
        },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      }),
    ]);
    return { tenant, modules, users };
  }

  async listModuleUserAccess(currentUser: AuthUser, moduleId: string, requestedTenantId?: string) {
    const tenantId = await this.accessTenant(currentUser, requestedTenantId);
    const [tenant, module] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true, name: true, slug: true } }),
      this.prisma.appModule.findUnique({ where: { id: moduleId }, select: { id: true, slug: true, name: true, description: true, features: true } }),
    ]);
    if (!module) throw new NotFoundException('Modul tidak ditemukan');
    const users = await this.prisma.userModuleAccess.findMany({
      where: { tenantId, moduleId, user: { role: { not: 'SUPER_ADMIN' } } },
      select: { featureKeys: true, user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return { tenant, module, users: users.map((entry) => ({ ...entry.user, featureKeys: entry.featureKeys })) };
  }

  async bulkUpdateModuleAccess(currentUser: AuthUser, requestedTenantId: string, payload: BulkModuleAccessInput) {
    const tenantId = await this.accessTenant(currentUser, requestedTenantId);
    if (!Array.isArray(payload.assignments) || payload.assignments.length === 0) throw new BadRequestException('Pilih minimal satu user untuk bulk update');
    const userIds = payload.assignments.map((entry) => entry.userId);
    if (new Set(userIds).size !== userIds.length) throw new BadRequestException('User bulk update tidak boleh duplikat');
    const targets = await Promise.all(userIds.map((userId) => this.assignmentTarget(currentUser, userId)));
    if (targets.some((target) => target.tenantId !== tenantId)) throw new ForbiddenException('Semua user bulk update harus berasal dari tenant yang dipilih');
    const available = await this.prisma.appModule.findMany({ where: { isActive: true }, include: { features: true } });
    const createData = payload.assignments.flatMap((assignment) => this.validatedAccessData(assignment.userId, tenantId, assignment.access, available));
    await this.prisma.$transaction(async (tx) => {
      await tx.userModuleAccess.deleteMany({ where: { tenantId, userId: { in: userIds } } });
      if (createData.length > 0) await tx.userModuleAccess.createMany({ data: createData });
    });
    await this.audit(currentUser, tenantId, 'USER_MODULE_ACCESS_BULK_REPLACED', { userIds, assignmentCount: createData.length });
    return this.listTenantUserModuleAccess(currentUser, tenantId);
  }

  private async assignmentTarget(currentUser: AuthUser, userId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, tenantId: true } });
    if (!target) throw new NotFoundException('User tidak ditemukan');
    if (!target.tenantId) throw new BadRequestException('User tidak memiliki tenant');
    if (target.role === 'SUPER_ADMIN') throw new ForbiddenException('SUPER_ADMIN selalu memiliki akses ke semua modul');
    if (currentUser.role === 'SUPER_ADMIN') return { ...target, tenantId: target.tenantId };
    if (currentUser.role === 'ADMIN') {
      if (target.tenantId !== this.tenantId(currentUser)) throw new ForbiddenException('Anda hanya dapat mengatur akses modul untuk user dalam tenant sendiri');
    }
    return { ...target, tenantId: target.tenantId };
  }

  private async accessTenant(currentUser: AuthUser, requestedTenantId?: string) {
    if (currentUser.role === 'SUPER_ADMIN') {
      const tenantId = requestedTenantId ?? this.tenantId(currentUser);
      if (!tenantId) throw new BadRequestException('Tenant wajib dipilih oleh SUPER_ADMIN');
      const exists = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Tenant tidak ditemukan');
      return tenantId;
    }
    const tenantId = this.tenantId(currentUser);
    if (!tenantId) throw new BadRequestException('Tenant wajib dipilih');
    if (requestedTenantId && requestedTenantId !== tenantId) throw new ForbiddenException('ADMIN hanya dapat mengakses tenant sendiri');
    const exists = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Tenant tidak ditemukan');
    return tenantId;
  }

  private validatedAccessData(userId: string, tenantId: string, access: readonly ModuleAccessInput[], available: Awaited<ReturnType<UsersService['subscribedModules']>>) {
    if (!Array.isArray(access)) throw new BadRequestException('Daftar akses modul wajib berupa array');
    const availableById = new Map(available.map((module) => [module.id, module]));
    const moduleIds = access.map((entry) => entry.moduleId);
    if (new Set(moduleIds).size !== moduleIds.length) throw new BadRequestException('Assignment modul tidak valid atau duplikat');
    return access.map((entry): Prisma.UserModuleAccessCreateManyInput => {
      const module = availableById.get(entry.moduleId);
      if (!module) throw new BadRequestException('Modul assignment tidak termasuk subscription tenant');
      const validKeys = new Set(module.features.map((feature) => feature.key));
      const featureKeys = Array.from(new Set<string>(entry.featureKeys ?? []));
      if (featureKeys.some((key) => !validKeys.has(key))) throw new BadRequestException('Fitur assignment tidak valid');
      return { userId, tenantId, moduleId: entry.moduleId, featureKeys };
    });
  }

  private async listAllActiveModules(tenantId: string) {
    const [modules, subscriptions] = await Promise.all([
      this.prisma.appModule.findMany({ where: { isActive: true }, include: { features: true }, orderBy: { name: 'asc' } }),
      this.prisma.tenantSubscription.findFirst({ where: { tenantId }, include: { package: { include: { modules: { include: { module: true } } } }, customModules: { include: { module: true } } } }),
    ]);
    const availableIds = new Set<string>();
    for (const module of modules) availableIds.add(module.id);
    if (subscriptions) {
      for (const m of subscriptions.package?.modules ?? []) availableIds.add(m.moduleId);
      for (const m of subscriptions.customModules ?? []) availableIds.add(m.moduleId);
    }
    return modules.filter(m => availableIds.has(m.id));
  }

  private async subscribedModules(tenantId: string) {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] }, renewalAt: { gt: new Date() } },
      include: {
        package: { include: { modules: { include: { module: { include: { features: true } } } } } },
        customModules: { include: { module: { include: { features: true } } } },
      },
    });
    if (!subscription) return [];
    return subscription.isCustom
      ? subscription.customModules.map(({ module }) => module)
      : (subscription.package?.modules.map(({ module }) => module) ?? []);
  }

  private async manageableTarget(currentUser: AuthUser, userId: string) {
    if (currentUser.sub === userId) throw new BadRequestException('Anda tidak dapat mengelola akun sendiri dari menu ini');
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('User tidak ditemukan');
    if (target.role === 'SUPER_ADMIN' && currentUser.role !== 'SUPER_ADMIN') throw new ForbiddenException('Hanya Super Admin yang dapat mengelola akun Super Admin lain');
    if (currentUser.role === 'SUPER_ADMIN') return target;
    if (currentUser.role === 'ADMIN') {
      if (target.tenantId !== this.tenantId(currentUser)) throw new ForbiddenException('Anda hanya dapat mengelola user dalam tenant sendiri');
      if (target.role === 'ADMIN') throw new ForbiddenException('ADMIN tidak dapat mengelola ADMIN lain');
    }
    return target;
  }

  private tenantId(currentUser: AuthUser) {
    if (!currentUser.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');
    return currentUser.tenantId;
  }

  private audit(actor: AuthUser, tenantId: string | null, action: string, metadata: Record<string, unknown>) {
    return this.prisma.auditLog.create({
      data: { userId: actor.sub, tenantId, action, metadata: metadata as Prisma.InputJsonValue },
    });
  }
}
