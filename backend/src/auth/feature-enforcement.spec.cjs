const assert = require('node:assert/strict');
const test = require('node:test');
const { Reflector } = require('@nestjs/core');
const { ModuleAccessGuard } = require('../../dist/src/auth/module-access.guard.js');
const { ModuleAccessService } = require('../../dist/src/auth/module-access.service.js');

const mappings = [
  ['indicators/indicators', 'IndicatorsController', 'list', 'threat-intelligence', 'indicator-management'],
  ['telegram/ioc-candidates', 'IocCandidatesController', 'approve', 'threat-intelligence', 'indicator-management'],
  ...['intelligence', 'campaigns', 'malware-tools', 'mitre-techniques', 'reports', 'sources', 'threat-actors', 'vulnerabilities'].map((name) => [
    `intelligence/${name}`, name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('') + 'Controller', name === 'intelligence' ? 'overview' : 'list', 'threat-intelligence', 'intelligence-hub',
  ]),
  ['cases/cases', 'CasesController', 'list', 'case-management', 'case-workflow'],
  ...['getAvailableCases', 'getCases', 'linkCase', 'unlinkCase'].map((method) => ['indicators/indicators', 'IndicatorsController', method, 'case-management', 'case-workflow']),
  ['attack-surface-management/assets', 'AssetsController', 'list', 'attack-surface-management', 'asset-management'],
  ['attack-surface-management/assets', 'AssetsController', 'discover', 'attack-surface-management', 'asset-discovery'],
  ['attack-surface-management/port-services', 'PortServicesController', 'list', 'attack-surface-management', 'asset-management'],
  ['attack-surface-management/port-services', 'PortServicesController', 'discover', 'attack-surface-management', 'asset-discovery'],
];

for (const [path, name, method, slug, feature] of mappings) {
  test(`${name}.${method} enforces ${feature} in ${slug}`, async () => {
    // Given an assigned user whose module is entitled and enabled.
    const Controller = require(`../../dist/src/${path}.controller.js`)[name];
    const reflector = new Reflector();
    const targets = [Controller.prototype[method], Controller];
    assert.equal(reflector.getAllAndOverride('requiredModule', targets), slug);
    assert.deepEqual(reflector.getAllAndOverride('requiredFeatures', targets), [feature]);
  });
}

function accessWithFeatures(featureKeys) {
  return new ModuleAccessService({
    appModule: { findMany: async () => [{ id: 'asm', slug: 'attack-surface-management', isActive: true, features: [{ key: 'asset-management' }, { key: 'asset-discovery' }], settings: [{ isEnabled: true, access: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] }] }] },
    tenantSubscription: { findFirst: async () => ({ isCustom: true, customModules: [{ moduleId: 'asm' }] }) },
    userModuleAccess: { findMany: async () => [{ moduleId: 'asm', featureKeys }] },
  });
}

for (const role of ['ADMIN', 'USER']) {
  for (const featureKeys of [[], ['asset-discovery']]) {
    test(`${role} discovery is ${featureKeys.length ? 'allowed' : 'denied'} by assigned features`, async () => {
      // Given the real controller metadata and authorization service.
      const { AssetsController } = require('../../dist/src/attack-surface-management/assets.controller.js');
      const guard = new ModuleAccessGuard(new Reflector(), accessWithFeatures(featureKeys));
      const context = {
        getHandler: () => AssetsController.prototype.discover,
        getClass: () => AssetsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'user', tenantId: 'tenant', role } }) }),
      };
      // When the guarded discovery operation is requested, then enforce the feature assignment.
      if (featureKeys.length) assert.equal(await guard.canActivate(context), true);
      else await assert.rejects(() => guard.canActivate(context), (error) => error.getStatus() === 403);
    });
  }
  test(`${role} module access remains available with no assigned features`, async () => {
    const access = accessWithFeatures([]);
    const result = await access.evaluate({ sub: 'user', tenantId: 'tenant', role }, 'attack-surface-management');
    assert.equal(result.accessible, true);
  });
}

test('SUPER_ADMIN feature operations retain existing bypass', async () => {
  const { AssetsController } = require('../../dist/src/attack-surface-management/assets.controller.js');
  const guard = new ModuleAccessGuard(new Reflector(), new ModuleAccessService({}));
  const result = await guard.canActivate({
    getHandler: () => AssetsController.prototype.discover,
    getClass: () => AssetsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'root', tenantId: null, role: 'SUPER_ADMIN' } }) }),
  });
  assert.equal(result, true);
});

test('ASM HTTP endpoint denies unassigned discovery and allows assigned discovery', async () => {
  // Given the actual controller, guards, and access service with an in-memory entitlement fixture.
  const { Test } = require('@nestjs/testing');
  const { AuthGuard } = require('../../dist/src/auth/auth.guard.js');
  const { AssetsController } = require('../../dist/src/attack-surface-management/assets.controller.js');
  const { AssetsService } = require('../../dist/src/attack-surface-management/assets.service.js');
  const { DiscoveryRunsService } = require('../../dist/src/attack-surface-management/discovery-runs.service.js');
  let featureKeys = [];
  let discoveryCalls = 0;
  const fixture = await Test.createTestingModule({
    controllers: [AssetsController],
    providers: [
      { provide: AssetsService, useValue: {} },
      { provide: DiscoveryRunsService, useValue: { run: async () => { discoveryCalls += 1; return { id: 'run-a', legacySummary: { started: true } }; } } },
    ],
  })
    .overrideGuard(AuthGuard).useValue({ canActivate(context) {
      context.switchToHttp().getRequest().user = { sub: 'user', tenantId: 'tenant', role: 'ADMIN' };
      return true;
    } })
    .overrideGuard(ModuleAccessGuard).useValue({ canActivate(context) {
      return new ModuleAccessGuard(new Reflector(), accessWithFeatures(featureKeys)).canActivate(context);
    } }).compile();
  const app = fixture.createNestApplication();
  await app.listen(0, '127.0.0.1');
  try {
    const url = `${await app.getUrl()}/attack-surface/assets/asset-a/discover`;
    // When a module-assigned administrator requests discovery without its feature, then reject before execution.
    const denied = await fetch(url, { method: 'POST' });
    assert.equal(denied.status, 403);
    assert.equal(discoveryCalls, 0);
    featureKeys = ['asset-discovery'];
    // When that feature is assigned, then the same route executes successfully.
    const allowed = await fetch(url, { method: 'POST' });
    assert.equal(allowed.status, 201);
    assert.deepEqual(await allowed.json(), { started: true, runId: 'run-a' });
    assert.equal(discoveryCalls, 1);
  } finally {
    await app.close();
  }
});
