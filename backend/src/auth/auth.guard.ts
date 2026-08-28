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

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Token tidak valid');
    }

    // Role and tenant membership are read from the database for every request.
    // This makes a role change or deleted account effective immediately, even
    // when an older access token still has time before expiry.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, tenantId: true, isActive: true, tenant: { select: { isActive: true } } },
    });

    if (!user) throw new UnauthorizedException('Akun tidak ditemukan');
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
