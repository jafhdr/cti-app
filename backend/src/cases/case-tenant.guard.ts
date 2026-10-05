import { BadRequestException, CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';

@Injectable()
export class CaseTenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user: AuthUser;
      params: { id?: string };
      query: { tenantId?: unknown };
    }>();
    if (request.user.role !== 'SUPER_ADMIN' || !request.params.id) return true;

    const tenantId = request.query.tenantId;
    if (typeof tenantId !== 'string' || !tenantId.trim()) throw new BadRequestException('Tenant wajib dipilih');
    const selectedCase = await this.prisma.case.findFirst({
      where: { id: request.params.id, tenantId },
      select: { id: true },
    });
    if (!selectedCase) throw new NotFoundException('Case tidak ditemukan');
    return true;
  }
}
