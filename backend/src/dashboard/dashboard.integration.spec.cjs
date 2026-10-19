const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const cookieParser = require('cookie-parser');
const { chromium, expect } = require('../../../frontend/node_modules/@playwright/test');
const { mkdirSync } = require('node:fs');
const { DashboardModule } = require('../../dist/src/dashboard/dashboard.module');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('dashboard omits module counts without effective access and reports absent subscription', { timeout: 120000 }, async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), DashboardModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false }); app.use(cookieParser());
  const db = new PrismaClient(); const suffix = randomUUID(); let tenantId, foreignTenantId, userId, packageId, browser; const extraUserIds = [];
  try {
    await app.listen(0, '127.0.0.1');
    const tenant = await db.tenant.create({ data: { name: 'Dashboard QA', slug: `dashboard-v1-${suffix}` } }); tenantId = tenant.id;
    const user = await db.user.create({ data: { name: 'Dashboard QA', email: `dashboard-v1-${suffix}@example.test`, passwordHash: 'qa-fixture', role: 'USER', tenantId } }); userId = user.id;
    const foreignTenant = await db.tenant.create({ data: { name: 'Dashboard QA Foreign', slug: `dashboard-v1-foreign-${suffix}` } }); foreignTenantId = foreignTenant.id;
    const admin = await db.user.create({ data: { name: 'Dashboard Admin QA', email: `dashboard-admin-${suffix}@example.test`, passwordHash: 'qa-fixture', role: 'ADMIN', tenantId } }); extraUserIds.push(admin.id);
    const root = await db.user.create({ data: { name: 'Dashboard Root QA', email: `dashboard-root-${suffix}@example.test`, passwordHash: 'qa-fixture', role: 'SUPER_ADMIN' } }); extraUserIds.push(root.id);

    await db.indicator.create({ data: { tenantId, value: `qa-${suffix}.example`, type: 'DOMAIN', status: 'ACTIVE', severity: 'HIGH', createdById: userId } });
    await db.indicator.create({ data: { tenantId: foreignTenantId, value: `foreign-${suffix}.example`, type: 'DOMAIN', status: 'ACTIVE', severity: 'CRITICAL' } });
    await db.alert.create({ data: { tenantId, title: 'Dashboard QA alert', status: 'OPEN' } });
    await db.case.create({ data: { tenantId, caseNumber: `QA-${suffix}`, title: 'Dashboard QA case', createdBy: userId, status: 'OPEN' } });
    await db.intelligenceEntity.create({ data: { tenantId, type: 'SOURCE', name: `Dashboard QA source ${suffix}` } });
    const token = await createAccessToken(db, userId, process.env.JWT_ACCESS_SECRET);
    const response = await fetch(`http://127.0.0.1:${app.getHttpServer().address().port}/dashboard/summary`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const summary = await response.json();
    for (const field of ['indicators', 'highRiskIndicators', 'activeAlerts', 'openCases', 'sources', 'campaigns', 'myIndicatorsCreated']) assert.equal(summary[field], null, field);
    assert.deepEqual(summary.subscription, { plan: null, status: 'NONE', persistedStatus: null });
    const adminToken = await createAccessToken(db, admin.id, process.env.JWT_ACCESS_SECRET);
    const rootToken = await createAccessToken(db, root.id, process.env.JWT_ACCESS_SECRET);
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const adminSummary = await (await fetch(`${base}/dashboard/summary?tenantId=${foreignTenantId}`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
    assert.equal(adminSummary.users, 2); assert.equal(adminSummary.indicators, null); assert.equal(adminSummary.tenantName, tenant.name);
    const rootSummary = await (await fetch(`${base}/dashboard/summary`, { headers: { Authorization: `Bearer ${rootToken}` } })).json();
    assert.equal(rootSummary.dashboardMode, 'GLOBAL'); assert.equal(rootSummary.subscription.status, 'GLOBAL');
    assert.equal(rootSummary.indicators, await db.indicator.count({ where: { status: 'ACTIVE' } }));

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const apiBase = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    let failSummary = false; let activeToken = token;
    await page.route('http://localhost:3001/**', async route => {
      const url = new URL(route.request().url());
      if (failSummary && url.pathname === '/dashboard/summary') return route.fulfill({ status: 503, json: { message: 'QA unavailable' }, headers: { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true' } });
      const upstream = await fetch(apiBase + url.pathname + url.search, { headers: { Authorization: `Bearer ${activeToken}` } });
      return route.fulfill({ status: upstream.status, contentType: upstream.headers.get('content-type') || 'application/json', body: await upstream.text(), headers: { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true' } });
    });
    const evidence = '../.omo/evidence/dashboard-v1-remediation'; mkdirSync(evidence, { recursive: true });
    const capture = async (state) => {
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 }); await page.goto('http://localhost:3000/dashboard');
        await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${state} overflow ${width}`);
        await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
        await page.screenshot({ path: `${evidence}/${state}-${width}.png`, fullPage: true });
      }
    };
    await capture('absent');
    await expect(page.getByText('Subscription: NONE')).toBeVisible();
    await expect(page.getByText('Tidak ada statistik modul yang dapat diakses.')).toBeVisible();
    await expect(page.getByText('Indicators monitored')).toHaveCount(0);
    activeToken = adminToken; await capture('admin-denied'); await expect(page.getByText('Indicators monitored')).toHaveCount(0);
    activeToken = rootToken; await capture('root-global'); await expect(page.getByText('Indicators monitored')).toBeVisible();
    activeToken = token;

    const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    assert.equal((await fetch(`${api}/dashboard/summary`)).status, 401);
    assert.equal((await fetch(`${api}/dashboard/missing`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
    const request = async () => (await fetch(`${api}/dashboard/summary`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const modules = await db.appModule.findMany({ where: { slug: { in: ['threat-intelligence', 'attack-surface-management', 'case-management'] } } });
    assert.equal(modules.length, 3);
    const pkg = await db.subscriptionPackage.create({ data: { name: `QA Plan ${suffix.slice(0, 6)}`, type: 'PREDEFINED', priceMonthly: 100, modules: { create: modules.map(module => ({ moduleId: module.id })) } } }); packageId = pkg.id;
    for (const module of modules) {
      await db.tenantModule.create({ data: { tenantId, moduleId: module.id, isEnabled: true, access: { create: [{ role: 'USER', isAllowed: true }] } } });
      const featureKeys = module.slug === 'threat-intelligence' ? ['indicator-management', 'intelligence-hub'] : module.slug === 'case-management' ? ['case-workflow'] : ['asset-management'];
      await db.userModuleAccess.create({ data: { userId, tenantId, moduleId: module.id, featureKeys } });
    }
    const renewalAt = new Date(Date.now() + 86400000);
    await db.tenantSubscription.create({ data: { tenantId, packageId, billingCycle: 'MONTHLY', priceMonthly: 100, status: 'TRIAL', renewalAt } });
    const trial = await request();
    assert.deepEqual(trial.subscription, { plan: pkg.name, status: 'TRIAL', persistedStatus: 'TRIAL' });
    assert.equal(trial.indicators, 1); assert.equal(trial.highRiskIndicators, 1);
    assert.equal(trial.activeAlerts, 1); assert.equal(trial.openCases, 1); assert.equal(trial.sources, 1); assert.equal(trial.myIndicatorsCreated, 1);
    const adminStillDenied = await (await fetch(`${api}/dashboard/summary`, { headers: { Authorization: `Bearer ${adminToken}` } })).json(); assert.equal(adminStillDenied.indicators, null); assert.equal(adminStillDenied.users, 2);
    await capture('trial'); await expect(page.getByText('Subscription: '+pkg.name+' · TRIAL')).toBeVisible(); await expect(page.getByText('Indicators monitored')).toBeVisible();
    const ti = modules.find(module => module.slug === 'threat-intelligence');
    await db.userModuleAccess.delete({ where: { userId_tenantId_moduleId: { userId, tenantId, moduleId: ti.id } } });
    const revoked = await request(); assert.equal(revoked.indicators, null); assert.equal(revoked.sources, null); assert.equal(revoked.activeAlerts, 1); assert.equal(revoked.openCases, 1);
    await db.userModuleAccess.create({ data: { userId, tenantId, moduleId: ti.id, featureKeys: ['indicator-management', 'intelligence-hub'] } });
    await db.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId, tenantId, moduleId: ti.id } }, data: { featureKeys: ['intelligence-hub'] } });
    const partial = await request(); assert.equal(partial.indicators, null); assert.equal(partial.sources, 1);
    await db.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId, tenantId, moduleId: ti.id } }, data: { featureKeys: ['indicator-management', 'intelligence-hub'] } });
    assert.equal((await request()).indicators, 1);
    await db.tenantSubscription.update({ where: { tenantId }, data: { status: 'ACTIVE', renewalAt: new Date(Date.now() - 1000) } });
    const expired = await request(); assert.deepEqual(expired.subscription, { plan: pkg.name, status: 'EXPIRED', persistedStatus: 'ACTIVE' });
    for (const field of ['indicators', 'activeAlerts', 'openCases', 'sources']) assert.equal(expired[field], null, field);
    await capture('expired'); await expect(page.getByText('Subscription: '+pkg.name+' · EXPIRED')).toBeVisible(); await expect(page.getByText('Indicators monitored')).toHaveCount(0);
    await db.tenantSubscription.update({ where: { tenantId }, data: { renewalAt } });
    const renewed = await request(); assert.equal(renewed.indicators, 1);
    assert.deepEqual(renewed.subscription, { plan: pkg.name, status: 'ACTIVE', persistedStatus: 'ACTIVE' });
    await db.case.updateMany({ where: { tenantId }, data: { status: 'RESOLVED' } });
    assert.equal((await request()).openCases, 0);
    failSummary = true; await page.goto('http://localhost:3000/dashboard'); await expect(page.getByText('Gagal memuat data dashboard')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Coba lagi' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keluar' })).toBeVisible();
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `error overflow ${width}`);
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.screenshot({ path: `${evidence}/error-${width}.png`, fullPage: true });
    }
    failSummary = false;

  } finally {
    if (browser) await browser.close();
    if (tenantId) {
      await db.authSession.deleteMany({ where: { userId: { in: [userId, ...extraUserIds] } } });
      await db.userModuleAccess.deleteMany({ where: { userId } });
      await db.tenantSubscription.deleteMany({ where: { tenantId } });
      await db.tenantModule.deleteMany({ where: { tenantId } });
      await db.indicator.deleteMany({ where: { tenantId: { in: [tenantId, foreignTenantId] } } }); await db.alert.deleteMany({ where: { tenantId } }); await db.case.deleteMany({ where: { tenantId } }); await db.intelligenceEntity.deleteMany({ where: { tenantId } });
      await db.user.deleteMany({ where: { id: { in: [userId, ...extraUserIds] } } }); await db.tenant.deleteMany({ where: { id: { in: [tenantId, foreignTenantId] } } });
      if (packageId) await db.subscriptionPackage.delete({ where: { id: packageId } });
    }
    await db.$disconnect(); await app.close();
  }
});
