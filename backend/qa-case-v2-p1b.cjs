const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require('./dist/src/app.module.js');

process.env.JWT_ACCESS_SECRET = 'case-v2-p1b-qa-access-secret';
process.env.JWT_REFRESH_SECRET = 'case-v2-p1b-qa-refresh-secret';

const prisma = new PrismaClient();
const password = 'CaseQaPass123!';
const marker = `p1b-${Date.now()}`;

async function setupTenant(label) {
  const tenant = await prisma.tenant.create({ data: { name: `${label} ${marker}`, slug: `${label}-${marker}` } });
  const hash = await bcrypt.hash(password, 10);
  const users = {};
  for (const name of ['ADMIN', 'USER', 'SECOND']) {
    users[name] = await prisma.user.create({ data: { name: `${label} ${name}`, email: `${label}-${name.toLowerCase()}-${marker}@example.test`, passwordHash: hash, role: name === 'SECOND' ? 'USER' : name, tenantId: tenant.id } });
  }
  const team = await prisma.subscriptionPackage.findUniqueOrThrow({ where: { name: 'Team' } });
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId: team.id, billingCycle: 'YEARLY', priceMonthly: team.priceMonthly, priceYearly: team.priceYearly, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000 * 365) } });
  const modules = await prisma.appModule.findMany({ include: { features: true } });
  for (const module of modules) {
    const setting = await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, isEnabled: true } });
    for (const role of ['ADMIN', 'USER']) await prisma.moduleRoleAccess.create({ data: { tenantModuleId: setting.id, role, isAllowed: true } });
    for (const person of Object.values(users)) await prisma.userModuleAccess.create({ data: { userId: person.id, tenantId: tenant.id, moduleId: module.id, featureKeys: module.features.map(item => item.key) } });
  }
  return { tenant, users };
}

async function main() {
  const a = await setupTenant('a');
  const b = await setupTenant('b');
  const record = await prisma.case.create({ data: { tenantId: a.tenant.id, caseNumber: `P1B-${marker}`, title: 'P1-B workflow QA', createdBy: a.users.ADMIN.id } });
  const foreignCase = await prisma.case.create({ data: { tenantId: b.tenant.id, caseNumber: `P1B-B-${marker}`, title: 'Foreign QA', createdBy: b.users.ADMIN.id } });
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const call = async (path, method = 'GET', body, cookie) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const login = async email => { const result = await call('/auth/login', 'POST', { email, password }); assert.equal(result.status, 201); return result.cookie; };
  const path = suffix => `/cases/${record.id}${suffix}`;
  try {
    const admin = await login(a.users.ADMIN.email);
    const analyst = await login(a.users.USER.email);
    const second = await login(a.users.SECOND.email);
    const foreign = await login(b.users.ADMIN.email);
    const root = await login('superadmin@cti.local');
    process.env.CASE_V2_WORKFLOW_ENABLED = 'false';
    assert.equal((await call(path('/workflow'), 'GET', undefined, admin)).status, 403);
    process.env.CASE_V2_WORKFLOW_ENABLED = 'true';
    assert.equal((await call(path('/workflow'), 'GET', undefined, root)).status, 400);
    assert.equal((await call(path(`/workflow?tenantId=${b.tenant.id}`), 'GET', undefined, root)).status, 404);
    assert.equal((await call(path(`/workflow?tenantId=${a.tenant.id}`), 'GET', undefined, root)).status, 200);
    assert.equal((await call(path('/workflow'), 'GET', undefined, foreign)).status, 404);
    assert.equal((await call(`/cases/${foreignCase.id}/workflow`, 'GET', undefined, admin)).status, 404);
    assert.equal((await call(path('/tasks'), 'POST', { title: 'Denied', assigneeId: a.users.USER.id, expectedRevision: 0 }, analyst)).status, 403);
    assert.equal((await call(path('/tasks'), 'POST', { title: 'Missing revision', assigneeId: a.users.USER.id }, admin)).status, 400);
    assert.equal((await call(path('/tasks'), 'POST', { title: 'Cross tenant', assigneeId: b.users.ADMIN.id, expectedRevision: 0 }, admin)).status, 404);
    const created = await call(path('/tasks'), 'POST', { title: 'Investigate signal', assigneeId: a.users.USER.id, expectedRevision: 0 }, admin);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const taskId = created.body.id;
    assert.equal((await prisma.caseTask.findUniqueOrThrow({ where: { id: taskId } })).createdBy, a.users.ADMIN.id);
    assert.equal((await call(path(`/tasks/${taskId}`), 'PATCH', { state: 'IN_PROGRESS', expectedRevision: 1 }, second)).status, 403);
    assert.equal((await call(path(`/tasks/${taskId}`), 'PATCH', { state: 'IN_PROGRESS', expectedRevision: 0 }, analyst)).status, 409);
    assert.equal((await call(path(`/tasks/${taskId}`), 'PATCH', { state: 'IN_PROGRESS', expectedRevision: 1 }, analyst)).status, 200);
    assert.equal((await call(path(`/tasks/${taskId}`), 'PATCH', { state: 'DONE', expectedRevision: 2 }, analyst)).status, 200);
    assert.equal((await call(path(`/tasks/${taskId}`), 'PATCH', { state: 'TODO', expectedRevision: 3 }, admin)).status, 400);
    assert.equal((await prisma.caseTask.findUniqueOrThrow({ where: { id: taskId } })).state, 'DONE');
    const concurrent = await Promise.all([0, 1].map(() => call(path('/tasks'), 'POST', { title: 'Concurrent', assigneeId: a.users.USER.id, expectedRevision: 3 }, admin)));
    assert.deepEqual(concurrent.map(x => x.status).sort(), [201, 409]);
    assert.equal(await prisma.caseTask.count({ where: { caseId: record.id, title: 'Concurrent' } }), 1);
    let assignedView = (await call(path('/workflow'), 'GET', undefined, admin)).body;
    const concurrentTask = assignedView.tasks.find(task => task.title === 'Concurrent');
    assert.equal((await call(path(`/tasks/${concurrentTask.id}`), 'PATCH', { assigneeId: a.users.SECOND.id, expectedRevision: assignedView.revision }, analyst)).status, 403);
    assert.equal((await call(path(`/tasks/${concurrentTask.id}`), 'PATCH', { assigneeId: a.users.SECOND.id, expectedRevision: assignedView.revision }, admin)).status, 200);
    assignedView = (await call(path('/workflow'), 'GET', undefined, admin)).body;
    assert.equal((await call(path(`/tasks/${concurrentTask.id}`), 'PATCH', { state: 'IN_PROGRESS', expectedRevision: assignedView.revision }, analyst)).status, 403);
    assert.equal((await call(path(`/tasks/${concurrentTask.id}`), 'PATCH', { state: 'CANCELLED', expectedRevision: assignedView.revision }, second)).status, 400);
    assert.equal((await call(path(`/tasks/${concurrentTask.id}`), 'PATCH', { state: 'IN_PROGRESS', expectedRevision: assignedView.revision }, second)).status, 200);
    const current = async () => (await call(path('/workflow'), 'GET', undefined, admin)).body;
    let view = await current();
    const due = await call(path('/due-date'), 'PATCH', { dueAt: new Date(Date.now() - 60000).toISOString(), expectedRevision: view.revision }, admin);
    assert.equal(due.status, 200, JSON.stringify(due.body));
    assert.equal((await current()).overdue, true);
    view = await current();
    assert.equal((await call(path('/due-date'), 'PATCH', { dueAt: '2026-10-30T12:00:00+07:00', expectedRevision: view.revision }, admin)).status, 400);
    assert.equal((await call(path('/due-date'), 'PATCH', { dueAt: null, expectedRevision: view.revision }, analyst)).status, 403);
    const handoff = await call(path('/handoff'), 'POST', { assigneeId: a.users.SECOND.id, reason: 'Shift change', expectedRevision: view.revision }, admin);
    assert.equal(handoff.status, 201, JSON.stringify(handoff.body));
    assert.equal(handoff.body.previousAssigneeId, null);
    assert.equal(handoff.body.newAssigneeId, a.users.SECOND.id);
    assert.equal((await current()).handoffs.length, 1);
    assert.equal((await prisma.case.findUniqueOrThrow({ where: { id: record.id } })).assigneeId, a.users.SECOND.id);
    assert.equal(await prisma.notificationOutbox.count({ where: { tenantId: a.tenant.id, type: 'CASE_ASSIGNED', payload: { path: ['caseId'], equals: record.id } } }), 1);
    await assert.rejects(prisma.caseHandoff.delete({ where: { id: handoff.body.id } }));
    view = await current();
    assert.equal((await call(path(''), 'PATCH', { status: 'IN_PROGRESS' }, admin)).status, 200);
    assert.equal((await call(path(''), 'PATCH', { status: 'RESOLVED' }, admin)).status, 200);
    assert.equal((await current()).overdue, false);
    const staleRevision = view.revision;
    view = await current();
    assert.equal((await call(path('/due-date'), 'PATCH', { dueAt: null, expectedRevision: staleRevision }, admin)).status, 409);
    assert.equal((await call(path('/due-date'), 'PATCH', { dueAt: null, expectedRevision: view.revision }, admin)).status, 200);
    assert.equal((await current()).dueAt, null);
    const auditCount = await prisma.auditLog.count({ where: { tenantId: a.tenant.id, action: { startsWith: 'CASE_' } } });
    const taskCount = await prisma.caseTask.count({ where: { caseId: record.id } });
    const revision = (await current()).revision;
    assert.equal((await call(path('/tasks'), 'POST', { title: 'Stale', assigneeId: a.users.USER.id, expectedRevision: 0 }, admin)).status, 409);
    assert.equal((await prisma.case.findUniqueOrThrow({ where: { id: record.id } })).revision, revision);
    assert.equal(await prisma.caseTask.count({ where: { caseId: record.id } }), taskCount);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: a.tenant.id, action: { startsWith: 'CASE_' } } }), auditCount);
    await prisma.$executeRawUnsafe(`CREATE FUNCTION qa_reject_p1b_task() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."title" = 'Rollback sentinel' THEN RAISE EXCEPTION 'QA rollback'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_reject_p1b_task BEFORE INSERT ON "CaseTask" FOR EACH ROW EXECUTE FUNCTION qa_reject_p1b_task()`);
    try {
      assert.equal((await call(path('/tasks'), 'POST', { title: 'Rollback sentinel', assigneeId: a.users.USER.id, expectedRevision: revision }, admin)).status, 500);
      assert.equal((await prisma.case.findUniqueOrThrow({ where: { id: record.id } })).revision, revision);
      assert.equal(await prisma.caseTask.count({ where: { caseId: record.id } }), taskCount);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: a.tenant.id, action: { startsWith: 'CASE_' } } }), auditCount);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER qa_reject_p1b_task ON "CaseTask"');
      await prisma.$executeRawUnsafe('DROP FUNCTION qa_reject_p1b_task()');
    }
    const v1 = await call('/cases', 'POST', { title: 'V1 compatibility QA' }, admin);
    assert.equal(v1.status, 201);
    assert.equal((await call(`/cases/${v1.body.id}`, 'PATCH', { title: 'V1 updated' }, admin)).status, 200);
    assert.equal((await prisma.case.findUniqueOrThrow({ where: { id: v1.body.id } })).revision, 1);
    assert.equal((await call(`/cases/${v1.body.id}`, 'DELETE', undefined, admin)).status, 200);
    console.log(JSON.stringify({ verdict: 'PASS', database: 'cti_case_v2_p1b_qa_20261030', tenantA: a.tenant.id, tenantB: b.tenant.id, adminEmail: a.users.ADMIN.email, analystEmail: a.users.USER.email, caseId: record.id, checks: 59 }));
  } finally { await app.close(); await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
