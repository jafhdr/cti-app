const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { UsersModule } = require('../../dist/src/users/users.module');
const { ModulesModule } = require('../../dist/src/modules/modules.module');
const { ModuleAccessService } = require('../../dist/src/auth/module-access.service');
const { SubscriptionModule } = require('../../dist/src/subscription/subscription.module');
const { CasesModule } = require('../../dist/src/cases/cases.module');
const { AttackSurfaceManagementModule } = require('../../dist/src/attack-surface-management/attack-surface-management.module');
const { IndicatorsModule } = require('../../dist/src/indicators/indicators.module');
const { IndicatorFeedScheduler } = require('../../dist/src/indicators/indicator-feed.scheduler');
const { IndicatorEnrichmentWorker } = require('../../dist/src/indicators/indicator-enrichment.worker');
const { chromium, expect } = require('../../../frontend/node_modules/@playwright/test');

test('real database, authenticated HTTP and browser access hierarchy', { timeout: 240000 }, async t => {
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, UsersModule, ModulesModule, SubscriptionModule, CasesModule, AttackSurfaceManagementModule, IndicatorsModule] }).overrideProvider(IndicatorFeedScheduler).useValue({}).overrideProvider(IndicatorEnrichmentWorker).useValue({}).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser()); app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const prisma = new PrismaClient();
  const suffix = randomUUID(); const tenantIds = []; const userIds = []; let packageId; let browser;
  try {
    await app.listen(0, '127.0.0.1');
    const api = `http://localhost:${app.getHttpServer().address().port}`;
    const slugs = ['threat-intelligence', 'case-management', 'attack-surface-management', 'appsec-posture'];
    const modules = await prisma.appModule.findMany({ where: { slug: { in: slugs } }, include: { features: true } });
    assert.equal(modules.length, 4, 'Four existing module catalog entries required');
    const requiredFeatures = { 'attack-surface-management': ['asset-management', 'asset-discovery'] };
    for (const module of modules) for (const key of requiredFeatures[module.slug] ?? []) {
      assert.ok(module.features.some(feature => feature.key === key), 'Persisted ASM catalog missing ' + key);
    }
    const asm = modules.find(m => m.slug === 'attack-surface-management');
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `Access QA ${suffix}`, type: 'PREDEFINED', priceMonthly: 100, priceYearly: 1000, modules: { create: modules.map(m => ({ moduleId: m.id })) } } }); packageId = pkg.id;
    for (const name of ['A', 'B']) { const tenant = await prisma.tenant.create({ data: { name: `Access QA ${name}`, slug: `access-qa-${name.toLowerCase()}-${suffix}` } }); tenantIds.push(tenant.id); }
    const [tenantId, foreignId] = tenantIds;
    const password = `QA-${randomUUID()}`; const passwordHash = await bcrypt.hash(password, 4);
    const accounts = [];
    for (const [role, tenant] of [['SUPER_ADMIN', null], ['ADMIN', tenantId], ['USER', tenantId], ['USER', foreignId]]) {
      const account = await prisma.user.create({ data: { name: `${role} QA`, email: `${role.toLowerCase()}-${accounts.length}-${suffix}@example.test`, passwordHash, role, tenantId: tenant } });
      accounts.push(account); userIds.push(account.id);
    }
    const [root, admin, user, foreign] = accounts;
    for (const m of modules) await prisma.tenantModule.create({ data: { tenantId, moduleId: m.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    const cookies = new Map();
    async function request(account, path, method = 'GET', data) {
      const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookies.get(account.id) ?? '' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const body = await response.json(); return { status: response.status, body };
    }
    for (const account of accounts) {
      const response = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password }) });
      assert.equal(response.status, 201); cookies.set(account.id, response.headers.getSetCookie().map(c => c.split(';')[0]).join('; '));
    }
    async function subscribe() { assert.equal((await request(admin, '/subscription', 'POST', { packageId, billingCycle: 'MONTHLY', isCustom: false })).status, 201); }
    const catalogOnly = { 'appsec-posture': ['advanced-chart'], 'threat-intelligence': ['export'], 'case-management': ['alert-triage'] };
    const allAccess = modules.map(m => ({ moduleId: m.id, featureKeys: m.features.filter(f => !(catalogOnly[m.slug] ?? []).includes(f.key)).map(f => f.key) }));
    async function assign(account, access = allAccess) { const response = await request(admin, `/users/${account.id}/module-access`, 'PUT', { access }); assert.equal(response.status, 200, JSON.stringify(response.body)); }
    async function assertAccess(account, expected) {
      const response = await request(account, '/auth/me'); assert.equal(response.status, 200);
      for (const slug of slugs) assert.equal(response.body.moduleAccess.find(m => m.moduleSlug === slug).accessible, expected, slug);
    }
    await t.test('subscription absent denies grants and effective access', async () => {
      await assertAccess(admin, false);
      assert.equal((await request(admin, `/users/${user.id}/module-access`, 'PUT', { access: allAccess })).status, 400);
    });
    await subscribe();
    await t.test('ADMIN and USER need individual assignment', async () => { await assertAccess(admin, false); await assertAccess(user, false); await assign(admin); await assign(user); await assertAccess(admin, true); await assertAccess(user, true); });
    await t.test('catalog-only grants are rejected without changing implemented access', async () => {
      for (const [slug, key] of [['appsec-posture', 'advanced-chart'], ['threat-intelligence', 'export'], ['case-management', 'alert-triage']]) {
        const module = modules.find(item => item.slug === slug);
        const access = allAccess.map(entry => entry.moduleId === module.id ? { ...entry, featureKeys: [...entry.featureKeys, key] } : entry);
        assert.equal((await request(admin, `/users/${user.id}/module-access`, 'PUT', { access })).status, 400, key);
        const state = (await request(user, '/auth/me')).body.moduleAccess.find(item => item.moduleSlug === slug);
        assert.equal(state.accessible, true);
        assert.equal(state.featureKeys.includes(key), false);
      }
    });
    await t.test('stored legacy keys remain assigned but never authorize functional features', async () => {
      const accessService = app.get(ModuleAccessService);
      const actor = { sub: user.id, tenantId, role: 'USER' };
      const rootActor = { sub: root.id, tenantId: null, role: 'SUPER_ADMIN' };
      const pairs = [['appsec-posture', 'advanced-chart', 'finding-management'], ['threat-intelligence', 'export', 'indicator-management'], ['case-management', 'alert-triage', 'case-workflow']];
      try {
        for (const [slug, key, validKey] of pairs) {
          const module = modules.find(item => item.slug === slug);
          await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: user.id, tenantId, moduleId: module.id } }, data: { featureKeys: [key, validKey] } });
          const state = (await request(user, '/auth/me')).body.moduleAccess.find(item => item.moduleSlug === slug);
          assert.equal(state.assigned, true); assert.equal(state.accessible, true);
          assert.deepEqual(state.featureKeys, [key, validKey]);
          assert.deepEqual(state.features, [validKey]);
          assert.equal((await accessService.evaluate(actor, slug, [key])).accessible, false);
          assert.equal((await accessService.evaluate(actor, slug, [validKey])).accessible, true);
          assert.equal((await accessService.evaluate(rootActor, slug, [key])).accessible, false);
          assert.equal((await accessService.evaluateForTenant(rootActor, tenantId, slug, [key])).accessible, false);
          const rootState = (await request(root, '/auth/me')).body.moduleAccess.find(item => item.moduleSlug === slug);
          assert.equal(rootState.features.includes(key), false);
          assert.equal(rootState.features.includes(validKey), true);
          const adminAssignment = { userId: admin.id, tenantId, moduleId: module.id };
          await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: adminAssignment }, data: { featureKeys: [key, validKey] } });
          try {
            const adminState = (await request(admin, '/auth/me')).body.moduleAccess.find(item => item.moduleSlug === slug);
            assert.equal(adminState.assigned, true); assert.equal(adminState.accessible, true);
            assert.deepEqual(adminState.features, [validKey]);
            assert.equal((await accessService.evaluate({ sub: admin.id, tenantId, role: 'ADMIN' }, slug, [key])).accessible, false);
          } finally {
            await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: adminAssignment }, data: { featureKeys: allAccess.find(item => item.moduleId === module.id).featureKeys } });
          }
          const stored = await prisma.userModuleAccess.findUnique({ where: { userId_tenantId_moduleId: { userId: user.id, tenantId, moduleId: module.id } } });
          assert.deepEqual(stored.featureKeys, [key, validKey]);
        }
        const caseModule = modules.find(item => item.slug === 'case-management');
        await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: user.id, tenantId, moduleId: caseModule.id } }, data: { featureKeys: ['alert-triage'] } });
        const onlyLegacy = (await request(user, '/auth/me')).body.moduleAccess.find(item => item.moduleSlug === 'case-management');
        assert.equal(onlyLegacy.assigned, true); assert.equal(onlyLegacy.accessible, true);
        assert.deepEqual(onlyLegacy.featureKeys, ['alert-triage']); assert.deepEqual(onlyLegacy.features, []);
        assert.equal((await request(user, '/cases')).status, 403);
      } finally {
        for (const [slug] of pairs) {
          const module = modules.find(item => item.slug === slug);
          const original = allAccess.find(item => item.moduleId === module.id);
          await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: user.id, tenantId, moduleId: module.id } }, data: { featureKeys: original.featureKeys } });
        }
      }
    });
    await t.test('real TI Case ASM APIs allow fully entitled assigned users', async () => {
      for (const path of ['/indicators', '/cases', '/attack-surface/assets']) for (const account of [admin, user]) assert.equal((await request(account, path)).status, 200, path);
    });
    await t.test('empty features allow module but deny feature API', async () => {
      await assign(user, allAccess.map(m => ({ ...m, featureKeys: [] }))); await assertAccess(user, true);
      for (const path of ['/indicators', '/cases', '/attack-surface/assets']) assert.equal((await request(user, path)).status, 403);
      await assign(user);
    });
    await t.test('tenant disable and role denial consistently block API and auth/me', async () => {
      await request(admin, `/modules/${asm.id}/access`, 'PATCH', { isEnabled: false });
      assert.equal((await request(user, '/auth/me')).body.moduleAccess.find(m => m.moduleSlug === asm.slug).accessible, false);
      assert.equal((await request(user, '/attack-surface/assets')).status, 403);
      await request(admin, `/modules/${asm.id}/access`, 'PATCH', { isEnabled: true, access: { USER: false } });
      assert.equal((await request(user, '/attack-surface/assets')).status, 403);
      await request(admin, `/modules/${asm.id}/access`, 'PATCH', { access: { USER: true } });
    });
    await t.test('subscription status and expiry deny existing assignments', async () => {
      assert.equal((await request(root, '/subscription/status', 'PATCH', { tenantId, status: 'CANCELLED' })).status, 200);
      await assertAccess(admin, false);
      await request(root, '/subscription/status', 'PATCH', { tenantId, status: 'ACTIVE' });
      const active = await request(admin, '/subscription/my');
      assert.equal(active.body.status, 'ACTIVE');
      assert.equal(active.body.subscriptionActive, true);
      await prisma.tenantSubscription.update({ where: { tenantId }, data: { renewalAt: new Date(0) } });
      const expired = await request(admin, '/subscription/my');
      assert.equal(expired.body.status, 'EXPIRED');
      assert.equal(expired.body.persistedStatus, 'ACTIVE');
      assert.equal(expired.body.subscriptionActive, false);
      await assertAccess(user, false);
      await prisma.tenantSubscription.update({ where: { tenantId }, data: { status: 'TRIAL', renewalAt: new Date(Date.now() + 60_000) } });
      assert.equal((await request(admin, '/subscription/my')).body.status, 'TRIAL');
      await prisma.tenantSubscription.update({ where: { tenantId }, data: { renewalAt: new Date('2000-01-01T00:00:00.000Z') } });
      assert.equal((await request(admin, '/subscription/my')).body.status, 'EXPIRED');
      await subscribe();
      const renewed = await request(admin, '/subscription/my');
      assert.equal(renewed.body.status, 'ACTIVE');
      assert.equal(renewed.body.subscriptionActive, true);
    });
    await t.test('foreign tenant reads writes assignments rejected and root selection works', async () => {
      for (const path of [`/modules/configuration?tenantId=${foreignId}`, `/subscription/my?tenantId=${foreignId}`, `/users/tenant/${foreignId}/module-access`, `/users/${foreign.id}/module-access`]) assert.equal((await request(admin, path)).status, 403, path);
      assert.equal((await request(admin, `/modules/${asm.id}/access`, 'PATCH', { tenantId: foreignId, isEnabled: true })).status, 403);
      assert.equal((await request(admin, `/users/${foreign.id}/module-access`, 'PUT', { access: allAccess })).status, 403);
      assert.equal((await request(admin, `/users/tenant/${tenantId}/module-access`, 'PATCH', { assignments: [{ userId: foreign.id, access: allAccess }] })).status, 403);
      assert.equal((await request(root, `/modules/configuration?tenantId=${foreignId}`)).status, 200);
      assert.equal((await request(user, '/subscription/my')).status, 403);
    });
    await t.test('package entitlement removal overrides tenant/role/assignment and preserves revocation', async () => {
      await prisma.packageModule.delete({ where: { packageId_moduleId: { packageId, moduleId: asm.id } } });
      const config = await request(admin, '/modules/configuration'); const policy = config.body.find(m => m.id === asm.id);
      assert.equal(policy.subscriptionIncluded, false); assert.equal(policy.tenantEnabled, true); assert.equal(policy.policyAccess.ADMIN.accessible, false);
      assert.equal((await request(admin, '/attack-surface/assets')).status, 403);
      await assign(user, allAccess.filter(m => m.moduleId !== asm.id));
      assert.equal((await request(admin, `/users/${user.id}/module-access`, 'PUT', { access: allAccess })).status, 400);
      await prisma.packageModule.create({ data: { packageId, moduleId: asm.id } }); await assign(user);
    });
    await t.test('invalid assignment JSON fails before writes and inactive users have no effective access', async () => {
      assert.equal((await fetch(api + '/modules/configuration')).status, 401);
      assert.equal((await request(admin, `/users/${randomUUID()}/module-access`)).status, 404);
      assert.equal((await request(admin, '/users/' + user.id + '/module-access', 'PUT', { access: [{ moduleId: asm.id, featureKeys: 'asset-management' }] })).status, 400);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      assert.equal((await request(user, '/auth/me')).status, 401);
      const access = await request(admin, '/users/' + user.id + '/module-access');
      assert.equal(access.body.find(m => m.id === asm.id).accessible, false);
      assert.equal(access.body.find(m => m.id === asm.id).assigned, true);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
    });
    await t.test('custom yearly subscription exposes only selected entitlement', async () => {
      const ti = modules.find(m => m.slug === 'threat-intelligence');
      const saved = await request(admin, '/subscription', 'POST', { isCustom: true, moduleIds: [ti.id], billingCycle: 'YEARLY' });
      assert.equal(saved.status, 201); assert.equal(saved.body.isCustom, true); assert.equal(saved.body.billingCycle, 'YEARLY');
      const current = await request(admin, '/subscription/my');
      assert.equal(current.body.subscriptionSource, 'Custom Subscription');
      assert.equal(current.body.includedModules.find(m => m.id === asm.id).subscriptionIncluded, false);
      assert.equal(current.body.includedModules.find(m => m.id === ti.id).subscriptionIncluded, true);
      await subscribe();
    });
    await t.test('bulk writes and audit log record feature assignments', async () => {
      const response = await request(admin, `/users/tenant/${tenantId}/module-access`, 'PATCH', { assignments: [{ userId: user.id, access: allAccess }] }); assert.equal(response.status, 200);
      assert.ok(response.body.users.find(u => u.id === user.id).moduleAccessDetails.find(m => m.id === asm.id).accessible);
      const actions = await prisma.auditLog.findMany({ where: { tenantId }, select: { action: true, metadata: true } });
      for (const action of ['SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_STATUS_UPDATED', 'MODULE_TENANT_ACCESS_UPDATED', 'USER_MODULE_ACCESS_REPLACED', 'USER_MODULE_ACCESS_BULK_REPLACED']) assert.ok(actions.some(a => a.action === action), action);
      assert.ok(actions.some(a => a.action === 'USER_MODULE_ACCESS_REPLACED' && a.metadata.after.some(m => m.featureKeys.includes('asset-management'))));
    });
    await require('./asm-live-validation.cjs').validateAsmApis({ t, request, assign, admin, user, root, asm, tenantId, allAccess, prisma });
    if (process.env.ACCESS_BROWSER_QA === '1') {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const login = await context.request.post(api + '/auth/login', { data: { email: admin.email, password } }); assert.equal(login.status(), 201);
      const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('http://localhost:3001/**', route => route.continue({ url: api + new URL(route.request().url()).pathname + new URL(route.request().url()).search }));
      page.on('dialog', dialog => dialog.accept());
      const evidence = require('node:path').resolve('../.omo/evidence/3menu2');
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [path, ready] of [['/subscription', 'Subscription'], ['/modules', 'Control your security platform.'], ['/module-access', 'Access at every layer.']]) {
          await page.goto('http://localhost:3000' + path);
          await expect(page.getByRole('heading', { name: ready, exact: true })).toBeVisible({ timeout: 30000 });
          if (path === '/modules') await expect(page.locator('.module-card').first()).toBeVisible();
          assert.ok(await page.locator('.sidebar-navigation a, .sidebar-navigation button').evaluateAll(elements => elements.every(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= window.innerWidth; })), `${path} navigation clipping ${width}`);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} overflow ${width}`);
          await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
          await page.screenshot({ path: `${evidence}/${path.slice(1)}-${width}.png`, fullPage: true });
        }
        await page.locator('tbody tr').filter({ hasText: user.email }).getByRole('button', { name: 'Atur akses' }).click();
        await expect(page.locator('.access-panel .access-module').first()).toBeVisible();
        await page.locator('.access-panel').screenshot({ path: `${evidence}/assignment-panel-${width}.png` });
      }
      await page.getByRole('button', { name: 'Simpan Akses Modul' }).click(); await expect(page.getByRole('status')).toContainText('berhasil');
      await page.goto('http://localhost:3000/attack-surface/assets');
      await expect(page.getByRole('button', { name: 'Attack Surface Management', exact: true })).toBeVisible({ timeout: 30000 });
      await expect(page.getByRole('heading', { name: 'Know what is exposed.' })).toBeVisible({ timeout: 30000 });
      await page.screenshot({ path: evidence + '/asm-positive.png', fullPage: true });
      await prisma.tenantSubscription.update({ where: { tenantId }, data: { renewalAt: new Date('2000-01-01T00:00:00.000Z') } });
      await page.goto('http://localhost:3000/subscription');
      await expect(page.getByLabel('Subscription saat ini').locator('.subscription-state')).toHaveText('EXPIRED');
      await expect(page.getByLabel('Usage and entitlements').getByText('0')).toBeVisible();
      await expect(page.getByLabel('Platform capabilities').getByText('Unavailable').first()).toBeVisible();
      await page.screenshot({ path: evidence + '/subscription-expired.png', fullPage: true });
      assert.equal((await request(admin, '/auth/me')).body.moduleAccess.find(entry => entry.moduleSlug === asm.slug).accessible, false);
      assert.equal((await request(admin, '/attack-surface/assets')).status, 403);
      await subscribe();
      await page.reload();
      await expect(page.getByLabel('Subscription saat ini').locator('.subscription-state')).toHaveText('ACTIVE');
      await expect(page.getByLabel('Usage and entitlements').getByText('4')).toBeVisible();
      await page.screenshot({ path: evidence + '/subscription-renewed.png', fullPage: true });
      await assign(admin, allAccess.filter(entry => entry.moduleId !== asm.id));
      const revoked = (await request(admin, '/auth/me')).body.moduleAccess.find(entry => entry.moduleSlug === asm.slug);
      assert.equal(revoked.assigned, false);
      assert.equal(revoked.accessible, false);
      assert.equal((await request(admin, '/attack-surface/assets')).status, 403);
      await page.goto('http://localhost:3000/attack-surface/assets');
      await page.reload();
      await expect(page.getByText('Access denied', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Attack Surface Management', exact: true })).toHaveCount(0);
      await page.screenshot({ path: evidence + '/asm-negative.png', fullPage: true });
      await page.goto('http://localhost:3000/attack-surface/assets');
      await expect(page.getByText('Access denied', { exact: true })).toBeVisible();
      assert.equal(errors.length, 0, errors.join('\n'));
      await context.close();
    }
  } finally {
    if (browser) await browser.close(); await app.close();
    await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId: { in: tenantIds } }, { userId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    if (packageId) await prisma.subscriptionPackage.delete({ where: { id: packageId } });
    await prisma.$disconnect();
  }
});
