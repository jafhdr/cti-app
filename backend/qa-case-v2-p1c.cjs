const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require('./dist/src/app.module.js');

process.env.JWT_ACCESS_SECRET = 'case-v2-p1c-qa-access-secret';
process.env.JWT_REFRESH_SECRET = 'case-v2-p1c-qa-refresh-secret';
const prisma = new PrismaClient();
const password = 'CaseQaPass123!';
const marker = `p1c-${Date.now()}`;

async function setupTenant(label) {
  const tenant = await prisma.tenant.create({ data: { name: `${label} ${marker}`, slug: `${label}-${marker}` } });
  const hash = await bcrypt.hash(password, 10);
  const users = {};
  for (const [name, role] of [['ADMIN', 'ADMIN'], ['REVIEWER', 'ADMIN'], ['NO_GRANT', 'ADMIN'], ['USER', 'USER'], ['OTHER', 'USER']]) {
    users[name] = await prisma.user.create({ data: { name: `${label} ${name}`, email: `${label}-${name.toLowerCase()}-${marker}@example.test`, passwordHash: hash, role, tenantId: tenant.id } });
  }
  const team = await prisma.subscriptionPackage.findUniqueOrThrow({ where: { name: 'Team' } });
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId: team.id, billingCycle: 'YEARLY', priceMonthly: team.priceMonthly, priceYearly: team.priceYearly, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000 * 365) } });
  const modules = await prisma.appModule.findMany({ include: { features: true } });
  for (const module of modules) {
    const setting = await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, isEnabled: true } });
    for (const role of ['ADMIN', 'USER']) await prisma.moduleRoleAccess.create({ data: { tenantModuleId: setting.id, role, isAllowed: true } });
    for (const [name, person] of Object.entries(users)) await prisma.userModuleAccess.create({ data: { userId: person.id, tenantId: tenant.id, moduleId: module.id,
      featureKeys: module.features.map(item => item.key).filter(key => key !== 'case-v2-reviewer' || name === 'REVIEWER') } });
  }
  return { tenant, users };
}

async function main() {
  const a = await setupTenant('a');
  const b = await setupTenant('b');
  const caseRecord = await prisma.case.create({ data: { tenantId: a.tenant.id, caseNumber: `P1C-${marker}`, title: 'P1-C integrity QA', createdBy: a.users.ADMIN.id, assigneeId: a.users.USER.id } });
  const foreignCase = await prisma.case.create({ data: { tenantId: b.tenant.id, caseNumber: `P1C-B-${marker}`, title: 'Foreign Case', createdBy: b.users.ADMIN.id } });
  const indicator = await prisma.indicator.create({ data: { tenantId: a.tenant.id, value: `p1c-${marker}.example`, type: 'DOMAIN', severity: 'HIGH', status: 'ACTIVE' } });
  const asset = await prisma.asset.create({ data: { tenantId: a.tenant.id, name: 'P1C asset', value: `asset-${marker}.example`, type: 'DOMAIN' } });
  const alert = await prisma.alert.create({ data: { tenantId: a.tenant.id, source: 'ASM', sourceKey: `p1c:${marker}`, title: 'P1C alert', assetId: asset.id } });
  const application = await prisma.application.create({ data: { tenantId: a.tenant.id, name: `P1C app ${marker}` } });
  const finding = await prisma.appSecFinding.create({ data: { tenantId: a.tenant.id, applicationId: application.id, title: 'P1C finding', severity: 'HIGH' } });
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const call = async (path, method = 'GET', body, cookie) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const login = async email => { const result = await call('/auth/login', 'POST', { email, password }); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.cookie; };
  const path = suffix => `/cases/${caseRecord.id}${suffix}`;
  try {
    const admin = await login(a.users.ADMIN.email);
    const reviewer = await login(a.users.REVIEWER.email);
    const analyst = await login(a.users.USER.email);
    const other = await login(a.users.OTHER.email);
    const foreign = await login(b.users.ADMIN.email);
    const root = await login('superadmin@cti.local');
    process.env.CASE_V2_INTEGRITY_ENABLED = 'false';
    assert.equal((await call(path('/integrity'), 'GET', undefined, admin)).status, 403);
    const v1Case = await call('/cases', 'POST', { title: 'V1 closure compatibility' }, admin);
    assert.equal(v1Case.status, 201);
    for (const status of ['IN_PROGRESS', 'RESOLVED', 'CLOSED']) assert.equal((await call(`/cases/${v1Case.body.id}`, 'PATCH', { status }, admin)).status, 200);
    assert.equal((await call(`/cases/${v1Case.body.id}`, 'DELETE', undefined, admin)).status, 200);
    const legacyEvidence = await call(path('/evidence'), 'POST', { requestId: `legacy-${marker}`, name: 'Legacy metadata', type: 'log', source: 'SIEM' }, analyst);
    assert.equal(legacyEvidence.status, 201);
    process.env.CASE_V2_INTEGRITY_ENABLED = 'true';
    assert.equal((await call(path('/integrity'), 'GET', undefined, foreign)).status, 404);
    assert.equal((await call(`/cases/${foreignCase.id}/integrity`, 'GET', undefined, admin)).status, 404);
    assert.equal((await call(path('/integrity'), 'GET', undefined, root)).status, 400);
    assert.equal((await call(path(`/integrity?tenantId=${b.tenant.id}`), 'GET', undefined, root)).status, 404);
    assert.equal((await call(path(`/integrity?tenantId=${a.tenant.id}`), 'GET', undefined, root)).status, 200);
    const historyPath = path(`/evidence/${legacyEvidence.body.id}/revisions`);
    assert.equal((await call(historyPath, 'GET', undefined, analyst)).body.integrityKind, 'LEGACY_UNVERSIONED');
    assert.equal((await call(historyPath, 'GET', undefined, foreign)).status, 404);
    assert.equal((await call(historyPath, 'POST', { name: 'Denied', type: 'log', expectedRevision: 0 }, other)).status, 403);
    assert.equal((await call(historyPath, 'POST', { name: 'Missing revision', type: 'log' }, analyst)).status, 400);
    const revised = await call(historyPath, 'POST', { name: 'Legacy metadata corrected', type: 'log', source: 'SIEM ticket 42', expectedRevision: 0 }, analyst);
    assert.equal(revised.status, 201, JSON.stringify(revised.body));
    assert.equal(revised.body.revision, 2);
    const history = await call(historyPath, 'GET', undefined, analyst);
    assert.deepEqual(history.body.revisions.map(item => item.integrityKind), ['LEGACY_BASELINE', 'METADATA_ONLY']);
    assert.equal(history.body.revisions[0].name, 'Legacy metadata');
    await assert.rejects(prisma.caseEvidenceRevision.update({ where: { id: revised.body.id }, data: { name: 'tampered' } }));
    await assert.rejects(prisma.caseEvidenceRevision.delete({ where: { id: revised.body.id } }));
    assert.equal((await call(path('/reopen'), 'POST', { reason: 'Too early', expectedRevision: 1 }, admin)).status, 409);
    assert.equal((await call(path('/closure'), 'POST', { reason: 'Too early', investigationSummary: 'Summary', expectedRevision: 1 }, admin)).status, 409);
    assert.equal((await call(path(''), 'PATCH', { status: 'IN_PROGRESS' }, admin)).status, 200);
    assert.equal((await call(path(''), 'PATCH', { status: 'RESOLVED' }, admin)).status, 200);
    assert.equal((await call(path(''), 'PATCH', { status: 'CLOSED' }, admin)).status, 403);
    const view = async cookie => (await call(path('/integrity'), 'GET', undefined, cookie ?? admin)).body;
    let state = await view();
    assert.equal((await call(path('/reviews'), 'POST', { reviewerId: a.users.REVIEWER.id, expectedRevision: state.revision }, analyst)).status, 403);
    assert.equal((await call(path('/reviews'), 'POST', { reviewerId: b.users.ADMIN.id, expectedRevision: state.revision }, admin)).status, 404);
    assert.equal((await call(path('/reviews'), 'POST', { reviewerId: a.users.NO_GRANT.id, expectedRevision: state.revision }, admin)).status, 403);
    const caseModule = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'case-management' } });
    const adminGrantKey = { userId: a.users.ADMIN.id, tenantId: a.tenant.id, moduleId: caseModule.id };
    const adminGrant = await prisma.userModuleAccess.findUniqueOrThrow({ where: { userId_tenantId_moduleId: adminGrantKey } });
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: adminGrantKey }, data: { featureKeys: [...adminGrant.featureKeys, 'case-v2-reviewer'] } });
    assert.equal((await call(path('/reviews'), 'POST', { reviewerId: a.users.ADMIN.id, expectedRevision: state.revision }, admin)).status, 403);
    const request = await call(path('/reviews'), 'POST', { reviewerId: a.users.REVIEWER.id, reason: 'Ready for review', expectedRevision: state.revision }, admin);
    assert.equal(request.status, 201, JSON.stringify(request.body));
    const reviewerGrantKey = { userId: a.users.REVIEWER.id, tenantId: a.tenant.id, moduleId: caseModule.id };
    const reviewerAccess = await prisma.userModuleAccess.findUniqueOrThrow({ where: { userId_tenantId_moduleId: reviewerGrantKey } });
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: reviewerGrantKey }, data: { featureKeys: reviewerAccess.featureKeys.filter(key => key !== 'case-v2-reviewer') } });
    assert.equal((await call(path(`/reviews/${request.body.id}/decision`), 'POST', { kind: 'APPROVED', reason: 'No grant', expectedRevision: state.revision + 1 }, reviewer)).status, 403);
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: reviewerGrantKey }, data: { featureKeys: reviewerAccess.featureKeys } });
    await assert.rejects(prisma.caseReviewRequest.update({ where: { id: request.body.id }, data: { reason: 'tampered' } }));
    assert.equal((await call(path(`/reviews/${request.body.id}/decision`), 'POST', { kind: 'APPROVED', reason: 'Self', expectedRevision: state.revision + 1 }, admin)).status, 403);
    assert.equal((await call(path(`/reviews/${request.body.id}/decision`), 'POST', { kind: 'APPROVED', reason: 'User', expectedRevision: state.revision + 1 }, analyst)).status, 403);
    assert.equal((await call(path(`/reviews/${request.body.id}/decision`), 'POST', { kind: 'APPROVED', reason: '', expectedRevision: state.revision + 1 }, reviewer)).status, 400);
    assert.equal((await call(path(`/reviews/${request.body.id}/decision`), 'POST', { kind: 'APPROVED', reason: 'Stale', expectedRevision: 0 }, reviewer)).status, 409);
    await prisma.$executeRawUnsafe(`CREATE FUNCTION qa_reject_p1c_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."reason" = 'QA rollback' THEN RAISE EXCEPTION 'QA rollback'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_reject_p1c_decision BEFORE INSERT ON "CaseReviewDecision" FOR EACH ROW EXECUTE FUNCTION qa_reject_p1c_decision()`);
    try {
      const revisionBefore = (await prisma.case.findUniqueOrThrow({ where: { id: caseRecord.id } })).revision;
      const auditBeforeRollback = await prisma.auditLog.count({ where: { tenantId: a.tenant.id, action: 'CASE_REVIEW_DECIDED' } });
      assert.equal((await call(path(`/reviews/${request.body.id}/decision`), 'POST', { kind: 'REJECTED', reason: 'QA rollback', expectedRevision: revisionBefore }, reviewer)).status, 500);
      assert.equal((await prisma.case.findUniqueOrThrow({ where: { id: caseRecord.id } })).revision, revisionBefore);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: a.tenant.id, action: 'CASE_REVIEW_DECIDED' } }), auditBeforeRollback);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER qa_reject_p1c_decision ON "CaseReviewDecision"');
      await prisma.$executeRawUnsafe('DROP FUNCTION qa_reject_p1c_decision()');
    }
    const rejected = await call(path(`/reviews/${request.body.id}/decision`), 'POST', { kind: 'REJECTED', reason: 'Need more context', expectedRevision: state.revision + 1 }, reviewer);
    assert.equal(rejected.status, 201, JSON.stringify(rejected.body));
    await assert.rejects(prisma.caseReviewDecision.delete({ where: { id: rejected.body.id } }));
    assert.equal((await call(path('/closure'), 'POST', { reason: 'No approval', investigationSummary: 'Summary', expectedRevision: state.revision + 2 }, admin)).status, 409);
    state = await view();
    const secondRequest = await call(path('/reviews'), 'POST', { reviewerId: a.users.REVIEWER.id, expectedRevision: state.revision }, admin);
    assert.equal(secondRequest.status, 201);
    state = await view();
    const approved = await call(path(`/reviews/${secondRequest.body.id}/decision`), 'POST', { kind: 'APPROVED', reason: 'Evidence supports resolution', expectedRevision: state.revision }, reviewer);
    assert.equal(approved.status, 201, JSON.stringify(approved.body));
    assert.equal((await call(path(`/reviews/${secondRequest.body.id}/decision`), 'POST', { kind: 'REJECTED', reason: 'Retry', expectedRevision: state.revision + 1 }, reviewer)).status, 409);
    state = await view();
    assert.equal((await call(path('/closure'), 'POST', { reason: 'Missing summary', investigationSummary: '', expectedRevision: state.revision }, admin)).status, 400);
    assert.equal((await call(path('/closure'), 'POST', { reason: 'Stale', investigationSummary: 'Summary', expectedRevision: 0 }, admin)).status, 409);
    assert.equal((await call(path('/notes'), 'POST', { requestId: `post-review-${marker}`, content: 'New finding after approval' }, analyst)).status, 201);
    state = await view();
    assert.equal((await call(path('/closure'), 'POST', { reason: 'Changed investigation', investigationSummary: 'Summary', expectedRevision: state.revision }, admin)).status, 409);
    const thirdRequest = await call(path('/reviews'), 'POST', { reviewerId: a.users.REVIEWER.id, expectedRevision: state.revision }, admin);
    assert.equal(thirdRequest.status, 201);
    state = await view();
    assert.equal((await call(path(`/reviews/${thirdRequest.body.id}/decision`), 'POST', { kind: 'APPROVED', reason: 'Updated evidence reviewed', expectedRevision: state.revision }, reviewer)).status, 201);
    state = await view();
    const closure = await call(path('/closure'), 'POST', { reason: 'Containment complete', investigationSummary: 'Investigated signal and confirmed containment.', expectedRevision: state.revision }, admin);
    assert.equal(closure.status, 201, JSON.stringify(closure.body));
    assert.equal((await prisma.case.findUniqueOrThrow({ where: { id: caseRecord.id } })).status, 'CLOSED');
    assert.equal((await call(path('/notes'), 'POST', { requestId: `closed-note-${marker}`, content: 'Blocked' }, analyst)).status, 409);
    assert.equal((await call(path('/evidence'), 'POST', { requestId: `closed-evidence-${marker}`, name: 'Blocked', type: 'log' }, analyst)).status, 409);
    assert.equal((await call(path(''), 'PATCH', { title: 'Blocked' }, admin)).status, 409);
    assert.equal((await call(path('/tasks'), 'POST', { title: 'Blocked', assigneeId: a.users.USER.id, expectedRevision: state.revision + 1 }, admin)).status, 409);
    assert.equal((await call(path('/reopen'), 'POST', { reason: '', expectedRevision: state.revision + 1 }, admin)).status, 400);
    assert.equal((await call(path('/reopen'), 'POST', { reason: 'User', expectedRevision: state.revision + 1 }, analyst)).status, 403);
    assert.equal((await call(path('/reopen'), 'POST', { reason: 'Root missing tenant', expectedRevision: state.revision + 1 }, root)).status, 400);
    const reopened = await call(path(`/reopen?tenantId=${a.tenant.id}`), 'POST', { reason: 'New lead', expectedRevision: state.revision + 1 }, root);
    assert.equal(reopened.status, 201, JSON.stringify(reopened.body));
    assert.equal((await view()).cycle, 2);
    assert.equal((await view()).closures.length, 1);
    assert.equal((await view()).reopens.length, 1);
    await prisma.userModuleAccess.create({ data: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'superadmin@cti.local' } })).id,
      tenantId: a.tenant.id, moduleId: caseModule.id, featureKeys: ['case-v2-reviewer'] } });
    assert.equal((await call(path(''), 'PATCH', { status: 'RESOLVED' }, admin)).status, 200);
    state = await view();
    const rootUser = await prisma.user.findUniqueOrThrow({ where: { email: 'superadmin@cti.local' } });
    assert.equal((await call(path(`/reviews?tenantId=${a.tenant.id}`), 'POST', { reviewerId: rootUser.id, expectedRevision: state.revision }, root)).status, 403);
    const rootReview = await call(path('/reviews'), 'POST', { reviewerId: rootUser.id, expectedRevision: state.revision }, admin);
    assert.equal(rootReview.status, 201, JSON.stringify(rootReview.body));
    state = await view();
    assert.equal((await call(path(`/reviews/${rootReview.body.id}/decision`), 'POST', { kind: 'APPROVED', reason: 'Tenant not selected', expectedRevision: state.revision }, root)).status, 400);
    const rootDecision = await call(path(`/reviews/${rootReview.body.id}/decision?tenantId=${a.tenant.id}`), 'POST', { kind: 'APPROVED', reason: 'Second cycle independently reviewed', expectedRevision: state.revision }, root);
    assert.equal(rootDecision.status, 201, JSON.stringify(rootDecision.body));
    state = await view();
    assert.equal((await call(path('/closure'), 'POST', { reason: 'Second cycle complete', investigationSummary: 'New lead assessed and resolved.', expectedRevision: state.revision }, admin)).status, 201);
    assert.equal((await view()).closures.length, 2);
    await assert.rejects(prisma.caseClosure.delete({ where: { id: closure.body.id } }));
    await assert.rejects(prisma.caseReopen.update({ where: { id: reopened.body.id }, data: { reason: 'tampered' } }));
    assert.equal((await call(path(''), 'DELETE', undefined, admin)).status, 409);
    assert.equal((await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } })).status, 'ACTIVE');
    assert.equal((await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'OPEN');
    assert.equal((await prisma.appSecFinding.findUniqueOrThrow({ where: { id: finding.id } })).status, 'OPEN');
    const auditBefore = await prisma.auditLog.count({ where: { tenantId: a.tenant.id, action: 'CASE_REVIEW_REQUESTED' } });
    state = await view();
    assert.equal((await call(path('/reviews'), 'POST', { reviewerId: a.users.REVIEWER.id, expectedRevision: 0 }, admin)).status, 409);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: a.tenant.id, action: 'CASE_REVIEW_REQUESTED' } }), auditBefore);
    console.log(JSON.stringify({ verdict: 'PASS', database: 'cti_case_v2_p1c_qa_20261031', tenantA: a.tenant.id, tenantB: b.tenant.id,
      adminEmail: a.users.ADMIN.email, reviewerEmail: a.users.REVIEWER.email, analystEmail: a.users.USER.email, caseId: caseRecord.id, checks: 91 }));
  } finally { await app.close(); await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
