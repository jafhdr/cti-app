const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find(value => value.startsWith('DATABASE_URL='));
if (!line) throw new Error('QA database configuration missing');
const url = new URL(line.slice(13).replace(/^"|"$/g, ''));
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('QA database must be local');
url.pathname = '/cti_db13_qa'; process.env.DATABASE_URL = url.toString();
const { PrismaClient } = require('@prisma/client');
const { IndicatorFeedsService } = require('../../dist/src/indicators/indicator-feeds.service');
const { MitreThreatActorIngestionService } = require('../../dist/src/intelligence/mitre-threat-actor-ingestion.service');
const { MitreThreatActorIngestionScheduler } = require('../../dist/src/intelligence/mitre-threat-actor-ingestion.scheduler');
const { recordSyncSuccess } = require('../../dist/src/notifications/ti-sync-event');
const { NotificationOutboxWorker } = require('../../dist/src/notifications/notification-outbox.worker');
const { ModuleAccessService } = require('../../dist/src/auth/module-access.service');
const { PrismaService } = require('../../dist/src/prisma.service');
const { DashboardModule } = require('../../dist/src/dashboard/dashboard.module');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const cookieParser = require('cookie-parser');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('Feed and MITRE sync events deliver once to authorized tenant ADMINs', { timeout: 120000 }, async () => {
  const db = new PrismaClient(); const marker = randomUUID();
  let tenantId; let foreignId; let moduleId; let createdModule = false; let app;
  try {
    tenantId = (await db.tenant.create({ data: { name: 'Sync QA', slug: `sync-${marker}` } })).id;
    foreignId = (await db.tenant.create({ data: { name: 'Sync foreign', slug: `sync-foreign-${marker}` } })).id;
    const user = (name, role, tenant = tenantId, isActive = true) => db.user.create({ data: { tenantId: tenant, name,
      email: `${name}-${marker}@example.test`, passwordHash: 'qa', role, isActive } });
    const admin = await user('admin', 'ADMIN'); const feedOnly = await user('feedonly', 'ADMIN');
    const denied = await user('denied', 'ADMIN');
    const ordinary = await user('ordinary', 'USER'); const inactive = await user('inactive', 'ADMIN', tenantId, false);
    const foreign = await user('foreign', 'ADMIN', foreignId);
    let module = await db.appModule.findUnique({ where: { slug: 'threat-intelligence' } });
    if (!module) { module = await db.appModule.create({ data: { slug: 'threat-intelligence', name: 'QA TI', description: 'QA', category: 'CTI' } }); createdModule = true; }
    moduleId = module.id;
    await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId, key: 'indicator-management' } }, update: {},
      create: { moduleId, key: 'indicator-management', name: 'Indicator Management', description: 'QA' } });
    await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId, key: 'intelligence-hub' } }, update: {},
      create: { moduleId, key: 'intelligence-hub', name: 'Intelligence Hub', description: 'QA' } });
    const subscription = await db.tenantSubscription.create({ data: { tenantId, isCustom: true, billingCycle: 'MONTHLY',
      priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
    await db.tenantCustomModule.create({ data: { subscriptionId: subscription.id, moduleId } });
    const setting = await db.tenantModule.create({ data: { tenantId, moduleId, isEnabled: true } });
    await db.moduleRoleAccess.createMany({ data: ['ADMIN', 'USER'].map(role => ({ tenantModuleId: setting.id, role, isAllowed: true })) });
    for (const recipient of [admin, feedOnly, ordinary, inactive]) await db.userModuleAccess.create({ data: { userId: recipient.id, tenantId,
      moduleId, featureKeys: recipient.id === admin.id ? ['indicator-management', 'intelligence-hub'] : ['indicator-management'] } });
    const source = await db.intelligenceSource.create({ data: { tenantId, name: 'URLhaus Feed', sourceType: 'COMMUNITY',
      provider: 'URLhaus', createdBy: admin.id } });
    const actor = { sub: admin.id, tenantId, role: 'ADMIN' };
    const feed = new IndicatorFeedsService(db, {}, { get: () => undefined });
    const normalized = (value, severity) => [{ type: 'URL', value, severity, confidence: 90, tags: ['qa'], description: 'QA' }];
    const value = `https://sync-${marker}.example.test/a`;
    const first = await feed.upsertIndicators(actor, tenantId, source.id, 'URLhaus', normalized(value, 'HIGH'));
    assert.deepEqual(first, { created: 1, updated: 0, skipped: 0, received: 1 });
    const events = () => db.notificationOutbox.findMany({ where: { tenantId, type: { in: ['TI_SYNC_COMPLETED', 'TI_SYNC_FAILED'] } } });
    assert.equal((await events()).length, 1);
    const repeated = await feed.upsertIndicators(actor, tenantId, source.id, 'URLhaus', normalized(value, 'HIGH'));
    assert.deepEqual(repeated, { created: 0, updated: 0, skipped: 1, received: 1 });
    assert.equal((await events()).length, 1, 'zero-change run has no event');
    await feed.upsertIndicators(actor, tenantId, source.id, 'URLhaus', normalized(value, 'CRITICAL'));
    assert.equal((await events()).filter(item => item.type === 'TI_SYNC_COMPLETED').length, 2, 'later changed run gets summary');
    const blocked = db.$extends({ query: { notificationOutbox: { createMany() { throw new Error('QA outbox unavailable'); } } } });
    const rollbackFeed = new IndicatorFeedsService(blocked, {}, { get: () => undefined });
    const rollbackValue = `https://rollback-${marker}.example.test/a`;
    await assert.rejects(() => rollbackFeed.upsertIndicators(actor, tenantId, source.id, 'URLhaus', normalized(rollbackValue, 'HIGH')));
    assert.equal(await db.indicator.count({ where: { tenantId, value: rollbackValue } }), 0, 'outbox failure rolls back indicator insert');
    assert.equal((await events()).filter(item => item.type === 'TI_SYNC_COMPLETED').length, 2);
    const identity = { tenantId, userId: admin.id, workflow: 'FEED', sourceKey: `FEED:${source.id}`, sourceName: 'URLhaus' };
    const failingFeed = new IndicatorFeedsService(db, { isConfigured: () => true, fetch: async () => { throw new Error('QA offline'); } },
      { get: () => undefined });
    const failRun = () => failingFeed.syncProvider(actor, tenantId, 'URLHAUS');
    assert.equal((await failRun()).status, 'FAILED'); assert.equal((await failRun()).status, 'FAILED');
    assert.equal((await events()).filter(item => item.type === 'TI_SYNC_FAILED').length, 0, 'transient failures suppressed');
    assert.equal((await failRun()).status, 'FAILED'); assert.equal((await failRun()).status, 'FAILED');
    assert.equal((await events()).filter(item => item.type === 'TI_SYNC_FAILED').length, 1, 'repeated failure condition deduplicated');
    await db.$transaction(tx => recordSyncSuccess(tx, { ...identity, runId: randomUUID(), created: 0, updated: 0 }));
    assert.equal((await failRun()).status, 'FAILED'); assert.equal((await failRun()).status, 'FAILED');
    assert.equal((await failRun()).status, 'FAILED');
    assert.equal((await events()).filter(item => item.type === 'TI_SYNC_FAILED').length, 2, 'recovered then repeated failure creates a new alert');
    const mitre = new MitreThreatActorIngestionService(
      { fetchEnterpriseBundle: async () => ({ objects: [{ type: 'intrusion-set', id: `intrusion-set--${marker}`, name: 'QA actor' }] }) },
      { batch: async () => ({ created: 1, updated: 0 }) }, db);
    assert.deepEqual(await mitre.ingest(actor, undefined, true), { total: 1, created: 1, updated: 0, failed: 0 });
    assert.equal((await events()).filter(item => item.type === 'TI_SYNC_COMPLETED').length, 3);
    const mitreRun = (await events()).find(item => item.type === 'TI_SYNC_COMPLETED' && item.payload.workflow === 'MITRE').payload.runId;
    await db.$transaction(tx => recordSyncSuccess(tx, { tenantId, userId: admin.id, workflow: 'MITRE',
      sourceKey: 'MITRE:ATTACK', sourceName: 'MITRE ATT&CK', runId: mitreRun, created: 1, updated: 0 }));
    assert.equal((await events()).filter(item => item.type === 'TI_SYNC_COMPLETED').length, 3,
      'reprocessing the same run does not duplicate its summary');
    const scheduledDb = new Proxy(db, { get(target, key) {
      if (key === 'tenant') return { findMany: async () => [{ id: tenantId, users: [{ id: admin.id, role: 'ADMIN' }] }] };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const scheduler = new MitreThreatActorIngestionScheduler({ get: () => undefined }, { addInterval() {} }, scheduledDb,
      { ingest: async () => { throw new Error('QA MITRE unavailable'); } });
    await scheduler.run(); await scheduler.run(); await scheduler.run(); await scheduler.run();
    assert.equal((await events()).filter(item => item.type === 'TI_SYNC_FAILED').length, 3,
      'MITRE failure alert joins two distinct feed failure conditions');
    const worker = new NotificationOutboxWorker(db, new ModuleAccessService(db), { addInterval() {} });
    await worker.runOnce();
    const notices = await db.notification.findMany({ where: { tenantId, type: { in: ['TI_SYNC_COMPLETED', 'TI_SYNC_FAILED'] } },
      include: { recipients: true } });
    assert.equal(notices.length, 6);
    assert.ok(notices.every(notice => notice.recipients.some(recipient => recipient.userId === admin.id)));
    assert.ok(notices.filter(notice => notice.route === '/threat-intelligence/mitre-attack')
      .every(notice => notice.recipients.length === 1));
    assert.ok(notices.filter(notice => notice.route === '/threat-intelligence/feeds')
      .every(notice => notice.recipients.some(recipient => recipient.userId === feedOnly.id)));
    assert.ok(notices.some(notice => notice.route === '/threat-intelligence/mitre-attack' && notice.preview.includes('1 new threat actor')));
    assert.ok(notices.some(notice => notice.type === 'TI_SYNC_FAILED' && notice.priority === 'HIGH'));
    const ref = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), DashboardModule] })
      .overrideProvider(PrismaService).useValue(db).compile();
    app = ref.createNestApplication({ logger: false }); app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const token = await createAccessToken(db, admin.id, process.env.JWT_ACCESS_SECRET);
    const feedOnlyToken = await createAccessToken(db, feedOnly.id, process.env.JWT_ACCESS_SECRET);
    const foreignToken = await createAccessToken(db, foreign.id, process.env.JWT_ACCESS_SECRET);
    const request = (path, auth = token, method = 'GET') => fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}` } });
    const response = await request('/dashboard/notifications'); assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json(); assert.equal(body.unreadCount, 7, 'existing Indicator risk event remains visible');
    assert.equal(body.items.filter(item => item.type === 'TI_SYNC_COMPLETED' || item.type === 'TI_SYNC_FAILED').length, 6);
    assert.ok(body.items.some(item => item.title === 'Threat Intelligence Synced' && item.route === '/threat-intelligence/mitre-attack'));
    assert.ok(body.items.some(item => item.title === 'Threat Intelligence Sync Needs Attention' && item.route === '/threat-intelligence/feeds'));
    const feedOnlyBody = await (await request('/dashboard/notifications', feedOnlyToken)).json();
    assert.equal(feedOnlyBody.items.some(item => item.route === '/threat-intelligence/mitre-attack'), false);
    const read = await request(`/dashboard/notifications/${encodeURIComponent(body.items[0].id)}/read`, token, 'PATCH');
    assert.equal(read.status, 200, await read.clone().text());
    assert.equal((await (await request('/dashboard/notifications')).json()).unreadCount, 6);
    assert.equal((await request(`/dashboard/notifications/${encodeURIComponent(body.items[0].id)}/read`, foreignToken, 'PATCH')).status, 403);
    assert.equal(await db.notificationRecipient.count({ where: { tenantId, userId: { in: [denied.id, ordinary.id, inactive.id, foreign.id] } } }), 0);
  } finally {
    if (app) await app.close();
    if (tenantId) {
      await db.notificationOutbox.deleteMany({ where: { tenantId } });
      await db.notificationRecipient.deleteMany({ where: { tenantId } });
      await db.notification.deleteMany({ where: { tenantId } });
      await db.auditLog.deleteMany({ where: { tenantId } });
      await db.indicatorSourceObservation.deleteMany({ where: { tenantId } });
      await db.indicator.deleteMany({ where: { tenantId } });
      await db.intelligenceSource.deleteMany({ where: { tenantId } });
      await db.userModuleAccess.deleteMany({ where: { tenantId } });
      await db.tenantModule.deleteMany({ where: { tenantId } });
      await db.tenantSubscription.deleteMany({ where: { tenantId } });
      await db.user.deleteMany({ where: { tenantId: { in: [tenantId, foreignId] } } });
      await db.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } });
      if (createdModule) await db.appModule.delete({ where: { id: moduleId } });
    }
    await db.$disconnect();
  }
});
