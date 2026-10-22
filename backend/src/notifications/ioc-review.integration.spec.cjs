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
const { IocCandidatesService } = require('../../dist/src/telegram/ioc-candidates.service');
const { NotificationOutboxWorker } = require('../../dist/src/notifications/notification-outbox.worker');
const { DashboardNotificationsService } = require('../../dist/src/dashboard/dashboard-notifications.service');
const { ModuleAccessService } = require('../../dist/src/auth/module-access.service');

test('new Telegram candidates create one authorized review notice per processing batch', { timeout: 120000 }, async () => {
  const db = new PrismaClient(); const marker = randomUUID(); let tenantId; let otherTenantId; let createdModuleId;
  try {
    const tenant = await db.tenant.create({ data: { name: 'IOC QA', slug: `ioc-${marker}` } }); tenantId = tenant.id;
    const other = await db.tenant.create({ data: { name: 'IOC Other QA', slug: `ioc-other-${marker}` } }); otherTenantId = other.id;
    const user = (name, role, scope = tenantId) => db.user.create({ data: { tenantId: scope, name,
      email: `${name}-${marker}@example.test`, passwordHash: 'qa', role, isActive: true } });
    const admin = await user('reviewer', 'ADMIN'); const denied = await user('denied', 'ADMIN');
    const ordinary = await user('ordinary', 'USER'); const foreign = await user('foreign', 'ADMIN', otherTenantId);
    let module = await db.appModule.findUnique({ where: { slug: 'threat-intelligence' } });
    if (!module) { module = await db.appModule.create({ data: { slug: 'threat-intelligence', name: 'QA TI', description: 'QA', category: 'CTI' } }); createdModuleId = module.id; }
    await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId: module.id, key: 'indicator-management' } }, update: {},
      create: { moduleId: module.id, key: 'indicator-management', name: 'Indicator Management', description: 'QA' } });
    const subscription = await db.tenantSubscription.create({ data: { tenantId, isCustom: true, billingCycle: 'MONTHLY',
      priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
    await db.tenantCustomModule.create({ data: { subscriptionId: subscription.id, moduleId: module.id } });
    const setting = await db.tenantModule.create({ data: { tenantId, moduleId: module.id, isEnabled: true } });
    await db.moduleRoleAccess.create({ data: { tenantModuleId: setting.id, role: 'ADMIN', isAllowed: true } });
    await db.userModuleAccess.create({ data: { userId: admin.id, tenantId, moduleId: module.id, featureKeys: ['indicator-management'] } });
    const source = await db.intelligenceSource.create({ data: { tenantId, name: 'IOC QA Telegram', sourceType: 'COMMUNITY',
      provider: 'Telegram', createdBy: admin.id } });
    for (let index = 0; index < 3; index += 1) await db.telegramStagingMessage.create({ data: { tenantId,
      intelligenceSourceId: source.id, telegramChatId: `qa-${marker}`, channelTitle: 'QA', messageId: `${index}`,
      updateId: `${marker}-${index}`, messageTimestamp: new Date(), content: `203.0.113.${index + 1}`,
      contentHash: `${marker}-${index}` } });
    const candidates = new IocCandidatesService(db);
    assert.deepEqual(await candidates.processPending(), { processed: 3, failed: 0 });
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, type: 'IOC_CANDIDATES_PENDING_REVIEW' } }), 1);
    assert.deepEqual(await candidates.processPending(), { processed: 0, failed: 0 });
    await db.telegramStagingMessage.create({ data: { tenantId, intelligenceSourceId: source.id,
      telegramChatId: `qa-${marker}`, channelTitle: 'QA', messageId: 'repeat', updateId: `${marker}-repeat`,
      messageTimestamp: new Date(), content: '203.0.113.1', contentHash: `${marker}-repeat` } });
    assert.deepEqual(await candidates.processPending(), { processed: 1, failed: 0 });
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, type: 'IOC_CANDIDATES_PENDING_REVIEW' } }), 1);
    const worker = new NotificationOutboxWorker(db, new ModuleAccessService(db), { addInterval() {} });
    await worker.runOnce();
    const notices = await db.notification.findMany({ where: { tenantId, type: 'IOC_CANDIDATES_PENDING_REVIEW' }, include: { recipients: true } });
    assert.equal(notices.length, 1);
    assert.deepEqual(notices[0].recipients.map(row => row.userId), [admin.id]);
    assert.equal(notices[0].route, '/threat-intelligence/ioc-candidates');
    assert.equal(notices[0].preview.includes('203.0.113'), false);
    const dashboard = new DashboardNotificationsService(db, new ModuleAccessService(db));
    const actor = { sub: admin.id, tenantId, role: 'ADMIN' };
    const feed = await dashboard.list(actor, { page: 1, limit: 20 });
    const item = feed.items.find(row => row.type === 'IOC_CANDIDATES_PENDING_REVIEW');
    assert.ok(item); assert.equal(item.route, '/threat-intelligence/ioc-candidates');
    assert.equal(item.readAt, null);
    await dashboard.markRead(actor, item.id);
    assert.ok((await dashboard.list(actor, { page: 1, limit: 20 })).items.find(row => row.id === item.id).readAt);
    const rejected = await db.iocCandidate.findFirstOrThrow({ where: { tenantId, status: 'PENDING' } });
    await candidates.reject(actor, rejected.id);
    await assert.rejects(() => candidates.reject(actor, rejected.id));
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, type: { in: ['IOC_CANDIDATE_APPROVED', 'IOC_CANDIDATE_REJECTED'] } } }), 0);
    assert.equal((await db.notificationRecipient.count({ where: { userId: { in: [denied.id, ordinary.id, foreign.id] } } })), 0);
  } finally {
    if (tenantId) {
      await db.notificationOutbox.deleteMany({ where: { tenantId } });
      await db.notificationRecipient.deleteMany({ where: { tenantId } });
      await db.notification.deleteMany({ where: { tenantId } });
      await db.auditLog.deleteMany({ where: { tenantId } });
      await db.iocObservation.deleteMany({ where: { tenantId } });
      await db.iocCandidate.deleteMany({ where: { tenantId } });
      await db.telegramStagingMessage.deleteMany({ where: { tenantId } });
      await db.intelligenceSource.deleteMany({ where: { tenantId } });
      await db.userModuleAccess.deleteMany({ where: { tenantId } });
      await db.tenantModule.deleteMany({ where: { tenantId } });
      await db.tenantSubscription.deleteMany({ where: { tenantId } });
      await db.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
      await db.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
      if (createdModuleId) await db.appModule.delete({ where: { id: createdModuleId } });
    }
    await db.$disconnect();
  }
});
