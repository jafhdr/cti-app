import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthUser, UserRole } from './users.types';

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

  private async manageableTarget(currentUser: AuthUser, userId: string) {
    if (currentUser.sub === userId) throw new BadRequestException('Anda tidak dapat mengelola akun sendiri dari menu ini');
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('User tidak ditemukan');
    if (target.role === 'SUPER_ADMIN') throw new ForbiddenException('Akun SUPER_ADMIN tidak dapat dikelola melalui menu ini');
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
