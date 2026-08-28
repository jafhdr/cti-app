import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { AuthUser, UserRole } from '../users/users.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!allowedRoles?.length) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user || !allowedRoles.includes(user.role)) {
      throw new ForbiddenException('Anda tidak memiliki akses untuk aksi ini');
    }

    return true;
  }
}
