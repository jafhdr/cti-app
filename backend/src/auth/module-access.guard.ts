import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { type AuthUser } from '../users/users.types';
import { REQUIRED_MODULE_KEY } from './module-access.decorator';

@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const slug = this.reflector.getAllAndOverride<string>(REQUIRED_MODULE_KEY, [context.getHandler(), context.getClass()]);
    if (!slug) return true;
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('Sesi pengguna tidak tersedia');
    const module = await this.prisma.appModule.findUnique({ where: { slug }, select: { isActive: true, settings: { where: { tenantId: user.tenantId ?? undefined, isEnabled: true }, include: { access: { where: { role: user.role, isAllowed: true } } } } } });
    if (!module?.isActive) throw new ForbiddenException('Modul ini sedang tidak aktif');
    if (user.role === 'SUPER_ADMIN') return true;
    if (!module.settings.some((setting) => setting.access.length > 0)) throw new ForbiddenException('Anda tidak memiliki akses ke modul ini');
    return true;
  }
}
