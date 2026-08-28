import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../users/users.types';
import { IndicatorSeverity, IndicatorStatus } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getSummary(currentUser: AuthUser) {
    const isGlobalView = currentUser.role === 'SUPER_ADMIN';
    if (!isGlobalView && !currentUser.tenantId) {
      throw new ForbiddenException('Tenant context wajib tersedia');
    }

    // Non-super-admin queries are always constrained by the tenant derived by
    // AuthGuard, never by a client supplied tenant ID.
    const tenantWhere = isGlobalView ? {} : { tenantId: currentUser.tenantId! };
    const [users, indicators, highRiskIndicators, recentActivity, myIndicatorsCreated, tenantOverview] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { ...tenantWhere, isActive: true } }),
      this.prisma.indicator.count({ where: { ...tenantWhere, status: IndicatorStatus.ACTIVE } }),
      this.prisma.indicator.count({ where: { ...tenantWhere, status: IndicatorStatus.ACTIVE, severity: { in: [IndicatorSeverity.HIGH, IndicatorSeverity.CRITICAL] } } }),
      this.prisma.auditLog.findMany({
        where: isGlobalView ? {} : { tenantId: currentUser.tenantId! },
        select: { id: true, action: true, createdAt: true, metadata: true },
        orderBy: { createdAt: 'desc' }, take: 10,
      }),
      this.prisma.indicator.count({ where: { ...tenantWhere, createdById: currentUser.sub } }),
      isGlobalView
        ? this.prisma.tenant.findMany({
          where: { isActive: true },
          select: { id: true, name: true, slug: true, _count: { select: { users: { where: { isActive: true } }, indicators: { where: { status: IndicatorStatus.ACTIVE } } } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        })
        : this.prisma.tenant.findMany({ where: { id: currentUser.tenantId! }, select: { id: true, name: true, slug: true }, take: 1 }),
    ]);

    const dashboardMode = isGlobalView ? 'GLOBAL' : currentUser.role === 'ADMIN' ? 'TENANT_ADMIN' : 'PERSONAL';
    const tenantName = isGlobalView ? 'Platform Overview' : tenantOverview[0]?.name ?? null;

    // Total tenant count for SUPER_ADMIN
    const totalTenants = isGlobalView
      ? await this.prisma.tenant.count({ where: { isActive: true } })
      : null;

    return {
      dashboardMode,
      tenantName,
      workspace: isGlobalView ? { name: 'Platform Overview', tenantId: null } : tenantOverview[0] ?? null,
      // Platform-wide stats (SUPER_ADMIN only)
      totalTenants,
      // Tenant/scope stats
      indicators,
      highRiskIndicators,
      activeAlerts: 0,
      openCases: 0,
      users,
      // Personal stats
      myIndicatorsCreated,
      sources: 0,
      campaigns: 0,
      subscription: { plan: isGlobalView ? 'Platform / Global' : 'MVP / Trial', status: 'ACTIVE' },
      recentActivity,
      tenantOverview: isGlobalView ? tenantOverview : [],
    };
  }
}
