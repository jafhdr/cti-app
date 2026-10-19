import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';

@Injectable()
export class AppSecTenantContext {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: AuthUser, requested?: string): Promise<string> {
    if (user.role !== 'SUPER_ADMIN') {
      if (!user.tenantId) throw new ForbiddenException('Tenant context wajib');
      if (requested && requested !== user.tenantId) throw new ForbiddenException('Tenant tidak diizinkan');
      return user.tenantId;
    }
    if (!requested?.trim()) throw new BadRequestException('Tenant wajib dipilih');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: requested }, select: { id: true } });
    if (!tenant) throw new BadRequestException('Tenant tidak ditemukan');
    return tenant.id;
  }
}
