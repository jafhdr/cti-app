const assert = require('node:assert/strict');
const test = require('node:test');
const { ModuleAccessGuard } = require('../../dist/src/auth/module-access.guard.js');

const user = { sub: 'user-a', tenantId: 'tenant-a', role: 'USER' };
const context = {
  getHandler: () => ({}),
  getClass: () => ({}),
  switchToHttp: () => ({ getRequest: () => ({ user }) }),
};

test('Given a disabled tenant module, when access is checked, then access is denied', async () => {
  const reflector = { getAllAndOverride: (key) => key === 'requiredModule' ? 'threat-intelligence' : undefined };
  const prisma = {
    appModule: { findUnique: async () => ({ id: 'module-a', isActive: true }) },
    tenantSubscription: { findFirst: async () => ({ isCustom: true, package: null, customModules: [{ moduleId: 'module-a' }] }) },
    tenantModule: { findUnique: async () => ({ isEnabled: false, access: [{ isAllowed: true }] }) },
    userModuleAccess: { findFirst: async () => ({ featureKeys: [] }) },
  };

  await assert.rejects(() => new ModuleAccessGuard(reflector, prisma).canActivate(context), /Modul dinonaktifkan untuk tenant ini/);
});

test('Given a denied module role, when access is checked, then access is denied', async () => {
  const reflector = { getAllAndOverride: (key) => key === 'requiredModule' ? 'threat-intelligence' : undefined };
  const prisma = {
    appModule: { findUnique: async () => ({ id: 'module-a', isActive: true }) },
    tenantSubscription: { findFirst: async () => ({ isCustom: true, package: null, customModules: [{ moduleId: 'module-a' }] }) },
    tenantModule: { findUnique: async () => ({ isEnabled: true, access: [{ isAllowed: false }] }) },
    userModuleAccess: { findFirst: async () => ({ featureKeys: [] }) },
  };

  await assert.rejects(() => new ModuleAccessGuard(reflector, prisma).canActivate(context), /Role tidak memiliki akses ke modul ini/);
});
