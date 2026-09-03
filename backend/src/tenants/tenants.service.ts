import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../users/users.types';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.tenant.findMany({
      select: {
        id: true, name: true, slug: true, isActive: true, deactivatedAt: true, createdAt: true,
        _count: { select: { users: true, indicators: true } },
      }, orderBy: { createdAt: 'desc' },
    });
  }

  async create(actor: AuthUser, input: { name: string; slug: string; adminName: string; adminEmail: string; adminPassword: string }) {
    const name = input.name?.trim();
    const slug = input.slug?.trim().toLowerCase();
    const adminName = input.adminName?.trim();
    const adminEmail = input.adminEmail?.trim().toLowerCase();
    if (!name || !slug || !/^[a-z0-9-]+$/.test(slug)) throw new BadRequestException('Nama dan slug tenant (huruf kecil, angka, tanda hubung) wajib valid');
    if (!adminName || !adminEmail || !input.adminPassword || input.adminPassword.length < 8) throw new BadRequestException('Data ADMIN tenant wajib lengkap; password minimal 8 karakter');
    const existing = await this.prisma.user.findUnique({ where: { email: adminEmail } });
    if (existing) throw new ConflictException('Email ADMIN sudah digunakan');
    try {
      const result = await this.prisma.$transaction(async tx => {
        const tenant = await tx.tenant.create({ data: { name, slug } });
        const admin = await tx.user.create({
          data: { name: adminName, email: adminEmail, passwordHash: await bcrypt.hash(input.adminPassword, 12), role: Role.ADMIN, tenantId: tenant.id },
          select: { id: true, name: true, email: true, role: true },
        });
        // Otomatis berikan subscription Community untuk tenant baru
        const communityPackage = await tx.subscriptionPackage.findFirst({ where: { type: 'PREDEFINED', isActive: true }, orderBy: { priceMonthly: 'asc' }, take: 1 });
        if (communityPackage) {
          const renewalAt = new Date();
          renewalAt.setFullYear(renewalAt.getFullYear() + 1);
          await tx.tenantSubscription.create({
            data: {
              tenantId: tenant.id,
              packageId: communityPackage.id,
              billingCycle: 'YEARLY',
              priceMonthly: communityPackage.priceMonthly,
              priceYearly: communityPackage.priceYearly ?? communityPackage.priceMonthly,
              status: 'ACTIVE',
              renewalAt,
            },
          });
          // Aktifkan semua modul yang ada di package untuk tenant baru
          const packageModules = await tx.subscriptionPackage.findUnique({ where: { id: communityPackage.id }, include: { modules: { include: { module: true } } } });
          if (packageModules) {
            for (const pm of packageModules.modules) {
              if (!pm.module) continue;
              const setting = await tx.tenantModule.upsert({
                where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: pm.module.id } },
                update: {},
                create: { tenantId: tenant.id, moduleId: pm.module.id, isEnabled: true },
              });
              for (const role of [Role.ADMIN, Role.USER] as const) {
                await tx.moduleRoleAccess.upsert({
                  where: { tenantModuleId_role: { tenantModuleId: setting.id, role } },
                  update: {},
                  create: { tenantModuleId: setting.id, role, isAllowed: true },
                });
              }
            }
          }
        }
        await tx.auditLog.create({ data: { userId: actor.sub, tenantId: tenant.id, action: 'TENANT_CREATED', metadata: { tenantId: tenant.id, initialAdminId: admin.id } as Prisma.InputJsonValue } });
        return { tenant, admin };
      });
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Slug tenant sudah digunakan');
      throw error;
    }
  }

  async updateStatus(actor: AuthUser, tenantId: string, isActive: boolean) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');
    const updated = await this.prisma.tenant.update({ where: { id: tenantId }, data: { isActive, deactivatedAt: isActive ? null : new Date() } });
    await this.prisma.auditLog.create({ data: { userId: actor.sub, tenantId, action: isActive ? 'TENANT_ACTIVATED' : 'TENANT_DEACTIVATED', metadata: { tenantId } } });
    return updated;
  }
}
