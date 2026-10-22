const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find(value => value.startsWith('DATABASE_URL='));
const url = new URL(line.slice(13).replace(/^"|"$/g, ''));
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Local QA only');
url.pathname = '/cti_db13_qa';
url.searchParams.set('connection_limit', '1');
process.env.DATABASE_URL = url.toString();
const { PrismaClient } = require('@prisma/client');
const { PrismaService } = require('../../dist/src/prisma.service');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const cookieParser = require('cookie-parser');
const { DashboardModule } = require('../../dist/src/dashboard/dashboard.module');
const { createAccessToken } = require('../auth/integration-session.cjs');

for (const zone of ['UTC', 'Asia/Bangkok']) {
  test(`Notification canonical timestamps survive ${zone} PostgreSQL sessions`, { timeout: 120000 }, async () => {
    const db = new PrismaClient();
    const marker = randomUUID();
    const createdModules = [];
    let tenant;
    let app;
    try {
      await db.$queryRawUnsafe("SELECT set_config('TimeZone', $1, false)", zone);
      const settings = await db.$queryRawUnsafe('SHOW TimeZone');
      assert.equal(settings[0].TimeZone, zone);
      tenant = await db.tenant.create({ data: { name: 'db18 timestamp QA', slug: `db18-time-${marker}` } });
      const users = [];
      for (const name of ['alice', 'bob']) users.push(await db.user.create({ data: {
        name, email: `${name}-${marker}@example.test`, role: 'ADMIN', tenantId: tenant.id, passwordHash: 'qa',
      } }));
      const [alice, bob] = users;
      const subscription = await db.tenantSubscription.create({ data: {
        tenantId: tenant.id, isCustom: true, status: 'ACTIVE', billingCycle: 'MONTHLY', priceMonthly: 0,
        renewalAt: new Date(Date.now() + 86400000),
      } });
      for (const [slug, key] of [['attack-surface-management', 'asset-management'], ['case-management', 'case-workflow']]) {
        let module = await db.appModule.findUnique({ where: { slug } });
        if (!module) {
          module = await db.appModule.create({ data: { slug, name: slug, description: 'QA', category: 'CTI' } });
          createdModules.push(module.id);
        }
        await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId: module.id, key } }, update: {},
          create: { moduleId: module.id, key, name: key, description: 'QA' } });
        await db.tenantCustomModule.create({ data: { subscriptionId: subscription.id, moduleId: module.id } });
        const setting = await db.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, isEnabled: true } });
        await db.moduleRoleAccess.create({ data: { tenantModuleId: setting.id, role: 'ADMIN', isAllowed: true } });
        for (const user of users) await db.userModuleAccess.create({ data: {
          userId: user.id, tenantId: tenant.id, moduleId: module.id, featureKeys: [key],
        } });
      }
      const asset = await db.asset.create({ data: { tenantId: tenant.id, name: 'Timestamp asset', type: 'DOMAIN', value: `${marker}.test` } });
      const caseItem = await db.case.create({ data: { tenantId: tenant.id, title: 'Timestamp case', caseNumber: marker, createdBy: alice.id } });
      const makeAsm = async title => {
        const alert = await db.alert.create({ data: { tenantId: tenant.id, assetId: asset.id, title,
          severity: 'HIGH', source: 'ASM', sourceKey: `${marker}:${title}` } });
        return db.asmNotification.findUniqueOrThrow({ where: { alertId: alert.id } });
      };
      const fresh = await makeAsm('Verified trigger timestamp');
      const canonical = await db.$queryRawUnsafe('SELECT "utcCreatedAt", "createdAt", ABS(EXTRACT(EPOCH FROM ("utcCreatedAt" - timezone(\'UTC\', CURRENT_TIMESTAMP))))::float8 AS age FROM "AsmNotification" WHERE id=$1', fresh.id);
      assert.ok(canonical[0].age < 10, 'trigger stores actual UTC instant');
      assert.equal(canonical[0].createdAt.toISOString(), canonical[0].utcCreatedAt.toISOString());
      const historical = await makeAsm('Unknown historical provenance');
      const historicalAt = '2026-01-01T07:00:00.000Z';
      await db.$executeRawUnsafe('UPDATE "AsmNotification" SET "utcCreatedAt"=NULL,"createdAt"=$1::timestamptz AT TIME ZONE \'UTC\' WHERE id=$2', historicalAt, historical.id);
      const tie = '2026-01-02T03:04:05.000Z';
      const tiedAsm = await makeAsm('Explicit UTC timestamp');
      await db.$executeRawUnsafe('UPDATE "AsmNotification" SET "utcCreatedAt"=$1::timestamptz AT TIME ZONE \'UTC\',"createdAt"=$1::timestamptz AT TIME ZONE \'UTC\' WHERE id=$2', tie, tiedAsm.id);
      const shared = await db.notification.create({ data: { tenantId: tenant.id, sourceModule: 'CASE', resourceKind: 'CASE',
        resourceId: caseItem.id, type: 'CASE_ASSIGNED', eventAt: new Date(tie), preview: 'Shared tie', dedupeKey: marker } });
      await db.notificationRecipient.createMany({ data: users.map(user => ({ notificationId: shared.id, tenantId: tenant.id, userId: user.id })) });
      const ref = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), DashboardModule] })
        .overrideProvider(PrismaService).useValue(db).compile();
      app = ref.createNestApplication({ logger: false });
      app.use(cookieParser());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await app.listen(0, '127.0.0.1');
      const base = `http://127.0.0.1:${app.getHttpServer().address().port}/dashboard/notifications`;
      const tokens = new Map(await Promise.all(users.map(async user => [user.id, await createAccessToken(db, user.id, process.env.JWT_ACCESS_SECRET)])));
      const request = async (suffix = '', user = alice, method = 'GET') => {
        const response = await fetch(base + suffix, { method, headers: { Authorization: `Bearer ${tokens.get(user.id)}` } });
        assert.equal(response.status, 200, await response.clone().text());
        return response.json();
      };
      const first = await request('?limit=2');
      assert.equal(first.total, 4);
      assert.equal(first.unreadCount, 4);
      const snapshot = encodeURIComponent(first.snapshotAt);
      const second = await request(`?limit=2&page=2&snapshotAt=${snapshot}`);
      const items = [...first.items, ...second.items];
      assert.equal(new Set(items.map(item => item.id)).size, 4);
      assert.equal(second.total, 4);
      assert.equal(second.hasMore, false);
      const tied = items.filter(item => Date.parse(item.createdAt) === Date.parse(tie));
      assert.equal(tied.length, 2);
      assert.deepEqual(tied.map(item => item.id), tied.map(item => item.id).sort().reverse());
      assert.equal(new Date(items.find(item => item.id === historical.id).createdAt).toISOString(), historicalAt);
      assert.equal(items.find(item => item.id === historical.id).timestampProvenance, 'LEGACY_UNKNOWN');
      assert.equal(items.find(item => item.id === tiedAsm.id).timestampProvenance, 'UTC_VERIFIED');
      assert.equal(items.find(item => item.id === `shared:${shared.id}`).timestampProvenance, 'UTC_VERIFIED');
      const later = await makeAsm('Inserted after snapshot');
      assert.equal((await request(`?snapshotAt=${snapshot}`)).total, 4);
      assert.equal((await request()).total, 5);
      for (const id of [tiedAsm.id, `shared:${shared.id}`]) {
        const once = await request(`/${encodeURIComponent(id)}/read`, alice, 'PATCH');
        const twice = await request(`/${encodeURIComponent(id)}/read`, alice, 'PATCH');
        assert.equal(once.readAt, twice.readAt);
        assert.ok(Math.abs(Date.now() - Date.parse(once.readAt)) < 10000);
      }
      assert.equal((await request()).unreadCount, 3);
      assert.equal((await request('', bob)).unreadCount, 5);
      await db.asmNotificationRead.create({ data: { notificationId: historical.id, userId: alice.id, readAt: new Date(historicalAt) } });
      const historicalRead = await request(`/${historical.id}/read`, alice, 'PATCH');
      assert.equal(historicalRead.readAt, historicalAt, 'unknown historical read timestamp remains unchanged');
      const stored = await db.asmNotification.findUniqueOrThrow({ where: { id: historical.id } });
      assert.equal(stored.createdAt.toISOString(), historicalAt, 'historical timestamp is never rewritten');
      const policyAlert = async (label, overrides = {}) => {
        const alert = await db.alert.create({ data: { tenantId: tenant.id, assetId: asset.id, title: label,
          severity: 'HIGH', source: 'ASM', sourceKey: `${marker}:${label}`, ...overrides } });
        return db.asmNotification.findUnique({ where: { alertId: alert.id } });
      };
      await db.asmNotificationPreference.create({ data: { tenantId: tenant.id, enabled: false, minimumSeverity: 'HIGH' } });
      assert.equal(await policyAlert('Disabled high'), null);
      assert.equal(await policyAlert('Disabled critical', { severity: 'CRITICAL' }), null);
      await db.asmNotificationPreference.update({ where: { tenantId: tenant.id }, data: { enabled: true, minimumSeverity: 'CRITICAL' } });
      assert.equal(await policyAlert('Critical policy suppresses high'), null);
      assert.ok(await policyAlert('Critical policy allows critical', { severity: 'CRITICAL' }));
      assert.equal(await policyAlert('Low severity', { severity: 'LOW' }), null);
      assert.equal(await policyAlert('Non ASM source', { source: 'MANUAL', severity: 'CRITICAL' }), null);
      assert.equal(await policyAlert('Stale observation', { severity: 'CRITICAL', firstSeenAt: new Date(Date.now() - 600000) }), null);
      const afterPolicy = await request();
      assert.equal(afterPolicy.total, 6);
      assert.ok(afterPolicy.items.some(item => item.id === historical.id), 'preference changes preserve history visibility');
      assert.ok(later.id);
    } finally {
      if (app) await app.close();
      if (tenant) {
        for (const table of ['notificationRecipient', 'notification', 'alert', 'asset', 'case', 'userModuleAccess', 'tenantModule', 'tenantSubscription', 'user']) {
          await db[table].deleteMany({ where: { tenantId: tenant.id } });
        }
        await db.tenant.delete({ where: { id: tenant.id } });
      }
      await db.appModule.deleteMany({ where: { id: { in: createdModules } } });
      await db.$disconnect();
    }
  });
}
