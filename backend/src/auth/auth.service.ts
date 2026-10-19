import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ModuleAccessService } from './module-access.service';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID, createHash } from 'crypto';
import * as nodemailer from 'nodemailer';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const forgotResponse = { message: 'Jika email terdaftar, instruksi reset password telah dikirim.' };

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private moduleAccess: ModuleAccessService) {}

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
    if (user.role !== 'SUPER_ADMIN' && !user.tenantId) {
      throw new UnauthorizedException('Tenant akun ini tidak tersedia');
    }
    if (!user.tenantId) return this.issueSession(user);
    const tenantId = user.tenantId;

    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR SHARE`;
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { isActive: true } });
      if (!tenant?.isActive) throw new UnauthorizedException('Tenant akun ini sudah dinonaktifkan');
      return this.issueSession(user, tx);
    });
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

    const modules = (await this.moduleAccess.listForUser({ sub: user.id, tenantId: user.tenant?.id ?? null, role: user.role }))
      .filter(module => user.role !== 'SUPER_ADMIN' || module.isActive);
    return {
      ...user,
      moduleAccess: modules.map(module => ({
        moduleId: module.id, moduleName: module.name, moduleSlug: module.slug,
        assigned: module.assigned, accessible: module.accessible, featureKeys: module.featureKeys,
        features: module.effectiveFeatures, subscriptionIncluded: module.subscriptionIncluded,
        subscriptionActive: module.subscriptionActive, isActive: module.isActive,
        tenantEnabled: module.tenantEnabled, roleAllowed: module.roleAllowed, reason: module.reason,
      })),
    };
  }

  async refresh(refreshToken: string) {
    try {
      if (!refreshToken) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      if (!payload.sub || !payload.sid) throw new Error('missing session');
      const [user, session] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, isActive: true, tenantId: true, role: true, sessionVersion: true, tenant: { select: { isActive: true } } } }),
        this.prisma.authSession.findUnique({ where: { id: payload.sid } }),
      ]);
      if (!user?.isActive || (user.tenant && !user.tenant.isActive) || (user.role !== 'SUPER_ADMIN' && !user.tenantId) ||
          !session || session.userId !== user.id || session.revokedAt || session.expiresAt <= new Date() || session.version !== user.sessionVersion ||
          session.refreshTokenHash !== hashToken(refreshToken)) throw new Error('revoked or replayed');
      const nextRefreshToken = await this.signRefresh(user.id, session.id);
      const changed = await this.prisma.authSession.updateMany({
        where: { id: session.id, userId: user.id, version: user.sessionVersion, refreshTokenHash: hashToken(refreshToken), revokedAt: null, expiresAt: { gt: new Date() } },
        data: { refreshTokenHash: hashToken(nextRefreshToken) },
      });
      if (changed.count !== 1) throw new Error('refresh replay');
      return { accessToken: await this.signAccess(user.id, session.id), refreshToken: nextRefreshToken };
    } catch {
      throw new UnauthorizedException('Refresh token tidak valid');
    }
  }

  async logout(refreshToken?: string, accessToken?: string) {
    for (const [token, secret] of [[refreshToken, process.env.JWT_REFRESH_SECRET], [accessToken, process.env.JWT_ACCESS_SECRET]] as const) {
      if (!token) continue;
      let payload: { sub: string; sid: string };
      try {
        payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(token, { secret });
      } catch { continue; }
      if (!payload.sub || !payload.sid) continue;
      const where = token === refreshToken ? { refreshTokenHash: hashToken(token) } : {};
      const revoked = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.authSession.updateMany({ where: { id: payload.sid, userId: payload.sub, revokedAt: null, ...where }, data: { revokedAt: new Date() } });
        if (changed.count !== 1) return false;
        const user = await tx.user.findUniqueOrThrow({ where: { id: payload.sub }, select: { tenantId: true } });
        await tx.auditLog.create({ data: { userId: payload.sub, tenantId: user.tenantId, action: 'LOGOUT', metadata: { sessionId: payload.sid } } });
        return true;
      });
      if (revoked) return;
    }
  }

  async forgotPassword(email: string) {
    const host = process.env.SMTP_HOST;
    const from = process.env.SMTP_FROM;
    const port = Number(process.env.SMTP_PORT || 587);
    if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) throw new ServiceUnavailableException('Layanan email reset password belum tersedia');
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) return forgotResponse;
    const rawToken = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))::text`;
      const recentCount = await tx.passwordResetToken.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } });
      if (recentCount >= 3) return null;
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      const token = randomBytes(32).toString('hex');
      await tx.passwordResetToken.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
      return token;
    });
    if (!rawToken) return forgotResponse;
    const tokenHash = hashToken(rawToken);
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${rawToken}`;
    const transport = nodemailer.createTransport({ host, port, secure: process.env.SMTP_SECURE === 'true', requireTLS: !!process.env.SMTP_USER && process.env.SMTP_SECURE !== 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
    try {
      await transport.sendMail({ from, to: normalizedEmail, subject: 'Reset password SICTI', text: `Buka link berikut untuk mereset password Anda (berlaku 30 menit): ${resetUrl}\n\nJika Anda tidak meminta reset, abaikan email ini.` });
    } catch {
      await this.prisma.passwordResetToken.updateMany({ where: { tokenHash, usedAt: null }, data: { usedAt: new Date() } });
      console.error('Password reset email delivery failed');
      return forgotResponse;
    } finally {
      transport.close();
    }
    return forgotResponse;
  }

  async resetPassword(token: string, password: string) {
    const tokenHash = hashToken(token);
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
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException('Token reset password tidak valid atau sudah kedaluwarsa');
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.passwordResetToken.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.auditLog.create({
        data: { userId: reset.userId, tenantId: account.tenantId, action: 'PASSWORD_RESET' },
      });
    });

    return { message: 'Password berhasil diubah. Silakan login kembali.' };
  }

  private signAccess(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' });
  }

  private signRefresh(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId, jti: randomUUID() }, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' });
  }

  private async issueSession(user: { id: string; tenantId: string | null; email: string; name: string; role: string; tenant: unknown; sessionVersion: number }, db: Prisma.TransactionClient = this.prisma) {
    const session = await db.authSession.create({ data: { userId: user.id, version: user.sessionVersion, refreshTokenHash: '', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
    const refreshToken = await this.signRefresh(user.id, session.id);
    await db.authSession.update({ where: { id: session.id }, data: { refreshTokenHash: hashToken(refreshToken) } });
    const accessToken = await this.signAccess(user.id, session.id);

    await db.auditLog.create({ data: { userId: user.id, tenantId: user.tenantId, action: 'LOGIN' } });
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
