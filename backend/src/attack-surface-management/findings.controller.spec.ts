import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { REQUIRED_FEATURE_KEY, REQUIRED_MODULE_KEY } from '../auth/module-access.decorator';
import { FindingsController } from './findings.controller';

describe('FindingsController authorization', () => {
  it('keeps authentication, role, and module guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FindingsController)).toEqual([AuthGuard, RolesGuard, ModuleAccessGuard]);
    expect(Reflect.getMetadata(REQUIRED_MODULE_KEY, FindingsController)).toBe('attack-surface-management');
    expect(Reflect.getMetadata(REQUIRED_FEATURE_KEY, FindingsController)).toEqual(['asset-management']);
  });

  it('limits manual create and update to administrators', () => {
    expect(Reflect.getMetadata(ROLES_KEY, FindingsController.prototype.create)).toEqual(['SUPER_ADMIN', 'ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, FindingsController.prototype.update)).toEqual(['SUPER_ADMIN', 'ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, FindingsController.prototype.list)).toEqual(['SUPER_ADMIN', 'ADMIN', 'USER']);
  });
});
