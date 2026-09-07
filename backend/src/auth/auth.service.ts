import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { tenant: true },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Email atau password salah');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Akun ini sudah dinonaktifkan');
    }

    return this.issueSession(user);
  }

  async signup(name: string, email: string, password: string, organization: string, organizationSlug: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const slug = organizationSlug.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new ConflictException('Email sudah terdaftar');

    const existingTenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existingTenant) throw new ConflictException('Slug organisasi sudah digunakan');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: organization.trim(), slug } });
      const createdUser = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
          role: 'ADMIN',
          tenantId: tenant.id,
        },
        include: { tenant: true },
      });
      // Berikan subscription Community untuk tenant baru
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
        // Aktifkan semua modul dalam package untuk tenant
        const packageModules = await tx.subscriptionPackage.findUnique({ where: { id: communityPackage.id }, include: { modules: { include: { module: true } } } });
        if (packageModules) {
          for (const pm of packageModules.modules) {
            if (!pm.module) continue;
            const setting = await tx.tenantModule.upsert({
              where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: pm.module.id } },
              update: {},
              create: { tenantId: tenant.id, moduleId: pm.module.id, isEnabled: true },
            });
            for (const role of ['ADMIN', 'USER'] as const) {
              await tx.moduleRoleAccess.upsert({
                where: { tenantModuleId_role: { tenantModuleId: setting.id, role } },
                update: {},
                create: { tenantModuleId: setting.id, role, isAllowed: true },
              });
            }
          }
        }
      }
      return createdUser;
    });

    await this.prisma.auditLog.create({ data: { userId: user.id, tenantId: user.tenantId, action: 'SIGNUP' } });
    return this.issueSession(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!user) return null;

    const modules = await this.prisma.appModule.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        userAccess: {
          where: { userId, tenantId: user.tenant?.id ?? '' },
          select: { featureKeys: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      ...user,
      moduleAccess: modules.map((module) => ({
        moduleId: module.id,
        moduleName: module.name,
        moduleSlug: module.slug,
        assigned: user.role === 'SUPER_ADMIN' || module.userAccess.length > 0,
        featureKeys: module.userAccess[0]?.featureKeys ?? [],
      })),
    };
  }

  async refresh(refreshToken: string) {
    try {
      if (!refreshToken) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      return this.jwt.signAsync(
        { sub: payload.sub, tenantId: payload.tenantId, role: payload.role },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
      );
    } catch {
      throw new UnauthorizedException('Refresh token tidak valid');
    }
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Always return the same response to avoid account enumeration.
    if (!user) return { message: 'Jika email terdaftar, instruksi reset password telah dibuat.' };

    await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.prisma.passwordResetToken.create({ data: { tokenHash, userId: user.id, expiresAt } });

    // MVP: without an email provider, expose the reset link in the server console only.
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${rawToken}`;
    console.log(`[DEV] Password reset link for ${normalizedEmail}: ${resetUrl}`);

    return { message: 'Jika email terdaftar, instruksi reset password telah dibuat.' };
  }

  async resetPassword(token: string, password: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const reset = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Token reset password tidak valid atau sudah kedaluwarsa');
    }

    const account = await this.prisma.user.findUnique({
      where: { id: reset.userId },
      select: { tenantId: true },
    });
    if (!account) throw new BadRequestException('Akun untuk token reset tidak ditemukan');

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: { userId: reset.userId, tenantId: account.tenantId, action: 'PASSWORD_RESET' },
      }),
    ]);

    return { message: 'Password berhasil diubah. Silakan login kembali.' };
  }

  private async issueSession(user: any) {
    const payload = { sub: user.id, tenantId: user.tenantId, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: '15m',
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    await this.prisma.auditLog.create({ data: { userId: user.id, tenantId: user.tenantId, action: 'LOGIN' } });
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenant: user.tenant,
      },
    };
  }
}
