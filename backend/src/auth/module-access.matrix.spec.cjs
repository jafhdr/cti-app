const assert = require('node:assert/strict');
const test = require('node:test');
const { ModuleAccessService } = require('../../dist/src/auth/module-access.service.js');
const slugs = ['threat-intelligence', 'case-management', 'attack-surface-management', 'appsec-posture'];
function fixture(overrides = {}) {
  const state = { active: true, subscription: true, included: true, enabled: true, allowed: true, assigned: true, featureKeys: [], ...overrides };
  const modules = slugs.map(slug => ({ id: slug, slug, name: slug, isActive: state.active, features: [{ key: 'test-feature' }], settings: [{ isEnabled: state.enabled, access: ['ADMIN', 'USER'].map(role => ({ role, isAllowed: state.allowed })) }], userAccess: state.assigned ? [{ featureKeys: state.featureKeys }] : [] }));
  const subscription = state.subscription ? { isCustom: true, customModules: state.included ? modules.map(m => ({ moduleId: m.id })) : [], package: null } : null;
  const prisma = {
    appModule: { findUnique: async ({ where }) => modules.find(m => m.slug === where.slug), findMany: async () => modules },
    tenantSubscription: { findFirst: async () => subscription },
    tenantModule: { findUnique: async () => modules[0].settings[0] },
    userModuleAccess: { findMany: async () => state.assigned ? modules.map(m => ({ moduleId: m.id, featureKeys: state.featureKeys })) : [], findFirst: async () => modules[0].userAccess[0] ?? null },
  };
  return new ModuleAccessService(prisma);
}
for (const role of ['ADMIN', 'USER']) {
  for (const slug of slugs) {
    for (const [label, state, expected] of [
      ['all off', { subscription: false, enabled: false, allowed: false, assigned: false }, false],
      ['global inactive', { active: false }, false],
      ['subscription absent', { subscription: false }, false],
      ['module excluded', { included: false }, false],
      ['tenant disabled', { enabled: false }, false],
      ['role denied', { allowed: false }, false],
      ['unassigned', { assigned: false }, false],
      ['assigned without features', {}, true],
    ]) {
      test(`${role} ${slug}: ${label}`, async () => {
        const access = fixture(state);
        const result = await access.evaluate({ sub: 'user', tenantId: 'tenant', role }, slug);
        assert.equal(result.accessible, expected);
      });
    }
    test(`${role} ${slug}: empty features denies required feature`, async () => {
      assert.equal((await fixture().evaluate({ sub: 'user', tenantId: 'tenant', role }, slug, ['test-feature'])).accessible, false);
    });
    test(`${role} ${slug}: assigned feature permits request`, async () => {
      assert.equal((await fixture({ featureKeys: ['test-feature'] }).evaluate({ sub: 'user', tenantId: 'tenant', role }, slug, ['test-feature'])).accessible, true);
    });
  }
}
test('SUPER_ADMIN retains existing bypass', async () => {
  assert.equal((await fixture({ subscription: false, active: false }).evaluate({ sub: 'root', tenantId: null, role: 'SUPER_ADMIN' }, slugs[0], ['test-feature'])).accessible, true);
});
test('missing session or tenant fails closed', async () => {
  assert.equal((await fixture().evaluate(undefined, slugs[0])).accessible, false);
  assert.equal((await fixture().evaluate({ sub: 'u', tenantId: null, role: 'ADMIN' }, slugs[0])).accessible, false);
});
