const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find(value => value.startsWith('DATABASE_URL='));
if (!line) throw new Error('QA database configuration missing');
const url = new URL(line.slice(13).replace(/^"|"$/g, ''));
if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('QA database must be local');
url.pathname = '/cti_db13_qa';
process.env.DATABASE_URL = url.toString();
const { PrismaClient } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const cookieParser = require('cookie-parser');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { CasesModule } = require('../../dist/src/cases/cases.module');
const { PrismaService } = require('../../dist/src/prisma.service');
const { AsmNotificationsController } = require('../../dist/src/attack-surface-management/notifications.controller');
const { createAccessToken } = require('../auth/integration-session.cjs');
const { CasesService } = require('../../dist/src/cases/cases.service');
const { ModuleAccessService } = require('../../dist/src/auth/module-access.service');
const { NotificationOutboxWorker } = require('../../dist/src/notifications/notification-outbox.worker');

test('Given isolated QA tenants, Case events deliver only eligible recipients and preserve legacy ASM', { timeout: 120000 }, async () => {
  const db = new PrismaClient();
  const marker = randomUUID();
  let tenantId; let otherId; let moduleId; let createdModule = false; let asmModuleId; let createdAsmModule = false; let app;
  const worker = new NotificationOutboxWorker(db, new ModuleAccessService(db), { addInterval() {} });
  const cases = new CasesService(db);
  async function pollDue(instance) {
    await db.notificationOutbox.updateMany({ where: { tenantId, status: 'PENDING' }, data: { availableAt: new Date(Date.now() - 1000) } });
    await instance.runOnce();
  }
  try {
    const tenant = await db.tenant.create({ data: { name: 'db13 QA', slug: `db13-${marker}` } }); tenantId = tenant.id;
    const other = await db.tenant.create({ data: { name: 'db13 other', slug: `db13-other-${marker}` } }); otherId = other.id;
    const actor = await db.user.create({ data: { tenantId, name: 'Actor', email: `actor-${marker}@example.test`, passwordHash: 'qa', role: 'ADMIN' } });
    const recipient = await db.user.create({ data: { tenantId, name: 'Recipient', email: `recipient-${marker}@example.test`, passwordHash: 'qa', role: 'USER' } });
    const denied = await db.user.create({ data: { tenantId, name: 'Denied', email: `denied-${marker}@example.test`, passwordHash: 'qa', role: 'USER' } });
    const foreign = await db.user.create({ data: { tenantId: otherId, name: 'Foreign', email: `foreign-${marker}@example.test`, passwordHash: 'qa', role: 'USER' } });
    let module = await db.appModule.findUnique({ where: { slug: 'case-management' } });
    if (!module) { module = await db.appModule.create({ data: { slug: 'case-management', name: 'QA Case', description: 'QA only', category: 'CTI' } }); createdModule = true; }
    moduleId = module.id;
    await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId, key: 'case-workflow' } }, update: {}, create: { moduleId, key: 'case-workflow', name: 'Case Workflow', description: 'QA only' } });
    const subscription = await db.tenantSubscription.create({ data: { tenantId, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
    await db.tenantCustomModule.create({ data: { subscriptionId: subscription.id, moduleId } });
    const setting = await db.tenantModule.create({ data: { tenantId, moduleId, isEnabled: true } });
    await db.moduleRoleAccess.createMany({ data: ['USER', 'ADMIN'].map(role => ({ tenantModuleId: setting.id, role, isAllowed: true })) });
    await db.userModuleAccess.create({ data: { userId: recipient.id, tenantId, moduleId, featureKeys: ['case-workflow'] } });
    await db.userModuleAccess.create({ data: { userId: actor.id, tenantId, moduleId, featureKeys: ['case-workflow'] } });
    const auth = { sub: actor.id, tenantId, role: 'ADMIN' };
    const created = await cases.create(auth, { title: 'QA Case', tenantId });
    assert.equal(await db.notificationOutbox.count({ where: { tenantId } }), 0);
    await assert.rejects(() => cases.assign(auth, created.id, foreign.id));
    assert.equal(await db.notificationOutbox.count({ where: { tenantId } }), 0);
    const assigned = await cases.assign(auth, created.id, recipient.id);
    assert.equal(assigned.assigneeId, recipient.id);
    const event = await db.notificationOutbox.findFirstOrThrow({ where: { tenantId, type: 'CASE_ASSIGNED' } });
    assert.deepEqual(await db.caseActivity.findMany({ where: { caseId: created.id, action: 'CASE_ASSIGNED' } }).then(rows => rows.length), 1);
    assert.equal(await db.auditLog.count({ where: { tenantId, action: 'CASE_ASSIGNED' } }), 1);
    await db.notificationOutbox.updateMany({ where: { tenantId, status: 'PENDING' }, data: { availableAt: new Date(Date.now() - 1000) } });
    await Promise.all([worker.runOnce(), new NotificationOutboxWorker(db, new ModuleAccessService(db), { addInterval() {} }).runOnce()]);
    const notice = await db.notification.findFirstOrThrow({ where: { tenantId, dedupeKey: `CASE_ASSIGNMENT:${event.id}` } });
    assert.equal(await db.notification.count({ where: { tenantId } }), 1);
    assert.equal(notice.route, `/cases/${created.id}?tenantId=${tenantId}`);
    const delivered = await db.notificationRecipient.findUniqueOrThrow({ where: { notificationId_userId: { notificationId: notice.id, userId: recipient.id } } });
    assert.equal(delivered.readAt, null);
    await db.notificationRecipient.update({ where: { notificationId_userId: { notificationId: notice.id, userId: recipient.id } }, data: { readAt: new Date() } });
    assert.ok((await db.notificationRecipient.findUniqueOrThrow({ where: { notificationId_userId: { notificationId: notice.id, userId: recipient.id } } })).readAt);
    await pollDue(worker); assert.equal(await db.notification.count({ where: { tenantId } }), 1);
    await assert.rejects(() => db.notificationRecipient.create({ data: { notificationId: notice.id, tenantId, userId: foreign.id } }));
    await assert.rejects(() => db.notification.create({ data: { tenantId, type: 'CASE_ASSIGNED', sourceModule: 'CASE', resourceKind: 'CASE', resourceId: created.id, preview: 'duplicate', dedupeKey: `CASE_ASSIGNMENT:${event.id}`, eventAt: new Date() } }));
    await cases.assign(auth, created.id, denied.id); await pollDue(worker);
    assert.equal(await db.notification.count({ where: { tenantId } }), 1, 'recipient without feature access is suppressed');
    const count = await db.notificationOutbox.count({ where: { tenantId } });
    await cases.assign(auth, created.id, denied.id);
    assert.equal(await db.notificationOutbox.count({ where: { tenantId } }), count, 'same assignee is a no-op');
    await cases.assign(auth, created.id, actor.id); await pollDue(worker);
    assert.equal(await db.notification.count({ where: { tenantId } }), 1, 'self assignment is suppressed');
    const createdAssigned = await cases.create(auth, { title: 'QA Preassigned', tenantId, assigneeId: recipient.id });
    await pollDue(worker);
    assert.equal(await db.notification.count({ where: { tenantId } }), 2, 'Case creation with assignee emits once');
    await cases.update(auth, createdAssigned.id, { assigneeId: actor.id }); await pollDue(worker);
    await cases.update(auth, createdAssigned.id, { assigneeId: recipient.id }); await pollDue(worker);
    assert.equal(await db.notification.count({ where: { tenantId } }), 3, 'update assignment emits a new event');
    assert.equal(await db.auditLog.count({ where: { tenantId, action: 'CASE_REASSIGNED' } }), 4);
    await db.notificationOutbox.create({ data: { tenantId, type: 'CASE_ASSIGNED', payloadVersion: 1,
      payload: { caseId: 'missing-case', recipientId: recipient.id, actorId: actor.id } } });
    await pollDue(worker);
    assert.equal(await db.notification.count({ where: { tenantId } }), 3, 'deleted or missing Case is suppressed');
    await cases.assign(auth, createdAssigned.id, actor.id); await pollDue(worker);
    await db.tenantSubscription.update({ where: { id: subscription.id }, data: { renewalAt: new Date(Date.now() - 1000) } });
    await cases.assign(auth, createdAssigned.id, recipient.id); await pollDue(worker);
    assert.equal(await db.notification.count({ where: { tenantId } }), 3, 'expired subscription suppresses recipient');
    await db.tenantSubscription.update({ where: { id: subscription.id }, data: { renewalAt: new Date(Date.now() + 86400000) } });
    await db.$executeRawUnsafe("CREATE FUNCTION db13_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'db13 forced rollback'; END $$");
    await db.$executeRawUnsafe('CREATE TRIGGER db13_reject_outbox_trigger BEFORE INSERT ON "NotificationOutbox" FOR EACH ROW EXECUTE FUNCTION db13_reject_outbox()');
    const beforeActivity = await db.caseActivity.count({ where: { caseId: createdAssigned.id } });
    const beforeAudit = await db.auditLog.count({ where: { tenantId } });
    try { await assert.rejects(() => cases.assign(auth, createdAssigned.id, denied.id)); }
    finally {
      await db.$executeRawUnsafe('DROP TRIGGER db13_reject_outbox_trigger ON "NotificationOutbox"');
      await db.$executeRawUnsafe('DROP FUNCTION db13_reject_outbox()');
    }
    assert.equal((await db.case.findUniqueOrThrow({ where: { id: createdAssigned.id } })).assigneeId, recipient.id);
    assert.equal(await db.caseActivity.count({ where: { caseId: createdAssigned.id } }), beforeActivity);
    assert.equal(await db.auditLog.count({ where: { tenantId } }), beforeAudit);
    await cases.assign(auth, createdAssigned.id, actor.id); await pollDue(worker);
    await cases.assign(auth, createdAssigned.id, recipient.id);
    const flaky = new NotificationOutboxWorker(db, { evaluate: async () => { throw new Error('QA transient access failure'); } }, { addInterval() {} });
    await pollDue(flaky);
    const retryEvent = await db.notificationOutbox.findFirstOrThrow({ where: { tenantId, status: 'PENDING', attempts: 1 } });
    assert.equal(retryEvent.lastError, 'DELIVERY_FAILED');
    await db.notificationOutbox.update({ where: { id: retryEvent.id }, data: { availableAt: new Date(Date.now() - 1000) } });
    await pollDue(worker);
    assert.equal(await db.notification.count({ where: { tenantId } }), 4, 'retry delivers once');
    await db.notificationOutbox.create({ data: { tenantId, type: 'CASE_ASSIGNED', payloadVersion: 1, status: 'PROCESSING',
      leasedUntil: new Date(Date.now() - 1000), claimToken: 'abandoned', payload: { caseId: createdAssigned.id, recipientId: recipient.id, actorId: actor.id } } });
    await pollDue(worker);
    assert.equal(await db.notification.count({ where: { tenantId } }), 5, 'expired lease is reclaimed');
    const exhausted = await db.notificationOutbox.create({ data: { tenantId, type: 'CASE_ASSIGNED', payloadVersion: 1, attempts: 4,
      payload: { caseId: createdAssigned.id, recipientId: recipient.id, actorId: actor.id } } });
    await pollDue(flaky);
    assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: exhausted.id } })).status, 'FAILED');
    await db.tenantModule.update({ where: { id: setting.id }, data: { isEnabled: false } });
    await db.notificationOutbox.create({ data: { tenantId, type: 'CASE_ASSIGNED', payloadVersion: 1,
      payload: { caseId: createdAssigned.id, recipientId: recipient.id, actorId: actor.id } } });
    await pollDue(worker);
    assert.equal(await db.notification.count({ where: { tenantId } }), 5, 'disabled module suppresses delivery');
    await db.tenantModule.update({ where: { id: setting.id }, data: { isEnabled: true } });
    const beforeConcurrent = await db.notificationOutbox.count({ where: { tenantId } });
    const outcomes = await Promise.allSettled([cases.assign(auth, created.id, recipient.id), cases.assign(auth, created.id, denied.id)]);
    const committed = outcomes.filter(result => result.status === 'fulfilled').length;
    assert.ok(committed >= 1);
    assert.equal(await db.notificationOutbox.count({ where: { tenantId } }), beforeConcurrent + committed);
    await pollDue(worker);
    await db.notificationOutbox.create({ data: { tenantId, type: 'CASE_ASSIGNED', payloadVersion: 1, payload: { bad: true } } });
    await pollDue(worker);
    assert.equal(await db.notificationOutbox.count({ where: { tenantId, status: 'FAILED', lastError: 'INVALID_PAYLOAD' } }), 1);
    assert.equal(await db.asmNotification.count({ where: { tenantId } }), 0, 'shared delivery does not write the legacy ASM store');
    let asmModule = await db.appModule.findUnique({ where: { slug: 'attack-surface-management' } });
    if (!asmModule) { asmModule = await db.appModule.create({ data: { slug: 'attack-surface-management', name: 'QA ASM', description: 'QA only', category: 'CTI' } }); createdAsmModule = true; }
    asmModuleId = asmModule.id;
    await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId: asmModuleId, key: 'asset-management' } }, update: {}, create: { moduleId: asmModuleId, key: 'asset-management', name: 'Asset Management', description: 'QA only' } });
    await db.tenantCustomModule.create({ data: { subscriptionId: subscription.id, moduleId: asmModule.id } });
    const asmSetting = await db.tenantModule.create({ data: { tenantId, moduleId: asmModule.id, isEnabled: true } });
    await db.moduleRoleAccess.create({ data: { tenantModuleId: asmSetting.id, role: 'USER', isAllowed: true } });
    await db.userModuleAccess.create({ data: { userId: recipient.id, tenantId, moduleId: asmModule.id, featureKeys: ['asset-management'] } });
    const alert = await db.alert.create({ data: { tenantId, title: 'Legacy ASM QA', source: 'ASM', sourceKey: `db13:${marker}`, severity: 'HIGH' } });
    const legacy = await db.asmNotification.findUniqueOrThrow({ where: { alertId: alert.id } });
    const ref = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, CasesModule],
      controllers: [AsmNotificationsController], providers: [PrismaService] }).compile();
    app = ref.createNestApplication({ logger: false }); app.use(cookieParser()); await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const token = await createAccessToken(db, recipient.id, process.env.JWT_ACCESS_SECRET);
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${base}/attack-surface/notifications`)).status, 401);
    const list = await fetch(`${base}/attack-surface/notifications`, { headers });
    assert.equal(list.status, 200); assert.equal((await list.json())[0].id, legacy.id);
    assert.equal((await fetch(`${base}/attack-surface/notifications/${legacy.id}/read`, { headers, method: 'PATCH' })).status, 200);
    assert.ok((await db.asmNotificationRead.findUniqueOrThrow({ where: { notificationId_userId: { notificationId: legacy.id, userId: recipient.id } } })).readAt);
    assert.equal(await db.notification.count({ where: { tenantId } }) >= 5, true, 'ASM remains separate from shared notifications');
    const httpCase = await cases.create(auth, { title: 'HTTP assignment QA', tenantId });
    const adminToken = await createAccessToken(db, actor.id, process.env.JWT_ACCESS_SECRET);
    const userAttempt = await fetch(`${base}/cases/${httpCase.id}/assign`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ assigneeId: recipient.id }) });
    assert.equal(userAttempt.status, 403);
    const httpAssigned = await fetch(`${base}/cases/${httpCase.id}/assign`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ assigneeId: recipient.id }) });
    assert.equal(httpAssigned.status, 201);
    await pollDue(worker);
    assert.equal(await db.notificationRecipient.count({ where: { tenantId, userId: recipient.id, notification: { resourceId: httpCase.id } } }), 1);
  } finally {
    if (app) await app.close();
    if (tenantId) {
      await db.alert.deleteMany({ where: { tenantId } });
      await db.notificationOutbox.deleteMany({ where: { tenantId } });
      await db.notificationRecipient.deleteMany({ where: { tenantId } });
      await db.notification.deleteMany({ where: { tenantId } });
      await db.caseActivity.deleteMany({ where: { tenantId } });
      await db.auditLog.deleteMany({ where: { tenantId } });
      await db.case.deleteMany({ where: { tenantId } });
      await db.userModuleAccess.deleteMany({ where: { tenantId } });
      await db.tenantModule.deleteMany({ where: { tenantId } });
      await db.tenantSubscription.deleteMany({ where: { tenantId } });
      await db.user.deleteMany({ where: { tenantId: { in: [tenantId, otherId] } } });
      await db.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } });
      if (createdModule && moduleId) await db.appModule.delete({ where: { id: moduleId } });
      if (createdAsmModule && asmModuleId) await db.appModule.delete({ where: { id: asmModuleId } });
    }
    await db.$disconnect();
  }
});
