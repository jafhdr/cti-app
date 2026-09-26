import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuthUser } from '../users/users.types';
import { REQUIRED_MODULE_KEY, REQUIRED_FEATURE_KEY } from './module-access.decorator';
import { ModuleAccessService } from './module-access.service';

@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly access: ModuleAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const slug = this.reflector.getAllAndOverride<string>(REQUIRED_MODULE_KEY, [context.getHandler(), context.getClass()]);
    if (!slug) return true;
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    const features = this.reflector.getAllAndOverride<readonly string[] | undefined>(REQUIRED_FEATURE_KEY, [context.getHandler(), context.getClass()]);
    const result = await this.access.evaluate(user, slug, features);
    if (!result.accessible) throw new ForbiddenException(result.reason);
    return true;
  }
}
