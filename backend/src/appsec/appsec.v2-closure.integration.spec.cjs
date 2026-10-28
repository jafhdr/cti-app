const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');
const { AppSecModule } = require('../../dist/src/appsec/appsec.module');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('one Finding crosses P1-A/B/C into P1-D without closing its linked Case', { timeout: 120000 }, async () => {
  const qa = process.env.APPSEC_CLOSURE_QA_DB_NAME;
  if (!/^stake49_closure_[0-9a-f]{10}$/.test(qa ?? '') || new URL(process.env.DATABASE_URL).pathname !== `/${qa}`)
    throw new Error('Expected isolated closure QA database');
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const previous = { secret: process.env.JWT_ACCESS_SECRET, triage: process.env.APPSEC_V2_TRIAGE_ENABLED,
    remediation: process.env.APPSEC_V2_REMEDIATION_ENABLED, verification: process.env.APPSEC_V2_VERIFICATION_ENABLED };
  process.env.JWT_ACCESS_SECRET = marker;
  process.env.APPSEC_V2_TRIAGE_ENABLED = 'true';
  process.env.APPSEC_V2_REMEDIATION_ENABLED = 'true';
  process.env.APPSEC_V2_VERIFICATION_ENABLED = 'true';
  const moduleRef = await Test.createTestingModule({ imports: [AppSecModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const tenant = await prisma.tenant.create({ data: { name: 'Closure QA', slug: `closure-${marker}` } });
    const appsec = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'appsec-posture' } });
    const cases = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'case-management' } });
    await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0,
      renewalAt: new Date(Date.now() + 86400000), status: 'ACTIVE', customModules: { create: [{ moduleId: appsec.id }, { moduleId: cases.id }] } } });
    for (const module of [appsec, cases]) await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id,
      access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    async function actor(name, role, appsecFeatures, caseFeatures = []) {
      const person = await prisma.user.create({ data: { name, email: `closure-${name}-${marker}@example.test`, passwordHash: 'unused', role, tenantId: tenant.id } });
      await prisma.userModuleAccess.create({ data: { userId: person.id, tenantId: tenant.id, moduleId: appsec.id, featureKeys: appsecFeatures } });
      if (caseFeatures.length) await prisma.userModuleAccess.create({ data: { userId: person.id, tenantId: tenant.id, moduleId: cases.id, featureKeys: caseFeatures } });
      return person;
    }
    const admin = await actor('admin', 'ADMIN', ['application-inventory', 'finding-management', 'finding-review'], ['case-workflow']);
    const worker = await actor('worker', 'USER', ['finding-management', 'finding-remediation-submit']);
    const reviewer = await actor('reviewer', 'USER', ['finding-management', 'finding-review']);
    const reader = await actor('reader', 'USER', ['finding-management']);
    const tokens = new Map(await Promise.all([admin, worker, reviewer, reader].map(async person => [person.id, await createAccessToken(prisma, person.id, marker)])));
    async function call(person, path, method = 'GET', data) {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json',
        ...(person ? { authorization: `Bearer ${tokens.get(person.id)}` } : {}) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      return { status: response.status, body: await response.json() };
    }
    const application = await call(admin, '/appsec/applications', 'POST', { name: 'Closure QA Application' });
    assert.equal(application.status, 201, JSON.stringify(application.body));
    const made = await call(admin, '/appsec/findings', 'POST', { applicationId: application.body.id,
      title: 'Closure QA Finding', severity: 'HIGH' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.workflowVersion, 1);
    const path = `/appsec/findings/${made.body.id}`;
    const linked = await call(admin, `${path}/case`, 'POST');
    assert.equal(linked.status, 201, JSON.stringify(linked.body));
    assert.equal(linked.body.status, 'OPEN');
    let revision = 0;
    async function action(person, name, data = {}) {
      const result = await call(person, `${path}/lifecycle/${name}`, 'POST', { expectedRevision: revision, ...data });
      assert.equal(result.status, 201, `${name}: ${JSON.stringify(result.body)}`);
      revision = result.body.finding.revision;
      return result;
    }
    await action(admin, 'activate', { reason: 'Open V2 cycle' });
    await action(admin, 'validate', { decision: 'VALID', rationale: 'Confirmed' });
    await action(admin, 'priority', { priority: 'HIGH', rationale: 'Operational impact' });
    await action(admin, 'assign', { assigneeId: worker.id });
    await action(worker, 'start');
    await action(worker, 'evidence', { note: 'Patch tested in QA', reference: 'https://example.test/closure-evidence' });
    const requested = await action(worker, 'request-verification', { summary: 'Ready for independent review' });
    assert.equal((await call(worker, `${path}/lifecycle/verify`, 'POST', { expectedRevision: revision, decision: 'APPROVE', note: 'Self' })).status, 403);
    assert.equal((await call(admin, path, 'PATCH', { status: 'RESOLVED', resolution: 'Bypass' })).status, 409);
    const approved = await action(reviewer, 'verify', { decision: 'APPROVE', note: 'Evidence independently confirmed' });
    assert.equal(approved.body.finding.status, 'RESOLVED');
    assert.equal(approved.body.finding.verificationState, 'APPROVED');
    const metrics = await call(reader, '/appsec/findings/operational-metrics');
    assert.equal(metrics.status, 200, JSON.stringify(metrics.body));
    assert.equal(metrics.body.totals.open, 0);
    assert.equal(metrics.body.totals.resolved, 1);
    const queue = await call(reader, '/appsec/findings/queue?status=RESOLVED');
    assert.equal(queue.status, 200);
    assert.equal(queue.body.total, 1);
    assert.equal(queue.body.items[0].id, made.body.id);
    assert.equal(queue.body.items[0].verificationState, 'APPROVED');
    const events = await prisma.appSecFindingActionEvent.findMany({ where: { tenantId: tenant.id, findingId: made.body.id }, orderBy: { revision: 'asc' } });
    assert.deepEqual(events.map(item => item.kind), ['ACTIVATED', 'VALIDATED', 'PRIORITY_SET', 'ASSIGNED', 'REMEDIATION_STARTED', 'EVIDENCE_SUBMITTED', 'VERIFICATION_REQUESTED', 'VERIFIED_RESOLVED']);
    assert.equal(requested.body.event.after.evidenceEventId, events[5].id);
    assert.equal(events[7].actorId, reviewer.id);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: { in: events.map(item => `APPSEC_FINDING_${item.kind}`) } } }), events.length);
    assert.equal((await prisma.case.findUniqueOrThrow({ where: { id: linked.body.id }, select: { status: true } })).status, 'OPEN');
    console.log(JSON.stringify({ finding: made.body.id, revision, status: approved.body.finding.status,
      events: events.length, matchingAudits: events.length, reportResolved: metrics.body.totals.resolved, linkedCaseStatus: 'OPEN' }));
  } finally {
    await app.close(); await prisma.$disconnect();
    for (const [key, value] of Object.entries({ JWT_ACCESS_SECRET: previous.secret,
      APPSEC_V2_TRIAGE_ENABLED: previous.triage, APPSEC_V2_REMEDIATION_ENABLED: previous.remediation,
      APPSEC_V2_VERIFICATION_ENABLED: previous.verification })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
