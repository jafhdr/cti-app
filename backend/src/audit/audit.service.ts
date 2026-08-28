import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../users/users.types';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(currentUser: AuthUser, page = 1, limit = 50) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const where: Prisma.AuditLogWhereInput = currentUser.role === 'SUPER_ADMIN'
      ? {}
      : { tenantId: currentUser.tenantId! };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: { id: true, userId: true, tenantId: true, action: true, metadata: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, page: safePage, limit: safeLimit, total };
  }
}
