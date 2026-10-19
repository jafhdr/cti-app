import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../users/users.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.access_token ||
      request.headers.authorization?.replace('Bearer ', '');

    if (!token) throw new UnauthorizedException('Unauthorized');

    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Token tidak valid');
    }

    // Role and tenant membership are read from the database for every request.
    // This makes a role change or deleted account effective immediately, even
    // when an older access token still has time before expiry.
    if (!payload.sub || !payload.sid) throw new UnauthorizedException('Token tidak valid');
    const [user, session] = await Promise.all([this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, tenantId: true, isActive: true, sessionVersion: true, tenant: { select: { isActive: true } } },
    }), this.prisma.authSession.findUnique({ where: { id: payload.sid } })]);

    if (!user) throw new UnauthorizedException('Akun tidak ditemukan');
    if (!session || session.userId !== user.id || session.revokedAt || session.expiresAt <= new Date() || session.version !== user.sessionVersion) throw new UnauthorizedException('Sesi tidak valid');
    if (!user.isActive) throw new UnauthorizedException('Akun ini sudah dinonaktifkan');
    if (user.tenant && !user.tenant.isActive) throw new UnauthorizedException('Tenant akun ini sudah dinonaktifkan');

    if (user.role !== 'SUPER_ADMIN' && !user.tenantId) {
      throw new UnauthorizedException('Akun tidak memiliki tenant aktif');
    }

    request.user = {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
    } satisfies AuthUser;
    return true;
  }
}
