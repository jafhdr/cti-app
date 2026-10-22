const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');
const cookieParser = require('cookie-parser');
const { DashboardModule } = require('../../dist/src/dashboard/dashboard.module');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('Dashboard discovery enforces tenant, module access and per-user notification reads', { timeout: 120000 }, async () => {
  const db = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), DashboardModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser()); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const marker = randomUUID(); const ids = {}; const users = [];
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const tenant = await db.tenant.create({ data: { name: 'Discovery QA', slug: `discovery-${marker}` } }); ids.tenant = tenant.id;
    const other = await db.tenant.create({ data: { name: 'Discovery Other', slug: `discovery-other-${marker}` } }); ids.other = other.id;
    for (const [key, role, tenantId] of [['alice', 'USER', ids.tenant], ['bob', 'USER', ids.tenant], ['admin', 'ADMIN', ids.tenant], ['root', 'SUPER_ADMIN', null]]) {
      const user = await db.user.create({ data: { name: key, email: `${key}-${marker}@example.test`, passwordHash: 'qa', role, tenantId } });
      ids[key] = user.id; users.push(user.id);
    }
    const modules = await db.appModule.findMany({ where: { slug: { in: ['threat-intelligence', 'attack-surface-management', 'case-management', 'appsec-posture'] } } });
    assert.equal(modules.length, 4);
    const subscription = await db.tenantSubscription.create({ data: { tenantId: ids.tenant, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } }); ids.subscription = subscription.id;
    await db.tenantCustomModule.createMany({ data: modules.map(module => ({ subscriptionId: subscription.id, moduleId: module.id })) });
    const featureKeys = { 'threat-intelligence': ['indicator-management'], 'attack-surface-management': ['asset-management'], 'case-management': ['case-workflow'], 'appsec-posture': ['application-inventory', 'finding-management'] };
    for (const module of modules) {
      const policy = await db.tenantModule.create({ data: { tenantId: ids.tenant, moduleId: module.id, isEnabled: true } });
      await db.moduleRoleAccess.createMany({ data: ['USER', 'ADMIN'].map(role => ({ tenantModuleId: policy.id, role, isAllowed: true })) });
      for (const id of [ids.alice, ids.admin]) await db.userModuleAccess.create({ data: { userId: id, tenantId: ids.tenant, moduleId: module.id, featureKeys: featureKeys[module.slug] } });
      if (module.slug === 'attack-surface-management') await db.userModuleAccess.create({ data: { userId: ids.bob, tenantId: ids.tenant, moduleId: module.id, featureKeys: featureKeys[module.slug] } });
    }
    await db.indicator.create({ data: { tenantId: ids.tenant, value: `Portal-${marker}`, type: 'DOMAIN', severity: 'HIGH', createdById: ids.alice } });
    await db.indicator.create({ data: { tenantId: ids.other, value: `Portal-foreign-${marker}`, type: 'DOMAIN', severity: 'HIGH' } });
    const asset = await db.asset.create({ data: { tenantId: ids.tenant, name: 'Portal Asset', value: 'portal.example', type: 'DOMAIN' } }); ids.asset = asset.id;
    await db.case.create({ data: { tenantId: ids.tenant, caseNumber: `QA-${marker}`, title: 'Portal Case', createdBy: ids.alice } });
    const application = await db.application.create({ data: { tenantId: ids.tenant, name: 'Portal Application' } }); ids.application = application.id;
    await db.appSecFinding.create({ data: { tenantId: ids.tenant, applicationId: application.id, title: 'Portal Finding', severity: 'HIGH', source: 'MANUAL' } });
    const alert = await db.alert.create({ data: { tenantId: ids.tenant, assetId: asset.id, source: 'ASM', sourceKey: `dashboard:${marker}`, title: 'Portal Alert', severity: 'HIGH' } }); ids.alert = alert.id;
    const notification = await db.asmNotification.findUnique({ where: { alertId: alert.id } }); assert.ok(notification);
    const tokens = Object.fromEntries(await Promise.all(users.map(async id => [id, await createAccessToken(db, id, process.env.JWT_ACCESS_SECRET)])));
    const request = (path, id, method = 'GET') => fetch(base + path, { method, headers: id ? { Authorization: `Bearer ${tokens[id]}` } : {} });
    const search = (id, tenantId = '') => request(`/dashboard/search?q=Portal${tenantId ? `&tenantId=${tenantId}` : ''}`, id);
    assert.equal((await search()).status, 401);
    assert.equal((await request('/dashboard/search?q=x', ids.alice)).status, 400);
    assert.equal((await search(ids.alice, ids.other)).status, 403);
    assert.equal((await search(ids.root)).status, 400);
    const allowed = await search(ids.alice); assert.equal(allowed.status, 200);
    const groups = (await allowed.json()).groups; assert.deepEqual(groups.map(group => group.source), ['INDICATOR', 'ASSET', 'CASE', 'APPLICATION', 'APPSEC_FINDING']);
    assert.ok(groups.every(group => group.items.length === 1));
    assert.equal((await (await search(ids.root, ids.other)).json()).groups.length, 0);
    assert.equal((await (await search(ids.root, ids.tenant)).json()).groups.length, 5);
    const bob = await (await search(ids.bob)).json(); assert.deepEqual(bob.groups.map(group => group.source), ['ASSET']);
    const admin = await (await search(ids.admin)).json(); assert.equal(admin.groups.length, 5);
    const ti = modules.find(module => module.slug === 'threat-intelligence');
    await db.userModuleAccess.delete({ where: { userId_tenantId_moduleId: { userId: ids.alice, tenantId: ids.tenant, moduleId: ti.id } } });
    assert.equal((await (await search(ids.alice)).json()).groups.some(group => group.source === 'INDICATOR'), false);
    const noticePath = '/dashboard/notifications';
    assert.equal((await request(noticePath)).status, 401);
    assert.equal((await request(noticePath, ids.root)).status, 400);
    assert.equal((await request(`${noticePath}?tenantId=${ids.other}`, ids.alice)).status, 403);
    const first = await (await request(noticePath, ids.alice)).json(); assert.equal(first.unreadCount, 1); assert.equal(first.items.length, 1);
    assert.equal((await request(`${noticePath}/${notification.id}/read`, ids.alice, 'PATCH')).status, 200);
    assert.equal((await (await request(noticePath, ids.alice)).json()).unreadCount, 0);
    assert.equal((await (await request(noticePath, ids.bob)).json()).unreadCount, 1);
    await db.alert.createMany({ data: Array.from({ length: 101 }, (_, index) => ({ tenantId: ids.tenant, assetId: ids.asset, source: 'ASM', sourceKey: `dashboard:${marker}:${index}`, title: `Bulk Portal Alert ${index}`, severity: 'HIGH' })) });
    const allUnread = await (await request(noticePath, ids.bob)).json();
    assert.equal(allUnread.items.length, 10); assert.equal(allUnread.unreadCount, 102); assert.equal(allUnread.hasMore, true);
    const foreignAlert = await db.alert.create({ data: { tenantId: ids.other, source: 'ASM', sourceKey: `foreign:${marker}`, title: 'Foreign alert', severity: 'HIGH' } });
    const foreignNotification = await db.asmNotification.findUnique({ where: { alertId: foreignAlert.id } }); assert.ok(foreignNotification);
    assert.equal((await request(`${noticePath}/${foreignNotification.id}/read`, ids.alice, 'PATCH')).status, 404);    await db.tenantSubscription.update({ where: { id: ids.subscription }, data: { renewalAt: new Date(Date.now() - 1000) } });
    assert.equal((await (await search(ids.alice)).json()).groups.length, 0);
    assert.equal((await request(noticePath, ids.alice)).status, 403);
  } finally {
    if (ids.tenant) {
      const tenantIds = [ids.tenant, ids.other].filter(Boolean);
      await db.authSession.deleteMany({ where: { userId: { in: users } } });
      await db.appSecFinding.deleteMany({ where: { tenantId: ids.tenant } });
      await db.application.deleteMany({ where: { tenantId: ids.tenant } });
      await db.alert.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await db.asset.deleteMany({ where: { tenantId: ids.tenant } });
      await db.case.deleteMany({ where: { tenantId: ids.tenant } });
      await db.indicator.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await db.userModuleAccess.deleteMany({ where: { userId: { in: users } } });
      await db.tenantModule.deleteMany({ where: { tenantId: ids.tenant } });
      await db.tenantSubscription.deleteMany({ where: { tenantId: ids.tenant } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await db.$disconnect(); await app.close();
  }
});
