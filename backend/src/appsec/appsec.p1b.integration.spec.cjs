const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');
const { AppSecModule } = require('../../dist/src/appsec/appsec.module');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('P1-B remediation requires current assigned grant and appends atomic evidence', { timeout: 120000 }, async () => {
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const previousSecret = process.env.JWT_ACCESS_SECRET;
  const previousP1A = process.env.APPSEC_V2_TRIAGE_ENABLED;
  const previousP1B = process.env.APPSEC_V2_REMEDIATION_ENABLED;
  process.env.JWT_ACCESS_SECRET = marker;
  process.env.APPSEC_V2_TRIAGE_ENABLED = 'true';
  process.env.APPSEC_V2_REMEDIATION_ENABLED = 'true';
  const moduleRef = await Test.createTestingModule({ imports: [AppSecModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const a = await prisma.tenant.create({ data: { name: 'P1B A', slug: `p1b-a-${marker}` } });
    const b = await prisma.tenant.create({ data: { name: 'P1B B', slug: `p1b-b-${marker}` } });
    const module = await prisma.appModule.upsert({
      where: { slug: 'appsec-posture' }, update: {},
      create: { slug: 'appsec-posture', name: 'AppSec', description: 'QA', category: 'APPSEC', features: { create: [
        { key: 'finding-management', name: 'Finding Management' },
        { key: 'finding-remediation-submit', name: 'Finding Remediation Submit' },
      ] } },
    });
    const grant = ['finding-management', 'finding-remediation-submit'];
    await prisma.tenantSubscription.create({ data: { tenantId: a.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, renewalAt: new Date(Date.now() + 86400000), status: 'ACTIVE', customModules: { create: { moduleId: module.id } } } });
    await prisma.tenantModule.create({ data: { tenantId: a.id, moduleId: module.id, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    async function user(name, role, tenantId, features = []) {
      const person = await prisma.user.create({ data: { name, email: `p1b-${name}-${marker}@example.test`, passwordHash: 'unused', role, tenantId } });
      if (tenantId === a.id && features.length) await prisma.userModuleAccess.create({ data: { userId: person.id, tenantId, moduleId: module.id, featureKeys: features } });
      return person;
    }
    const admin = await user('admin', 'ADMIN', a.id, grant);
    const assigned = await user('assigned', 'USER', a.id, grant);
    const other = await user('other', 'USER', a.id, grant);
    const noGrant = await user('nogrant', 'USER', a.id, ['finding-management']);
    const foreign = await user('foreign', 'USER', b.id);
    const appA = await prisma.application.create({ data: { tenantId: a.id, name: 'P1B A' } });
    const appB = await prisma.application.create({ data: { tenantId: b.id, name: 'P1B B' } });
    const finding = await prisma.appSecFinding.create({ data: { tenantId: a.id, applicationId: appA.id, title: 'P1B work', severity: 'HIGH', source: 'MANUAL', workflowVersion: 2, lifecycleCycle: 1, validationState: 'VALID', priority: 'HIGH', assigneeId: assigned.id } });
    const foreignFinding = await prisma.appSecFinding.create({ data: { tenantId: b.id, applicationId: appB.id, title: 'P1B foreign', severity: 'LOW', source: 'MANUAL', workflowVersion: 2, lifecycleCycle: 1, validationState: 'VALID', priority: 'LOW', assigneeId: foreign.id } });
    const tokens = new Map(await Promise.all([admin, assigned, other, noGrant, foreign].map(async person => [person.id, await createAccessToken(prisma, person.id, marker)])));
    async function call(actor, path, method = 'GET', body) {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(actor ? { authorization: `Bearer ${tokens.get(actor.id)}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }
    const path = `/appsec/findings/${finding.id}`;
    const start = `${path}/lifecycle/start`;
    const evidence = `${path}/lifecycle/evidence`;
    assert.equal((await call(noGrant, start, 'POST', { expectedRevision: 0 })).status, 403);
    assert.equal((await call(admin, start, 'POST', { expectedRevision: 0 })).status, 403);
    assert.equal((await call(other, start, 'POST', { expectedRevision: 0 })).status, 403);
    assert.equal((await call(assigned, `/appsec/findings/${foreignFinding.id}/lifecycle/start`, 'POST', { expectedRevision: 0 })).status, 404);
    process.env.APPSEC_V2_REMEDIATION_ENABLED = 'false';
    assert.equal((await call(assigned, start, 'POST', { expectedRevision: 0 })).status, 403);
    process.env.APPSEC_V2_REMEDIATION_ENABLED = 'true';
    assert.equal((await call(assigned, start, 'POST', { expectedRevision: 0 })).status, 201);
    assert.equal((await call(assigned, start, 'POST', { expectedRevision: 0 })).status, 409);
    const key = randomUUID();
    const payload = { expectedRevision: 1, note: 'Review patch and deployment', reference: 'https://example.test/evidence/1', requestKey: key };
    const [first, retry] = await Promise.all([call(assigned, evidence, 'POST', payload), call(assigned, evidence, 'POST', payload)]);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(retry.status, 201);
    assert.equal(first.body.event.id, retry.body.event.id);
    assert.equal(first.body.finding.status, 'IN_PROGRESS');
    assert.equal(first.body.event.after.note, payload.note);
    assert.equal(first.body.event.after.reference, payload.reference);
    assert.equal((await call(assigned, evidence, 'POST', { ...payload, note: 'Changed' })).status, 409);
    assert.equal((await call(assigned, evidence, 'POST', { expectedRevision: 1, note: 'Stale' })).status, 409);
    assert.equal((await call(assigned, evidence, 'POST', { expectedRevision: 2, note: '   ' })).status, 400);
    assert.equal((await call(assigned, evidence, 'POST', { expectedRevision: 2, note: 'Unsafe', reference: 'javascript:alert(1)' })).status, 400);
    assert.equal((await call(assigned, evidence, 'POST', { expectedRevision: 2, note: 'Foreign reference', reference: foreignFinding.id })).status, 400);
    assert.equal((await call(admin, evidence, 'POST', { expectedRevision: 2, note: 'Not my assignment' })).status, 403);
    assert.equal((await call(assigned, path, 'PATCH', { status: 'RESOLVED' })).status, 403);
    assert.equal((await call(admin, path, 'PATCH', { status: 'RESOLVED', resolution: 'Bypass' })).status, 409);
    const prior = await prisma.appSecFindingActionEvent.findFirstOrThrow({ where: { findingId: finding.id, kind: 'EVIDENCE_SUBMITTED' } });
    const assignment = { userId: assigned.id, tenantId: a.id, moduleId: module.id };
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: assignment }, data: { featureKeys: ['finding-management'] } });
    assert.equal((await call(assigned, evidence, 'POST', { expectedRevision: 2, note: 'Revoked' })).status, 403);
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: assignment }, data: { featureKeys: grant } });
    await prisma.$executeRawUnsafe("CREATE FUNCTION p1b_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.\"action\" = 'APPSEC_FINDING_EVIDENCE_SUBMITTED' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$");
    await prisma.$executeRawUnsafe('CREATE TRIGGER p1b_reject_audit_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION p1b_reject_audit()');
    try {
      assert.equal((await call(assigned, evidence, 'POST', { expectedRevision: 2, note: 'Rollback' })).status, 500);
      assert.equal((await prisma.appSecFinding.findUniqueOrThrow({ where: { id: finding.id } })).revision, 2);
      assert.equal(await prisma.appSecFindingActionEvent.count({ where: { findingId: finding.id } }), 2);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER p1b_reject_audit_trigger ON "AuditLog"');
      await prisma.$executeRawUnsafe('DROP FUNCTION p1b_reject_audit()');
    }
    const currentEvidence = await prisma.appSecFindingActionEvent.findUniqueOrThrow({ where: { id: prior.id } });
    assert.deepEqual(currentEvidence.after, prior.after);
    assert.equal((await call(assigned, evidence, 'POST', { expectedRevision: 2, note: 'Second observation' })).status, 201);
    assert.equal((await prisma.appSecFinding.findUniqueOrThrow({ where: { id: finding.id } })).status, 'IN_PROGRESS');
    assert.equal(await prisma.appSecFindingActionEvent.count({ where: { findingId: finding.id } }), 3);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: a.id, action: { startsWith: 'APPSEC_FINDING_' } } }), 3);
    const transfer = await call(admin, `${path}/lifecycle/assign`, 'POST', { expectedRevision: 3, assigneeId: other.id, reason: 'Audited owner rotation' });
    assert.equal(transfer.status, 201, JSON.stringify(transfer.body));
    assert.equal((await call(assigned, evidence, 'POST', { expectedRevision: 4, note: 'Old owner denied' })).status, 403);
    assert.equal((await call(other, evidence, 'POST', { expectedRevision: 4, note: 'New owner observation' })).status, 201);
    assert.equal(await prisma.appSecFindingActionEvent.count({ where: { findingId: finding.id } }), 5);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: a.id, action: { startsWith: 'APPSEC_FINDING_' } } }), 5);
    await prisma.user.update({ where: { id: other.id }, data: { isActive: false } });
    assert.equal((await call(other, evidence, 'POST', { expectedRevision: 5, note: 'Inactive denied' })).status, 401);
  } finally {
    await app.close();
    await prisma.$disconnect();
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previousSecret;
    if (previousP1A === undefined) delete process.env.APPSEC_V2_TRIAGE_ENABLED;
    else process.env.APPSEC_V2_TRIAGE_ENABLED = previousP1A;
    if (previousP1B === undefined) delete process.env.APPSEC_V2_REMEDIATION_ENABLED;
    else process.env.APPSEC_V2_REMEDIATION_ENABLED = previousP1B;
  }
});
