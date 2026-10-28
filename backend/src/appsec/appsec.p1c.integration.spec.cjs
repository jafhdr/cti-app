const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');
const { AppSecModule } = require('../../dist/src/appsec/appsec.module');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('P1-C independent review, rework and terminal decisions are tenant-safe and atomic', { timeout: 120000 }, async () => {
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const previous = { access: process.env.JWT_ACCESS_SECRET, triage: process.env.APPSEC_V2_TRIAGE_ENABLED, remediation: process.env.APPSEC_V2_REMEDIATION_ENABLED, verification: process.env.APPSEC_V2_VERIFICATION_ENABLED };
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
    const a = await prisma.tenant.create({ data: { name: 'P1C A', slug: `p1c-a-${marker}` } });
    const b = await prisma.tenant.create({ data: { name: 'P1C B', slug: `p1c-b-${marker}` } });
    const module = await prisma.appModule.upsert({ where: { slug: 'appsec-posture' }, update: {}, create: { slug: 'appsec-posture', name: 'AppSec', description: 'QA', category: 'APPSEC', features: { create: [
      { key: 'finding-management', name: 'Finding Management' }, { key: 'finding-remediation-submit', name: 'Remediation' }, { key: 'finding-review', name: 'Review' },
    ] } } });
    for (const key of ['finding-management', 'finding-remediation-submit', 'finding-review']) await prisma.moduleFeature.upsert({ where: { moduleId_key: { moduleId: module.id, key } }, update: {}, create: { moduleId: module.id, key, name: key } });
    await prisma.tenantSubscription.create({ data: { tenantId: a.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, renewalAt: new Date(Date.now() + 86400000), status: 'ACTIVE', customModules: { create: { moduleId: module.id } } } });
    await prisma.tenantModule.create({ data: { tenantId: a.id, moduleId: module.id, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    async function user(name, role, tenantId, features = []) {
      const person = await prisma.user.create({ data: { name, email: `p1c-${name}-${marker}@example.test`, passwordHash: 'unused', role, tenantId } });
      if (tenantId === a.id && features.length) await prisma.userModuleAccess.create({ data: { userId: person.id, tenantId, moduleId: module.id, featureKeys: features } });
      return person;
    }
    const admin = await user('admin', 'ADMIN', a.id, ['finding-management', 'finding-review']);
    const worker = await user('worker', 'USER', a.id, ['finding-management', 'finding-remediation-submit', 'finding-review']);
    const reviewer = await user('reviewer', 'USER', a.id, ['finding-management', 'finding-review']);
    const reviewer2 = await user('reviewer2', 'USER', a.id, ['finding-management', 'finding-review']);
    const reader = await user('reader', 'USER', a.id, ['finding-management']);
    const root = await user('root', 'SUPER_ADMIN', null);
    const foreign = await user('foreign', 'USER', b.id);
    const appA = await prisma.application.create({ data: { tenantId: a.id, name: 'P1C A' } });
    const appB = await prisma.application.create({ data: { tenantId: b.id, name: 'P1C B' } });
    const tokens = new Map(await Promise.all([admin, worker, reviewer, reviewer2, reader, root, foreign].map(async person => [person.id, await createAccessToken(prisma, person.id, marker)])));
    async function call(actor, path, method = 'GET', body) {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(actor ? { authorization: `Bearer ${tokens.get(actor.id)}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
    }
    async function finding(title, status = 'OPEN', workflowVersion = 2) {
      return prisma.appSecFinding.create({ data: { tenantId: a.id, applicationId: appA.id, title, severity: 'HIGH', source: 'MANUAL', status, workflowVersion, lifecycleCycle: workflowVersion === 2 ? 1 : 0, validationState: workflowVersion === 2 ? 'VALID' : null, priority: workflowVersion === 2 ? 'HIGH' : null, assigneeId: workflowVersion === 2 ? worker.id : null, ...(status === 'RESOLVED' ? { resolution: 'Legacy decision', resolvedAt: new Date() } : {}) } });
    }
    const first = await finding('P1C main');
    const path = `/appsec/findings/${first.id}`;
    assert.equal((await call(worker, `${path}/lifecycle/request-verification`, 'POST', { expectedRevision: 0, summary: 'No evidence' })).status, 400);
    assert.equal((await call(worker, `${path}/lifecycle/start`, 'POST', { expectedRevision: 0 })).status, 201);
    assert.equal((await call(worker, `${path}/lifecycle/evidence`, 'POST', { expectedRevision: 1, note: 'Initial patch', reference: 'https://example.test/evidence/1' })).status, 201);
    const requestKey = randomUUID();
    const requestPayload = { expectedRevision: 2, summary: 'Please verify patch', requestKey };
    const requested = await call(worker, `${path}/lifecycle/request-verification`, 'POST', requestPayload);
    assert.equal(requested.status, 201, JSON.stringify(requested.body));
    assert.equal(requested.body.finding.verificationState, 'REQUESTED');
    assert.equal(requested.body.event.after.evidenceEventId, (await prisma.appSecFindingActionEvent.findFirstOrThrow({ where: { findingId: first.id, kind: 'EVIDENCE_SUBMITTED' } })).id);
    assert.equal((await call(worker, `${path}/lifecycle/request-verification`, 'POST', requestPayload)).body.event.id, requested.body.event.id);
    assert.equal((await call(worker, `${path}/lifecycle/request-verification`, 'POST', { ...requestPayload, summary: 'Changed' })).status, 409);
    assert.equal((await call(worker, `${path}/lifecycle/request-verification`, 'POST', { expectedRevision: 3, summary: 'Duplicate' })).status, 409);
    assert.equal((await call(worker, `${path}/lifecycle/evidence`, 'POST', { expectedRevision: 3, note: 'Pending blocked' })).status, 409);
    assert.equal((await call(admin, `${path}/lifecycle/assign`, 'POST', { expectedRevision: 3, assigneeId: reviewer.id, reason: 'Pending blocked' })).status, 409);
    assert.equal((await call(worker, `${path}/lifecycle/verify`, 'POST', { expectedRevision: 3, decision: 'APPROVE', note: 'Self review' })).status, 403);
    assert.equal((await call(reader, `${path}/lifecycle/verify`, 'POST', { expectedRevision: 3, decision: 'APPROVE', note: 'No grant' })).status, 403);
    assert.equal((await call(reviewer, `${path}/lifecycle/verify`, 'POST', { expectedRevision: 2, decision: 'APPROVE', note: 'Stale' })).status, 409);
    const rejected = await call(reviewer, `${path}/lifecycle/verify`, 'POST', { expectedRevision: 3, decision: 'REJECT', note: 'Evidence needs retest' });
    assert.equal(rejected.status, 201, JSON.stringify(rejected.body));
    assert.equal(rejected.body.finding.status, 'IN_PROGRESS');
    assert.equal(rejected.body.finding.verificationState, 'REJECTED');
    assert.equal((await call(worker, `${path}/lifecycle/request-verification`, 'POST', { expectedRevision: 4, summary: 'Reuse old evidence' })).status, 400);
    assert.equal((await call(worker, `${path}/lifecycle/evidence`, 'POST', { expectedRevision: 4, note: 'Fresh retest' })).status, 201);
    assert.equal((await call(worker, `${path}/lifecycle/request-verification`, 'POST', { expectedRevision: 5, summary: 'Fresh evidence ready' })).status, 201);
    assert.equal((await call(root, `${path}/lifecycle/verify`, 'POST', { expectedRevision: 6, decision: 'APPROVE', note: 'No tenant' })).status, 400);
    assert.equal((await call(root, `${path}/lifecycle/verify?tenantId=${b.id}`, 'POST', { expectedRevision: 6, decision: 'APPROVE', note: 'Foreign tenant' })).status, 403);
    const approvalKey = randomUUID();
    const approval = await call(reviewer2, `${path}/lifecycle/verify`, 'POST', { expectedRevision: 6, decision: 'APPROVE', note: 'Retest confirms fix', requestKey: approvalKey });
    assert.equal(approval.status, 201, JSON.stringify(approval.body));
    assert.equal(approval.body.finding.status, 'RESOLVED');
    assert.equal(approval.body.finding.verificationState, 'APPROVED');
    assert.ok(approval.body.finding.resolvedAt);
    assert.equal((await call(reviewer2, `${path}/lifecycle/verify`, 'POST', { expectedRevision: 6, decision: 'APPROVE', note: 'Retest confirms fix', requestKey: approvalKey })).body.event.id, approval.body.event.id);
    assert.equal((await call(reviewer, `${path}/lifecycle/verify`, 'POST', { expectedRevision: 6, decision: 'REJECT', note: 'Late' })).status, 409);
    assert.equal((await call(admin, path, 'PATCH', { status: 'OPEN' })).status, 409);
    const reopened = await call(admin, `${path}/lifecycle/reopen`, 'POST', { expectedRevision: 7, reason: 'New exposure found' });
    assert.equal(reopened.status, 201, JSON.stringify(reopened.body));
    assert.equal(reopened.body.finding.lifecycleCycle, 2);
    assert.equal(reopened.body.finding.workflowVersion, 2);
    assert.equal(reopened.body.finding.validationState, 'PENDING');
    assert.equal(reopened.body.finding.verificationState, 'NONE');
    assert.equal(reopened.body.finding.status, 'OPEN');
    assert.equal(reopened.body.finding.assigneeId, null);
    assert.equal(await prisma.appSecFindingActionEvent.count({ where: { findingId: first.id, cycle: 1 } }), 7);
    const legacy = await finding('P1C legacy', 'RESOLVED', 1);
    assert.equal((await call(admin, `/appsec/findings/${legacy.id}`, 'PATCH', { status: 'OPEN' })).status, 409);
    const legacyReopen = await call(admin, `/appsec/findings/${legacy.id}/lifecycle/reopen`, 'POST', { expectedRevision: 0, reason: 'Reassess legacy decision' });
    assert.equal(legacyReopen.status, 201, JSON.stringify(legacyReopen.body));
    assert.equal(legacyReopen.body.finding.workflowVersion, 2);
    assert.equal(legacyReopen.body.event.before.resolution, 'Legacy decision');
    assert.equal(legacyReopen.body.event.after.legacy, true);
    const risk = await finding('P1C risk');
    assert.equal((await call(reader, `/appsec/findings/${risk.id}/lifecycle/accept-risk`, 'POST', { expectedRevision: 0, reason: 'Denied', reviewDueAt: '2027-01-01' })).status, 403);
    assert.equal((await call(admin, `/appsec/findings/${risk.id}/lifecycle/accept-risk`, 'POST', { expectedRevision: 0, reason: 'No due' })).status, 400);
    const riskDecision = await call(admin, `/appsec/findings/${risk.id}/lifecycle/accept-risk`, 'POST', { expectedRevision: 0, reason: 'Documented exception', reviewDueAt: '2027-01-01' });
    assert.equal(riskDecision.status, 201, JSON.stringify(riskDecision.body));
    assert.equal(riskDecision.body.finding.status, 'ACCEPTED_RISK');
    assert.equal(riskDecision.body.event.after.reviewDueAt, '2027-01-01T00:00:00.000Z');
    const fp = await finding('P1C false positive');
    const fpDecision = await call(admin, `/appsec/findings/${fp.id}/lifecycle/false-positive`, 'POST', { expectedRevision: 0, reason: 'Test fixture only', reference: 'https://example.test/fp' });
    assert.equal(fpDecision.status, 201, JSON.stringify(fpDecision.body));
    assert.equal(fpDecision.body.finding.status, 'FALSE_POSITIVE');
    assert.equal((await call(admin, `/appsec/findings/${fp.id}`, 'PATCH', { status: 'RESOLVED', resolution: 'Bypass' })).status, 409);
    const foreignApp = await prisma.appSecFinding.create({ data: { tenantId: b.id, applicationId: appB.id, title: 'Foreign', severity: 'LOW' } });
    assert.equal((await call(admin, `/appsec/findings/${foreignApp.id}/lifecycle/reopen`, 'POST', { expectedRevision: 0, reason: 'Foreign' })).status, 404);
    const rollback = await finding('P1C rollback');
    assert.equal((await call(worker, `/appsec/findings/${rollback.id}/lifecycle/start`, 'POST', { expectedRevision: 0 })).status, 201);
    assert.equal((await call(worker, `/appsec/findings/${rollback.id}/lifecycle/evidence`, 'POST', { expectedRevision: 1, note: 'Rollback evidence' })).status, 201);
    assert.equal((await call(worker, `/appsec/findings/${rollback.id}/lifecycle/request-verification`, 'POST', { expectedRevision: 2, summary: 'Rollback request' })).status, 201);
    await prisma.$executeRawUnsafe("CREATE FUNCTION p1c_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.\"action\" = 'APPSEC_FINDING_VERIFIED_RESOLVED' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$");
    await prisma.$executeRawUnsafe('CREATE TRIGGER p1c_reject_audit_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION p1c_reject_audit()');
    try {
      assert.equal((await call(reviewer, `/appsec/findings/${rollback.id}/lifecycle/verify`, 'POST', { expectedRevision: 3, decision: 'APPROVE', note: 'Should roll back' })).status, 500);
      const unchanged = await prisma.appSecFinding.findUniqueOrThrow({ where: { id: rollback.id } });
      assert.equal(unchanged.status, 'IN_PROGRESS');
      assert.equal(unchanged.verificationState, 'REQUESTED');
      assert.equal(unchanged.revision, 3);
      assert.equal(await prisma.appSecFindingActionEvent.count({ where: { findingId: rollback.id } }), 3);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER p1c_reject_audit_trigger ON "AuditLog"');
      await prisma.$executeRawUnsafe('DROP FUNCTION p1c_reject_audit()');
    }
    const concurrent = await Promise.all([
      call(reviewer, `/appsec/findings/${rollback.id}/lifecycle/verify`, 'POST', { expectedRevision: 3, decision: 'APPROVE', note: 'Concurrent approve' }),
      call(reviewer2, `/appsec/findings/${rollback.id}/lifecycle/verify`, 'POST', { expectedRevision: 3, decision: 'REJECT', note: 'Concurrent reject' }),
    ]);
    assert.deepEqual(concurrent.map(item => item.status).sort(), [201, 409]);
    assert.equal(await prisma.appSecFindingActionEvent.count({ where: { findingId: rollback.id } }), 4);
  } finally {
    await app.close(); await prisma.$disconnect();
    for (const [key, value] of Object.entries({ JWT_ACCESS_SECRET: previous.access, APPSEC_V2_TRIAGE_ENABLED: previous.triage, APPSEC_V2_REMEDIATION_ENABLED: previous.remediation, APPSEC_V2_VERIFICATION_ENABLED: previous.verification })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
