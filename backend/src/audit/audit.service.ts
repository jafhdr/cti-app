import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';

export type AuditListFilter = {
  readonly page?: number;
  readonly limit?: number;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly action?: string;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(currentUser: AuthUser, filter: AuditListFilter = {}) {
    if (currentUser.role === 'USER') {
      throw new ForbiddenException('Akses ditolak: User tidak memiliki izin untuk melihat audit log');
    }

    const safePage = Math.max(filter.page || 1, 1);
    const safeLimit = Math.min(Math.max(filter.limit || 50, 1), 100);

    const where: Prisma.AuditLogWhereInput = {};

    if (currentUser.role === 'SUPER_ADMIN') {
      // Superadmin can see all logs, or filter by a specific tenantId if requested
      if (filter.tenantId) {
        where.tenantId = filter.tenantId;
      }
    } else if (currentUser.role === 'ADMIN') {
      // Tenant admin is strictly constrained to their own tenant
      if (!currentUser.tenantId) {
        throw new ForbiddenException('Tenant context tidak valid');
      }
      where.tenantId = currentUser.tenantId;
    } else {
      throw new ForbiddenException('Akses ditolak');
    }

    if (filter.userId) {
      where.userId = filter.userId;
    }

    if (filter.action) {
      where.action = filter.action;
    }

    const [rawItems, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          userId: true,
          tenantId: true,
          action: true,
          metadata: true,
          createdAt: true,
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Enrich logs with user info (name, email, role)
    const userIds = Array.from(new Set(rawItems.map((item) => item.userId).filter((id): id is string => Boolean(id))));
    const users = userIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const items = rawItems.map((item) => ({
      ...item,
      user: item.userId ? userMap.get(item.userId) ?? null : null,
    }));

    return { items, page: safePage, limit: safeLimit, total };
  }
}
