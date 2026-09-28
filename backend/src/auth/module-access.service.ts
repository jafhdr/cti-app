import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { type AuthUser } from '../users/users.types';
import { effectiveModuleDecision, modulePolicyDecision } from './effective-module-access';

export type ModuleAccessResult = { readonly accessible: true } | { readonly accessible: false; readonly reason: string };

@Injectable()
export class ModuleAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async entitlement(tenantId: string) {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] }, renewalAt: { gt: new Date() } },
      select: {
        isCustom: true,
        package: { select: { name: true, modules: { select: { moduleId: true } } } },
        customModules: { select: { moduleId: true } },
      },
    });
    return {
      subscriptionActive: subscription !== null,
      subscriptionSource: subscription ? (subscription.isCustom ? 'Custom Subscription' : subscription.package?.name ?? null) : null,
      moduleIds: new Set(subscription?.isCustom ? subscription.customModules.map(entry => entry.moduleId)
        : subscription?.package?.modules.map(entry => entry.moduleId) ?? []),
    };
  }

  async listTenantPolicies(tenantId: string, slug?: string) {
    const [modules, entitlement] = await Promise.all([
      this.prisma.appModule.findMany({
        where: slug ? { slug } : {},
        include: { features: { orderBy: { name: 'asc' } }, settings: { where: { tenantId }, include: { access: true } } },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      }),
      this.entitlement(tenantId),
    ]);
    return modules.map(({ settings, ...module }) => {
      const setting = settings[0];
      const roleAccess = {
        ADMIN: setting?.access.find(entry => entry.role === 'ADMIN')?.isAllowed ?? false,
        USER: setting?.access.find(entry => entry.role === 'USER')?.isAllowed ?? false,
      };
      const policy = {
        subscriptionActive: entitlement.subscriptionActive,
        subscriptionIncluded: entitlement.moduleIds.has(module.id),
        isActive: module.isActive,
        tenantEnabled: setting?.isEnabled ?? false,
      };
      return {
        ...module, ...policy, subscriptionSource: entitlement.subscriptionSource, roleAccess,
        policyAccess: {
          ADMIN: modulePolicyDecision({ ...policy, roleAllowed: roleAccess.ADMIN }),
          USER: modulePolicyDecision({ ...policy, roleAllowed: roleAccess.USER }),
        },
      };
    });
  }

  async listForUser(user: AuthUser, slug?: string) {
    const tenantId = user.tenantId ?? '';
    const [modules, assignments] = await Promise.all([
      this.listTenantPolicies(tenantId, slug),
      this.prisma.userModuleAccess.findMany({ where: { userId: user.sub, tenantId }, select: { moduleId: true, featureKeys: true } }),
    ]);
    return modules.map(module => {
      const assignment = assignments.find(entry => entry.moduleId === module.id);
      const superAdmin = user.role === 'SUPER_ADMIN';
      const roleAllowed = superAdmin || module.roleAccess[user.role];
      const assigned = superAdmin || assignment !== undefined;
      const policy = { ...module, roleAllowed };
      const decision = superAdmin ? { accessible: true, reason: null } : effectiveModuleDecision(policy, assigned);
      const featureKeys = superAdmin ? module.features.map(feature => feature.key) : assignment?.featureKeys ?? [];
      return {
        ...module, roleAllowed, assigned, featureKeys, ...decision,
        assignable: superAdmin || modulePolicyDecision(policy).accessible,
        effectiveFeatures: decision.accessible ? featureKeys.filter(key => module.features.some(feature => feature.key === key)) : [],
      };
    });
  }

  async evaluate(user: AuthUser | undefined, slug: string, requiredFeatures?: readonly string[]): Promise<ModuleAccessResult> {
    if (!user) return { accessible: false, reason: 'Sesi pengguna tidak tersedia' };
    if (user.role === 'SUPER_ADMIN') return { accessible: true };
    if (!user.tenantId) return { accessible: false, reason: 'Tenant context wajib tersedia' };
    const module = (await this.listForUser(user, slug)).find(entry => entry.slug === slug);
    if (!module) return { accessible: false, reason: 'Modul ini sedang tidak aktif' };
    if (!module.accessible) return { accessible: false, reason: module.reason ?? 'Akses modul ditolak' };
    if (requiredFeatures?.some(key => !module.effectiveFeatures.includes(key))) {
      return { accessible: false, reason: 'Anda tidak memiliki akses ke fitur yang diperlukan' };
    }
    return { accessible: true };
  }
}
