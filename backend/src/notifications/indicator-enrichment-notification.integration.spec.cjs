const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find(value => value.startsWith('DATABASE_URL='));
if (!line) throw new Error('QA database configuration missing');
const url = new URL(line.slice(13).replace(/^"|"$/g, ''));
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('QA database must be local');
url.pathname = '/cti_db13_qa';
process.env.DATABASE_URL = url.toString();
const { PrismaClient } = require('@prisma/client');
const { IndicatorEnrichmentWorker } = require('../../dist/src/indicators/indicator-enrichment.worker');
const { NotificationOutboxWorker } = require('../../dist/src/notifications/notification-outbox.worker');
const { ModuleAccessService } = require('../../dist/src/auth/module-access.service');

test('Automatic TI enrichment terminal events deliver only to an eligible requester', { timeout: 120000 }, async () => {
  const db = new PrismaClient();
  const marker = randomUUID();
  let tenantId; let otherId; let moduleId; let createdModule = false;
  const access = new ModuleAccessService(db);
  const delivery = new NotificationOutboxWorker(db, access, { addInterval() {} });
  async function deliverDue() {
    await db.notificationOutbox.updateMany({ where: { tenantId, status: 'PENDING' }, data: { availableAt: new Date(Date.now() - 1000) } });
    await delivery.runOnce();
  }
  let result = { kind: 'success', enrichmentId: 'qa-new' };
  const enrichment = { runVirusTotalAutomation: async () => result };
  const producer = () => new IndicatorEnrichmentWorker(db, enrichment, { addInterval() {} });
  let serial = 0;
  try {
    const tenant = await db.tenant.create({ data: { name: 'db15 QA', slug: `db15-${marker}` } }); tenantId = tenant.id;
    const other = await db.tenant.create({ data: { name: 'db15 other', slug: `db15-other-${marker}` } }); otherId = other.id;
    const recipient = await db.user.create({ data: { tenantId, name: 'Requester', email: `requester-${marker}@example.test`, passwordHash: 'qa', role: 'USER' } });
    const inactive = await db.user.create({ data: { tenantId, name: 'Inactive', email: `inactive-${marker}@example.test`, passwordHash: 'qa', role: 'ADMIN', isActive: false } });
    const foreign = await db.user.create({ data: { tenantId: otherId, name: 'Foreign', email: `foreign-${marker}@example.test`, passwordHash: 'qa', role: 'ADMIN' } });
    const superAdmin = await db.user.create({ data: { name: 'Super', email: `super-${marker}@example.test`, passwordHash: 'qa', role: 'SUPER_ADMIN' } });
    let module = await db.appModule.findUnique({ where: { slug: 'threat-intelligence' } });
    if (!module) { module = await db.appModule.create({ data: { slug: 'threat-intelligence', name: 'QA TI', description: 'QA only', category: 'CTI' } }); createdModule = true; }
    moduleId = module.id;
    await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId, key: 'indicator-management' } }, update: {}, create: { moduleId, key: 'indicator-management', name: 'Indicator Management', description: 'QA only' } });
    const subscription = await db.tenantSubscription.create({ data: { tenantId, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
    await db.tenantCustomModule.create({ data: { subscriptionId: subscription.id, moduleId } });
    const setting = await db.tenantModule.create({ data: { tenantId, moduleId, isEnabled: true } });
    await db.moduleRoleAccess.createMany({ data: ['ADMIN', 'USER'].map(role => ({ tenantModuleId: setting.id, role, isAllowed: true })) });
    await db.userModuleAccess.create({ data: { userId: recipient.id, tenantId, moduleId, featureKeys: ['indicator-management'] } });
    await db.userModuleAccess.create({ data: { userId: inactive.id, tenantId, moduleId, featureKeys: ['indicator-management'] } });
    async function job(requestedById = recipient.id) {
      serial += 1;
      const indicator = await db.indicator.create({ data: { tenantId, type: 'IP_ADDRESS', value: `10.15.${Math.floor(serial / 255)}.${serial % 255}` } });
      const queued = await db.indicatorEnrichmentJob.create({ data: { tenantId, indicatorId: indicator.id, provider: 'VIRUSTOTAL', trigger: 'FEED_SYNC', requestedById } });
      return { indicator, queued };
    }
    const first = await job();
    await producer().runOnce();
    assert.equal((await db.indicatorEnrichmentJob.findUniqueOrThrow({ where: { id: first.queued.id } })).status, 'SUCCESS');
    const completed = await db.notificationOutbox.findFirstOrThrow({ where: { tenantId, type: 'INDICATOR_ENRICHMENT_COMPLETED' } });
    assert.deepEqual(completed.payload, { jobId: first.queued.id, indicatorId: first.indicator.id, recipientId: recipient.id, resultKind: 'NEW' });
    assert.equal(await db.auditLog.count({ where: { tenantId, action: 'INDICATOR_ENRICHMENT_COMPLETED' } }), 1);
    await Promise.all([delivery.runOnce(), new NotificationOutboxWorker(db, access, { addInterval() {} }).runOnce()]);
    await db.notificationOutbox.updateMany({ where: { tenantId, status: 'PENDING' }, data: { availableAt: new Date(Date.now() - 1000) } });
    await deliverDue();
    const notice = await db.notification.findFirstOrThrow({ where: { tenantId, dedupeKey: `INDICATOR_ENRICHMENT:${completed.id}` } });
    assert.equal(notice.route, '/indicators');
    assert.equal(notice.resourceId, first.indicator.id);
    assert.equal(await db.notificationRecipient.count({ where: { tenantId, userId: recipient.id, notificationId: notice.id } }), 1);
    assert.equal(await db.notificationRecipient.count({ where: { tenantId, userId: inactive.id } }), 0);
    const readKey = { notificationId_userId: { notificationId: notice.id, userId: recipient.id } };
    await db.notificationRecipient.update({ where: readKey, data: { readAt: new Date() } });
    await deliverDue();
    assert.ok((await db.notificationRecipient.findUniqueOrThrow({ where: readKey })).readAt);
    assert.equal(await db.notification.count({ where: { tenantId, dedupeKey: `INDICATOR_ENRICHMENT:${completed.id}` } }), 1);

    result = { kind: 'fresh', enrichmentId: 'qa-cached' };
    const cached = await job(); await producer().runOnce(); await deliverDue();
    const cachedNotice = await db.notification.findFirstOrThrow({ where: { tenantId, resourceId: cached.indicator.id } });
    assert.equal(cachedNotice.preview, 'Automatic enrichment already current');
    result = { kind: 'failure', retryable: true, retryAfterMs: 5000, message: 'QA retry' };
    const retry = await job(); await producer().runOnce();
    assert.equal((await db.indicatorEnrichmentJob.findUniqueOrThrow({ where: { id: retry.queued.id } })).status, 'PENDING');
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, payload: { path: ['jobId'], equals: retry.queued.id } } }), 0);
    await db.indicatorEnrichmentJob.update({ where: { id: retry.queued.id }, data: { availableAt: new Date(Date.now() - 1000) } });
    result = { kind: 'failure', retryable: false, message: 'QA terminal' };
    await producer().runOnce(); await deliverDue();
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, type: 'INDICATOR_ENRICHMENT_FAILED', payload: { path: ['jobId'], equals: retry.queued.id } } }), 1);
    assert.equal(await db.notification.count({ where: { tenantId, resourceId: retry.indicator.id, type: 'INDICATOR_ENRICHMENT_FAILED' } }), 1);
    await producer().runOnce(); assert.equal(await db.notificationOutbox.count({ where: { tenantId, payload: { path: ['jobId'], equals: retry.queued.id } } }), 1);

    for (const requester of [null, inactive.id, foreign.id, superAdmin.id]) {
      const item = await job(requester); await producer().runOnce(); await deliverDue();
      assert.equal(await db.notification.count({ where: { tenantId, resourceId: item.indicator.id } }), 0);
      assert.equal(await db.notificationOutbox.count({ where: { tenantId, status: 'PROCESSED', lastError: 'NO_ELIGIBLE_RECIPIENT', payload: { path: ['jobId'], equals: item.queued.id } } }), 1);
    }
    const deletedRequester = await db.user.create({ data: { tenantId, name: 'Deleted requester', email: `deleted-${marker}@example.test`, passwordHash: 'qa', role: 'USER' } });
    const deleted = await job(deletedRequester.id);
    await db.user.delete({ where: { id: deletedRequester.id } });
    await producer().runOnce(); await deliverDue();
    assert.equal(await db.notification.count({ where: { tenantId, resourceId: deleted.indicator.id } }), 0);
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, status: 'PROCESSED', lastError: 'NO_ELIGIBLE_RECIPIENT', payload: { path: ['jobId'], equals: deleted.queued.id } } }), 1);
    await db.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: recipient.id, tenantId, moduleId } }, data: { featureKeys: [] } });
    const revoked = await job(); await producer().runOnce(); await deliverDue();
    assert.equal(await db.notification.count({ where: { tenantId, resourceId: revoked.indicator.id } }), 0);
    await db.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: recipient.id, tenantId, moduleId } }, data: { featureKeys: ['indicator-management'] } });
    await db.tenantSubscription.update({ where: { id: subscription.id }, data: { renewalAt: new Date(Date.now() - 1000) } });
    const expired = await job(); await producer().runOnce(); await deliverDue();
    assert.equal(await db.notification.count({ where: { tenantId, resourceId: expired.indicator.id } }), 0);
    await db.tenantSubscription.update({ where: { id: subscription.id }, data: { renewalAt: new Date(Date.now() + 86400000) } });
    await db.tenant.update({ where: { id: tenantId }, data: { isActive: false } });
    const disabled = await job(); await producer().runOnce(); await deliverDue();
    assert.equal(await db.notification.count({ where: { tenantId, resourceId: disabled.indicator.id } }), 0);
    await db.tenant.update({ where: { id: tenantId }, data: { isActive: true } });

    await db.$executeRawUnsafe("CREATE FUNCTION db15_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'db15 rollback'; END $$");
    await db.$executeRawUnsafe('CREATE TRIGGER db15_reject_outbox_trigger BEFORE INSERT ON "NotificationOutbox" FOR EACH ROW EXECUTE FUNCTION db15_reject_outbox()');
    const rollback = await job();
    const auditCount = await db.auditLog.count({ where: { tenantId } });
    try { await assert.rejects(() => producer().runOnce()); }
    finally { await db.$executeRawUnsafe('DROP TRIGGER db15_reject_outbox_trigger ON "NotificationOutbox"'); await db.$executeRawUnsafe('DROP FUNCTION db15_reject_outbox()'); }
    assert.equal((await db.indicatorEnrichmentJob.findUniqueOrThrow({ where: { id: rollback.queued.id } })).status, 'PROCESSING');
    assert.equal(await db.auditLog.count({ where: { tenantId } }), auditCount);

    const race = await job();
    await db.indicatorEnrichmentJob.update({ where: { id: race.queued.id }, data: { status: 'PROCESSING', attempts: 1, lockedAt: new Date() } });
    const claimed = await db.indicatorEnrichmentJob.findUniqueOrThrow({ where: { id: race.queued.id } });
    await Promise.allSettled([
      producer().finish(claimed, 'SUCCESS', null, 'INDICATOR_ENRICHMENT_COMPLETED', 'NEW'),
      producer().finish(claimed, 'FAILED', 'QA terminal', 'INDICATOR_ENRICHMENT_FAILED', 'FAILED'),
    ]);
    assert.ok(['SUCCESS', 'FAILED'].includes((await db.indicatorEnrichmentJob.findUniqueOrThrow({ where: { id: race.queued.id } })).status));
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, payload: { path: ['jobId'], equals: race.queued.id } } }), 1);
    assert.equal(await db.auditLog.count({ where: { tenantId, metadata: { path: ['jobId'], equals: race.queued.id } } }), 1);

    const stale = await job();
    const oldLock = new Date(Date.now() - 61_000);
    await db.indicatorEnrichmentJob.update({ where: { id: stale.queued.id }, data: { status: 'PROCESSING', attempts: 1, lockedAt: oldLock } });
    const oldClaim = await db.indicatorEnrichmentJob.findUniqueOrThrow({ where: { id: stale.queued.id } });
    await db.indicatorEnrichmentJob.update({ where: { id: stale.queued.id }, data: { status: 'PENDING', lockedAt: null } });
    await db.indicatorEnrichmentJob.update({ where: { id: stale.queued.id }, data: { status: 'PROCESSING', attempts: 2, lockedAt: new Date() } });
    await producer().finish(oldClaim, 'FAILED', 'stale', 'INDICATOR_ENRICHMENT_FAILED', 'FAILED');
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, payload: { path: ['jobId'], equals: stale.queued.id } } }), 0);
    const newClaim = await db.indicatorEnrichmentJob.findUniqueOrThrow({ where: { id: stale.queued.id } });
    await producer().finish(newClaim, 'SUCCESS', null, 'INDICATOR_ENRICHMENT_COMPLETED', 'NEW');
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, payload: { path: ['jobId'], equals: stale.queued.id } } }), 1);
  } finally {
    if (tenantId) {
      await db.notificationOutbox.deleteMany({ where: { tenantId } });
      await db.notificationRecipient.deleteMany({ where: { tenantId } });
      await db.notification.deleteMany({ where: { tenantId } });
      await db.auditLog.deleteMany({ where: { tenantId } });
      await db.indicatorEnrichment.deleteMany({ where: { tenantId } });
      await db.indicatorEnrichmentJob.deleteMany({ where: { tenantId } });
      await db.indicator.deleteMany({ where: { tenantId } });
      await db.userModuleAccess.deleteMany({ where: { tenantId } });
      await db.tenantModule.deleteMany({ where: { tenantId } });
      await db.tenantSubscription.deleteMany({ where: { tenantId } });
      await db.user.deleteMany({ where: { OR: [{ tenantId: { in: [tenantId, otherId] } }, { email: `super-${marker}@example.test` }] } });
      await db.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } });
      if (createdModule && moduleId) await db.appModule.delete({ where: { id: moduleId } });
    }
    await db.$disconnect();
  }
});
