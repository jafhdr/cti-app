import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { type AuthUser } from '../users/users.types';

export type ModuleAccessResult = { accessible: true } | { accessible: false; reason: string };

@Injectable()
export class ModuleAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(user: AuthUser | undefined, slug: string, requiredFeatures?: readonly string[]): Promise<ModuleAccessResult> {
    if (!user) return { accessible: false, reason: 'Sesi pengguna tidak tersedia' };
    if (user.role === 'SUPER_ADMIN') return { accessible: true };
    if (!user.tenantId) return { accessible: false, reason: 'Tenant context wajib tersedia' };

    const module = await this.prisma.appModule.findUnique({ where: { slug }, select: { id: true, isActive: true } });
    if (!module?.isActive) return { accessible: false, reason: 'Modul ini sedang tidak aktif' };

    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId: user.tenantId, status: { in: ['TRIAL', 'ACTIVE'] }, renewalAt: { gt: new Date() } },
      select: {
        isCustom: true,
        package: { select: { modules: { where: { moduleId: module.id }, select: { moduleId: true } } } },
        customModules: { where: { moduleId: module.id }, select: { moduleId: true } },
      },
    });
    if (!subscription) return { accessible: false, reason: 'Subscription tenant tidak aktif' };
    const included = subscription.isCustom ? subscription.customModules.length > 0 : (subscription.package?.modules.length ?? 0) > 0;
    if (!included) return { accessible: false, reason: 'Modul tidak termasuk dalam subscription tenant' };

    const tenantModule = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId: user.tenantId, moduleId: module.id } },
      select: { isEnabled: true, access: { where: { role: user.role }, select: { isAllowed: true }, take: 1 } },
    });
    if (!tenantModule?.isEnabled) return { accessible: false, reason: 'Modul dinonaktifkan untuk tenant ini' };
    if (!tenantModule.access[0]?.isAllowed) return { accessible: false, reason: 'Role tidak memiliki akses ke modul ini' };

    if (user.role === 'USER' || (requiredFeatures && requiredFeatures.length > 0)) {
      const assignment = await this.prisma.userModuleAccess.findFirst({
        where: { userId: user.sub, tenantId: user.tenantId, moduleId: module.id },
        select: { featureKeys: true },
      });
      if (user.role === 'USER' && !assignment) return { accessible: false, reason: 'Modul belum diberikan kepada user ini' };
      if (requiredFeatures?.length && !requiredFeatures.every((key) => assignment?.featureKeys.includes(key))) {
        return { accessible: false, reason: 'Anda tidak memiliki akses ke fitur yang diperlukan' };
      }
    }
    return { accessible: true };
  }
}
