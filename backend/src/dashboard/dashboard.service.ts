import { ForbiddenException, Injectable } from '@nestjs/common';
import { AlertStatus, CaseStatus, IndicatorSeverity, IndicatorStatus, IntelligenceEntityType } from '@prisma/client';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import type { AuthUser } from '../users/users.types';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccess: ModuleAccessService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async getSummary(currentUser: AuthUser) {
    const global = currentUser.role === 'SUPER_ADMIN';
    if (!global && !currentUser.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');

    const modules = global ? [] : await this.moduleAccess.listForUser(currentUser);
    const can = (slug: string, feature: string) => global || modules.some(module =>
      module.slug === slug && module.accessible && module.effectiveFeatures.includes(feature));
    const canIndicators = can('threat-intelligence', 'indicator-management');
    const canIntelligence = can('threat-intelligence', 'intelligence-hub');
    const canAsm = can('attack-surface-management', 'asset-management');
    const canCases = can('case-management', 'case-workflow');
    const tenantWhere = global ? {} : { tenantId: currentUser.tenantId! };
    const subscription = global ? null : await this.subscriptions.getMy(currentUser);

    const [users, indicators, highRiskIndicators, activeAlerts, openCases, sources, campaigns, recentActivity, myIndicatorsCreated, tenantOverview, totalTenants] = await Promise.all([
      currentUser.role === 'USER' ? Promise.resolve(null) : this.prisma.user.count({ where: { ...tenantWhere, isActive: true } }),
      canIndicators ? this.prisma.indicator.count({ where: { ...tenantWhere, status: IndicatorStatus.ACTIVE } }) : Promise.resolve(null),
      canIndicators ? this.prisma.indicator.count({ where: { ...tenantWhere, status: IndicatorStatus.ACTIVE, severity: { in: [IndicatorSeverity.HIGH, IndicatorSeverity.CRITICAL] } } }) : Promise.resolve(null),
      canAsm ? this.prisma.alert.count({ where: { ...tenantWhere, status: { not: AlertStatus.CLOSED } } }) : Promise.resolve(null),
      canCases ? this.prisma.case.count({ where: { ...tenantWhere, status: { in: [CaseStatus.OPEN, CaseStatus.IN_PROGRESS] } } }) : Promise.resolve(null),
      canIntelligence ? this.prisma.intelligenceEntity.count({ where: { ...tenantWhere, type: { in: [IntelligenceEntityType.SOURCE, IntelligenceEntityType.FEED] } } }) : Promise.resolve(null),
      canIntelligence ? this.prisma.intelligenceEntity.count({ where: { ...tenantWhere, type: IntelligenceEntityType.CAMPAIGN } }) : Promise.resolve(null),
      currentUser.role === 'USER' ? Promise.resolve([]) : this.prisma.auditLog.findMany({
        where: global ? {} : { tenantId: currentUser.tenantId! },
        select: { id: true, action: true, createdAt: true, metadata: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10,
      }),
      canIndicators ? this.prisma.indicator.count({ where: { ...tenantWhere, createdById: currentUser.sub } }) : Promise.resolve(null),
      global ? this.prisma.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true, slug: true, _count: { select: { users: { where: { isActive: true } }, indicators: { where: { status: IndicatorStatus.ACTIVE } } } } },
        orderBy: { createdAt: 'desc' }, take: 10,
      }) : this.prisma.tenant.findMany({ where: { id: currentUser.tenantId! }, select: { id: true, name: true, slug: true }, take: 1 }),
      global ? this.prisma.tenant.count({ where: { isActive: true } }) : Promise.resolve(null),
    ]);

    return {
      dashboardMode: global ? 'GLOBAL' : currentUser.role === 'ADMIN' ? 'TENANT_ADMIN' : 'PERSONAL',
      tenantName: global ? 'Platform Overview' : tenantOverview[0]?.name ?? null,
      workspace: global ? { name: 'Platform Overview', tenantId: null } : tenantOverview[0] ?? null,
      totalTenants,
      indicators,
      highRiskIndicators,
      activeAlerts,
      openCases,
      users,
      myIndicatorsCreated,
      sources,
      campaigns,
      subscription: global ? { plan: null, status: 'GLOBAL', persistedStatus: null } : subscription ? {
        plan: subscription.subscriptionSource,
        status: subscription.status,
        persistedStatus: subscription.persistedStatus,
      } : { plan: null, status: 'NONE', persistedStatus: null },
      recentActivity,
      activityAvailable: currentUser.role !== 'USER',
      tenantOverview: global ? tenantOverview : [],
    };
  }
}
