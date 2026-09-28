const assert = require('node:assert/strict');
const test = require('node:test');
const { ModuleAccessGuard } = require('../../dist/src/auth/module-access.guard.js');
const { ModuleAccessService } = require('../../dist/src/auth/module-access.service.js');
const admin = { sub: 'admin-a', tenantId: 'tenant-a', role: 'ADMIN' };
const user = { sub: 'user-a', tenantId: 'tenant-a', role: 'USER' };
const slugs = ['attack-surface-management', 'threat-intelligence', 'case-management', 'appsec-posture'];
function setup(options = {}) {
  const calls = [];
  const prisma = {
    appModule: { findMany: async ({ where, include }) => {
      const tenantId = include.settings.where.tenantId;
      calls.push(tenantId);
      return [{ id: where.slug, slug: where.slug, isActive: options.active !== false, features: [{ key: 'asset-management' }], settings: [{ isEnabled: options.enabled !== false && tenantId !== 'tenant-b', access: ['ADMIN', 'USER'].map(role => ({ role, isAllowed: options.allowed !== false })) }] }];
    } },
    tenantSubscription: { findFirst: async ({ where }) => {
      calls.push(where.tenantId);
      return options.subscription === false ? null : { isCustom: true, customModules: options.included === false ? [] : slugs.map(moduleId => ({ moduleId })) };
    } },
    userModuleAccess: { findMany: async ({ where }) => {
      calls.push(where.tenantId);
      return options.assigned === false ? [] : slugs.map(moduleId => ({ moduleId, featureKeys: options.featureKeys ?? [] }));
    } },
  };
  return { access: new ModuleAccessService(prisma), calls };
}
function guarded(access, subject, slug) {
  const reflector = { getAllAndOverride: key => key === 'requiredModule' ? slug : undefined };
  const context = { getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => ({ user: subject }) }) };
  return new ModuleAccessGuard(reflector, access).canActivate(context);
}
for (const slug of slugs) {
  test(`ADMIN requires individual assignment for ${slug}`, async () => {
    await assert.rejects(() => guarded(setup({ assigned: false }).access, admin, slug), /Modul belum diberikan/);
    assert.equal(await guarded(setup().access, admin, slug), true);
  });
}
for (const [name, options, reason] of [
  ['role denied', { allowed: false }, /Role tidak memiliki akses/],
  ['tenant module disabled', { enabled: false }, /Modul dinonaktifkan/],
  ['subscription excludes module', { included: false }, /Modul tidak termasuk/],
  ['subscription inactive', { subscription: false }, /Subscription tenant tidak aktif/],
]) {
  test(`ADMIN denied when ${name}`, async () => {
    await assert.rejects(() => guarded(setup(options).access, admin, slugs[0]), reason);
  });
}
test('USER requires individual assignment', async () => {
  assert.deepEqual(await setup().access.evaluate(user, slugs[0]), { accessible: true });
  await assert.rejects(() => guarded(setup({ assigned: false }).access, user, slugs[0]), /Modul belum diberikan/);
});
test('SUPER_ADMIN bypasses tenant checks', async () => {
  const { access, calls } = setup({ subscription: false, enabled: false, assigned: false });
  assert.deepEqual(await access.evaluate({ sub: 'root', tenantId: null, role: 'SUPER_ADMIN' }, slugs[0]), { accessible: true });
  assert.deepEqual(calls, []);
});
test('tenant isolation uses session tenant', async () => {
  const { access, calls } = setup();
  assert.equal((await access.evaluate(admin, slugs[0])).accessible, true);
  assert.equal((await access.evaluate({ ...admin, tenantId: 'tenant-b' }, slugs[0])).accessible, false);
  assert.ok(calls.includes('tenant-a'));
  assert.ok(calls.includes('tenant-b'));
});
