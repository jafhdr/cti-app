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
    const safePage = Math.max(filter.page || 1, 1);
    const safeLimit = Math.min(Math.max(filter.limit || 50, 1), 100);
    const where = this.scope(currentUser, filter.tenantId);

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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

  async actions(currentUser: AuthUser, tenantId?: string) {
    const rows = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: this.scope(currentUser, tenantId),
      orderBy: { action: 'asc' },
    });
    return rows.map((row) => row.action);
  }

  private scope(currentUser: AuthUser, tenantId?: string): Prisma.AuditLogWhereInput {
    if (currentUser.role === 'SUPER_ADMIN') return tenantId ? { tenantId } : {};
    if (currentUser.role === 'ADMIN' && currentUser.tenantId) return { tenantId: currentUser.tenantId };
    throw new ForbiddenException('Akses ditolak');
  }
}
