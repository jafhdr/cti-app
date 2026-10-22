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
const { FindingsService } = require('../../dist/src/appsec/findings.service');
const { AppSecTenantContext } = require('../../dist/src/appsec/tenant-context');
const { ModuleAccessService } = require('../../dist/src/auth/module-access.service');
const { NotificationOutboxWorker } = require('../../dist/src/notifications/notification-outbox.worker');

test('AppSec high risk events and ADMIN delivery on PostgreSQL QA', { timeout: 120000 }, async () => {
  const db = new PrismaClient();
  const marker = randomUUID();
  let tenantId; let otherId; let moduleId; let moduleCreated = false;
  const findings = new FindingsService(db, new AppSecTenantContext(db));
  const worker = new NotificationOutboxWorker(db, new ModuleAccessService(db), { addInterval() {} });
  try {
    const tenant = await db.tenant.create({ data: { name: 'db14 QA', slug: `db14-${marker}` } }); tenantId = tenant.id;
    const other = await db.tenant.create({ data: { name: 'db14 other', slug: `db14-other-${marker}` } }); otherId = other.id;
    const actor = await db.user.create({ data: { tenantId, name: 'Actor', email: `actor-${marker}@example.test`, passwordHash: 'qa', role: 'ADMIN' } });
    const admin = await db.user.create({ data: { tenantId, name: 'Admin', email: `admin-${marker}@example.test`, passwordHash: 'qa', role: 'ADMIN' } });
    const inactive = await db.user.create({ data: { tenantId, name: 'Inactive', email: `inactive-${marker}@example.test`, passwordHash: 'qa', role: 'ADMIN', isActive: false } });
    const noFeature = await db.user.create({ data: { tenantId, name: 'No feature', email: `no-feature-${marker}@example.test`, passwordHash: 'qa', role: 'ADMIN' } });
    const normal = await db.user.create({ data: { tenantId, name: 'User', email: `user-${marker}@example.test`, passwordHash: 'qa', role: 'USER' } });
    await db.user.create({ data: { tenantId: otherId, name: 'Foreign', email: `foreign-${marker}@example.test`, passwordHash: 'qa', role: 'ADMIN' } });
    let module = await db.appModule.findUnique({ where: { slug: 'appsec-posture' } });
    if (!module) { module = await db.appModule.create({ data: { slug: 'appsec-posture', name: 'QA AppSec', description: 'QA only', category: 'APPSEC' } }); moduleCreated = true; }
    moduleId = module.id;
    await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId, key: 'finding-management' } }, update: {}, create: { moduleId, key: 'finding-management', name: 'Finding Management', description: 'QA only' } });
    const subscription = await db.tenantSubscription.create({ data: { tenantId, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
    await db.tenantCustomModule.create({ data: { subscriptionId: subscription.id, moduleId } });
    const setting = await db.tenantModule.create({ data: { tenantId, moduleId, isEnabled: true } });
    await db.moduleRoleAccess.create({ data: { tenantModuleId: setting.id, role: 'ADMIN', isAllowed: true } });
    for (const account of [actor, admin, inactive]) await db.userModuleAccess.create({ data: { userId: account.id, tenantId, moduleId, featureKeys: ['finding-management'] } });
    await db.userModuleAccess.create({ data: { userId: noFeature.id, tenantId, moduleId, featureKeys: [] } });
    const application = await db.application.create({ data: { tenantId, name: 'QA Portal' } });
    const auth = { sub: actor.id, tenantId, role: 'ADMIN' };
    const input = severity => ({ applicationId: application.id, title: `QA ${severity}`, severity });
    for (const severity of ['LOW', 'MEDIUM']) await findings.create(auth, input(severity));
    assert.equal(await db.notificationOutbox.count({ where: { tenantId } }), 0);
    const critical = await findings.create(auth, input('CRITICAL'));
    const high = await findings.create(auth, input('HIGH'));
    await findings.create(auth, { ...input('HIGH'), sourceKey: 'one-source' });
    await assert.rejects(() => findings.create(auth, { ...input('HIGH'), sourceKey: 'one-source' }));
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, type: 'APPSEC_FINDING_CREATED_HIGH_RISK' } }), 3);
    await Promise.all([worker.runOnce(), new NotificationOutboxWorker(db, new ModuleAccessService(db), { addInterval() {} }).runOnce()]);
    await db.notificationOutbox.updateMany({ where: { tenantId, status: 'PENDING' }, data: { availableAt: new Date(Date.now() - 1000) } });
    await worker.runOnce();
    assert.equal(await db.notification.count({ where: { tenantId } }), 3);
    assert.equal(await db.notificationRecipient.count({ where: { tenantId, userId: admin.id } }), 3);
    for (const account of [actor, inactive, noFeature, normal]) assert.equal(await db.notificationRecipient.count({ where: { tenantId, userId: account.id } }), 0);
    const notice = await db.notification.findFirstOrThrow({ where: { tenantId, resourceId: critical.id } });
    assert.equal(notice.route, `/appsec/findings/${critical.id}?tenantId=${tenantId}`);
    const key = { notificationId_userId: { notificationId: notice.id, userId: admin.id } };
    await db.notificationRecipient.update({ where: key, data: { readAt: new Date() } });
    await worker.runOnce();
    assert.ok((await db.notificationRecipient.findUniqueOrThrow({ where: key })).readAt);
    const before = await db.notificationOutbox.count({ where: { tenantId } });
    await findings.update(auth, high.id, { title: 'Ordinary edit', status: 'OPEN' });
    await findings.update(auth, high.id, { status: 'IN_PROGRESS' });
    assert.equal(await db.notificationOutbox.count({ where: { tenantId } }), before);
    for (const terminal of ['RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE']) {
      await findings.update(auth, high.id, { status: terminal, resolution: 'Reviewed' });
      await assert.rejects(() => findings.update(auth, high.id, { status: 'IN_PROGRESS' }));
      await findings.update(auth, high.id, { status: 'OPEN' });
    }
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, type: 'APPSEC_FINDING_REOPENED' } }), 3);
    await worker.runOnce();
    assert.equal(await db.notification.count({ where: { tenantId, type: 'APPSEC_FINDING_REOPENED' } }), 3);
    await db.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: admin.id, tenantId, moduleId } }, data: { featureKeys: [] } });
    await findings.create(auth, input('HIGH')); await worker.runOnce();
    assert.equal(await db.notification.count({ where: { tenantId } }), 6, 'revoked feature suppresses delivery');
    await db.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: admin.id, tenantId, moduleId } }, data: { featureKeys: ['finding-management'] } });
    await db.tenantSubscription.update({ where: { id: subscription.id }, data: { renewalAt: new Date(Date.now() - 1000) } });
    await findings.create(auth, input('HIGH')); await worker.runOnce();
    assert.equal(await db.notification.count({ where: { tenantId } }), 6, 'expired subscription suppresses delivery');
    await db.tenantSubscription.update({ where: { id: subscription.id }, data: { renewalAt: new Date(Date.now() + 86400000) } });
    const retryFinding = await findings.create(auth, input('CRITICAL'));
    const transient = new NotificationOutboxWorker(db, { evaluate: async () => { throw new Error('QA transient access failure'); } }, { addInterval() {} });
    await transient.runOnce();
    const retryEvent = await db.notificationOutbox.findFirstOrThrow({ where: { tenantId, status: 'PENDING', attempts: 1 } });
    assert.equal(retryEvent.lastError, 'DELIVERY_FAILED');
    await db.notificationOutbox.update({ where: { id: retryEvent.id }, data: { availableAt: new Date(Date.now() - 1000) } });
    await worker.runOnce();
    assert.equal(await db.notification.count({ where: { tenantId, resourceId: retryFinding.id } }), 1);
    const recovered = await db.notificationOutbox.create({ data: { tenantId, type: 'APPSEC_FINDING_REOPENED', payloadVersion: 1,
      status: 'PROCESSING', claimToken: 'abandoned', leasedUntil: new Date(Date.now() - 1000), payload: { findingId: high.id, actorId: actor.id } } });
    await worker.runOnce();
    assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: recovered.id } })).status, 'PROCESSED');
    assert.equal(await db.notification.count({ where: { tenantId, dedupeKey: `APPSEC_FINDING:${recovered.id}` } }), 1);
    await db.notificationOutbox.create({ data: { tenantId, type: 'APPSEC_FINDING_REOPENED', payloadVersion: 1, payload: { findingId: 'missing', actorId: actor.id } } });
    await worker.runOnce(); assert.equal(await db.notification.count({ where: { tenantId } }), 8);
    await db.notificationOutbox.create({ data: { tenantId, type: 'APPSEC_FINDING_REOPENED', payloadVersion: 1, payload: { bad: true } } });
    await worker.runOnce(); assert.equal(await db.notificationOutbox.count({ where: { tenantId, status: 'FAILED', lastError: 'INVALID_PAYLOAD' } }), 1);
    await db.$executeRawUnsafe("CREATE FUNCTION db14_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'db14 rollback'; END $$");
    await db.$executeRawUnsafe('CREATE TRIGGER db14_reject_outbox_trigger BEFORE INSERT ON "NotificationOutbox" FOR EACH ROW EXECUTE FUNCTION db14_reject_outbox()');
    const audits = await db.auditLog.count({ where: { tenantId } });
    try { await assert.rejects(() => findings.create(auth, input('CRITICAL'))); }
    finally { await db.$executeRawUnsafe('DROP TRIGGER db14_reject_outbox_trigger ON "NotificationOutbox"'); await db.$executeRawUnsafe('DROP FUNCTION db14_reject_outbox()'); }
    assert.equal(await db.auditLog.count({ where: { tenantId } }), audits);
    assert.equal(await db.appSecFinding.count({ where: { tenantId, severity: 'CRITICAL' } }), 2);
  } finally {
    if (tenantId) {
      await db.notificationOutbox.deleteMany({ where: { tenantId } });
      await db.notificationRecipient.deleteMany({ where: { tenantId } });
      await db.notification.deleteMany({ where: { tenantId } });
      await db.auditLog.deleteMany({ where: { tenantId } });
      await db.appSecFinding.deleteMany({ where: { tenantId } });
      await db.application.deleteMany({ where: { tenantId } });
      await db.userModuleAccess.deleteMany({ where: { tenantId } });
      await db.tenantModule.deleteMany({ where: { tenantId } });
      await db.tenantSubscription.deleteMany({ where: { tenantId } });
      await db.user.deleteMany({ where: { tenantId: { in: [tenantId, otherId] } } });
      await db.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } });
      if (moduleCreated && moduleId) await db.appModule.delete({ where: { id: moduleId } });
    }
    await db.$disconnect();
  }
});
