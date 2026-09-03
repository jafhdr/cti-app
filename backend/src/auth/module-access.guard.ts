import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { type AuthUser } from '../users/users.types';
import { REQUIRED_MODULE_KEY, REQUIRED_FEATURE_KEY } from './module-access.decorator';

@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const slug = this.reflector.getAllAndOverride<string>(REQUIRED_MODULE_KEY, [context.getHandler(), context.getClass()]);
    if (!slug) return true;
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('Sesi pengguna tidak tersedia');
    if (user.role === 'SUPER_ADMIN') return true;
    if (!user.tenantId) throw new ForbiddenException('Tenant context wajib tersedia');

    // Modul-level subscription check.
    const module = await this.prisma.appModule.findUnique({ where: { slug }, select: { id: true, isActive: true } });
    if (!module || !module.isActive) throw new ForbiddenException('Modul ini sedang tidak aktif');

    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId: user.tenantId, status: { in: ['TRIAL', 'ACTIVE'] }, renewalAt: { gt: new Date() } },
      select: {
        isCustom: true,
        package: { select: { modules: { where: { module: { slug } }, select: { moduleId: true } } } },
        customModules: { where: { module: { slug } }, select: { moduleId: true } },
      },
    });
    if (!subscription) throw new ForbiddenException('Subscription tenant tidak aktif');
    const included = subscription.isCustom ? subscription.customModules.length > 0 : (subscription.package?.modules.length ?? 0) > 0;
    if (!included) throw new ForbiddenException('Modul tidak termasuk dalam subscription tenant');

    // Role ADMIN dan USER tinggal cek assignment per-user — keduanya butuh assignment eksplisit.
    if (user.role === 'USER' || user.role === 'ADMIN') {
      const assignment = await this.prisma.userModuleAccess.findFirst({ where: { userId: user.sub, tenantId: user.tenantId, module: { slug } } });
      if (!assignment) throw new ForbiddenException('Modul belum diberikan kepada user ini');

      const requiredFeatures = this.reflector.getAllAndOverride<readonly string[] | undefined>(REQUIRED_FEATURE_KEY, [context.getHandler(), context.getClass()]);
      if (requiredFeatures && requiredFeatures.length > 0 && !requiredFeatures.every((key) => assignment.featureKeys.includes(key))) {
        throw new ForbiddenException('Anda tidak memiliki akses ke fitur yang diperlukan');
      }
    }

    return true;
  }
}
