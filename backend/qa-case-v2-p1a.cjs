const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require('./dist/src/app.module.js');

const prisma = new PrismaClient();
const password = 'CaseQaPass123!';
const marker = `case-v2-${Date.now()}`;

async function setupTenant(label) {
  const tenant = await prisma.tenant.create({ data: { name: `${label} ${marker}`, slug: `${label}-${marker}` } });
  const hash = await bcrypt.hash(password, 10);
  const users = {};
  for (const role of ['ADMIN', 'USER']) users[role] = await prisma.user.create({ data: { name: `${label} ${role}`, email: `${label}-${role.toLowerCase()}-${marker}@example.test`, passwordHash: hash, role, tenantId: tenant.id } });
  const team = await prisma.subscriptionPackage.findUniqueOrThrow({ where: { name: 'Team' } });
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId: team.id, billingCycle: 'YEARLY', priceMonthly: team.priceMonthly, priceYearly: team.priceYearly, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000 * 365) } });
  const modules = await prisma.appModule.findMany({ include: { features: true } });
  for (const module of modules) {
    const setting = await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, isEnabled: true } });
    for (const role of ['ADMIN', 'USER']) await prisma.moduleRoleAccess.create({ data: { tenantModuleId: setting.id, role, isAllowed: true } });
    for (const role of ['ADMIN', 'USER']) await prisma.userModuleAccess.create({ data: { userId: users[role].id, tenantId: tenant.id, moduleId: module.id, featureKeys: module.features.map(item => item.key) } });
  }
  return { tenant, users };
}

async function main() {
  const a = await setupTenant('a');
  const b = await setupTenant('b');
  const indicator = await prisma.indicator.create({ data: { tenantId: a.tenant.id, value: `qa-${marker}.example`, type: 'DOMAIN', severity: 'HIGH', status: 'ACTIVE' } });
  const asset = await prisma.asset.create({ data: { tenantId: a.tenant.id, name: 'QA asset', value: `asset-${marker}.example`, type: 'DOMAIN' } });
  const alert = await prisma.alert.create({ data: { tenantId: a.tenant.id, source: 'ASM', sourceKey: `qa:${marker}`, title: 'QA alert', assetId: asset.id } });
  const finding = await prisma.assetFinding.create({ data: { tenantId: a.tenant.id, assetId: asset.id, title: 'QA exposure', description: 'QA only', type: 'EXPOSURE', severity: 'HIGH', source: 'QA', sourceKey: marker } });
  const application = await prisma.application.create({ data: { tenantId: a.tenant.id, name: `QA application ${marker}` } });
  const appFinding = await prisma.appSecFinding.create({ data: { tenantId: a.tenant.id, applicationId: application.id, title: 'QA finding', severity: 'HIGH' } });
  const legacyCase = await prisma.case.create({ data: { tenantId: a.tenant.id, caseNumber: `QA-LEGACY-${marker}`, title: 'Legacy source Case', createdBy: a.users.ADMIN.id } });
  const legacyAlert = await prisma.alert.create({ data: { tenantId: a.tenant.id, source: 'ASM', sourceKey: `legacy:${marker}`, title: 'Legacy linked alert', assetId: asset.id, caseId: legacyCase.id } });
  const legacyFinding = await prisma.appSecFinding.create({ data: { tenantId: a.tenant.id, applicationId: application.id, title: 'Legacy linked finding', severity: 'LOW' } });
  await prisma.appSecFindingCase.create({ data: { tenantId: a.tenant.id, findingId: legacyFinding.id, caseId: legacyCase.id } });
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const base = `http://127.0.0.1:${address.port}`;
  async function call(path, method = 'GET', body, cookie, key) {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function login(email) {
    const result = await call('/auth/login', 'POST', { email, password });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.cookie;
  }
  try {
    const admin = await login(a.users.ADMIN.email);
    const user = await login(a.users.USER.email);
    const foreign = await login(b.users.ADMIN.email);
    const root = await login('superadmin@cti.local');
    const create = (kind, sourceId, key, actor = admin, tenantId) => call('/cases/v2', 'POST', { kind, sourceId, title: `QA ${kind}`, ...(tenantId ? { tenantId } : {}) }, actor, key);
    const sources = [['MANUAL', undefined], ['INDICATOR', indicator.id], ['ASM_ALERT', alert.id], ['ASM_FINDING', finding.id], ['APPSEC_FINDING', appFinding.id]];
    const cases = {};
    for (const [kind, id] of sources) {
      const result = await create(kind, id, `first-${kind}`);
      assert.equal(result.status, 201, `${kind} ${JSON.stringify(result.body)}`);
      cases[kind] = result.body.case.id;
      assert.equal(result.body.origin.kind, kind);
      assert.equal(await prisma.caseOrigin.count({ where: { caseId: cases[kind] } }), 1);
    }
    const same = await create('INDICATOR', indicator.id, 'first-INDICATOR');
    assert.equal(same.status, 200);
    assert.equal(same.body.case.id, cases.INDICATOR);
    const another = await create('INDICATOR', indicator.id, 'second-INDICATOR');
    assert.equal(another.status, 201);
    assert.notEqual(another.body.case.id, cases.INDICATOR);
    const conflict = await call('/cases/v2', 'POST', { kind: 'INDICATOR', sourceId: indicator.id, title: 'Changed' }, admin, 'first-INDICATOR');
    assert.equal(conflict.status, 409);
    const reusedAlert = await create('ASM_ALERT', alert.id, 'reuse-alert');
    assert.equal(reusedAlert.status, 200);
    assert.equal(reusedAlert.body.origin.kind, 'ASM_ALERT');
    assert.equal((await create('APPSEC_FINDING', appFinding.id, 'reuse-appsec')).status, 200);
    assert.equal((await create('ASM_ALERT', legacyAlert.id, 'reuse-legacy-alert')).body.case.id, legacyCase.id);
    assert.equal((await create('APPSEC_FINDING', legacyFinding.id, 'reuse-legacy-appsec')).body.origin.kind, 'LEGACY_UNKNOWN');
    assert.equal(await prisma.caseOrigin.count({ where: { caseId: legacyCase.id } }), 0);
    assert.equal(await prisma.caseCreateRequest.count({ where: { caseId: legacyCase.id } }), 2);
    assert.equal((await call(`/cases/${legacyCase.id}`, 'DELETE', undefined, admin)).status, 200);
    assert.equal(await prisma.caseCreateRequest.count({ where: { caseId: legacyCase.id } }), 0);
    assert.equal((await create('MANUAL', undefined, 'user-denied', user)).status, 403);
    assert.equal((await create('INDICATOR', 'missing-indicator', 'missing-source')).status, 404);
    const caseModule = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'case-management' } });
    const caseGrant = await prisma.userModuleAccess.findUniqueOrThrow({ where: { userId_tenantId_moduleId: { userId: a.users.ADMIN.id, tenantId: a.tenant.id, moduleId: caseModule.id } } });
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: a.users.ADMIN.id, tenantId: a.tenant.id, moduleId: caseModule.id } }, data: { featureKeys: caseGrant.featureKeys.filter(key => key !== 'case-v2-origin') } });
    assert.equal((await create('MANUAL', undefined, 'feature-denied')).status, 403);
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: a.users.ADMIN.id, tenantId: a.tenant.id, moduleId: caseModule.id } }, data: { featureKeys: caseGrant.featureKeys } });
    const asmModule = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'attack-surface-management' } });
    const asmGrant = await prisma.userModuleAccess.findUniqueOrThrow({ where: { userId_tenantId_moduleId: { userId: a.users.ADMIN.id, tenantId: a.tenant.id, moduleId: asmModule.id } } });
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: a.users.ADMIN.id, tenantId: a.tenant.id, moduleId: asmModule.id } }, data: { featureKeys: [] } });
    assert.equal((await create('ASM_ALERT', alert.id, 'asm-feature-denied')).status, 403);
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: a.users.ADMIN.id, tenantId: a.tenant.id, moduleId: asmModule.id } }, data: { featureKeys: asmGrant.featureKeys } });
    const userAsmKey = { userId: a.users.USER.id, tenantId: a.tenant.id, moduleId: asmModule.id };
    const userAsmGrant = await prisma.userModuleAccess.findUniqueOrThrow({ where: { userId_tenantId_moduleId: userAsmKey } });
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: userAsmKey }, data: { featureKeys: [] } });
    const redactedNavigation = await call(`/cases/${cases.ASM_ALERT}/origin`, 'GET', undefined, user);
    assert.equal(redactedNavigation.status, 200);
    assert.equal(redactedNavigation.body.navigationPath, null);
    assert.equal(redactedNavigation.body.currentSourceAvailable, null);
    await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: userAsmKey }, data: { featureKeys: userAsmGrant.featureKeys } });
    assert.equal((await create('MANUAL', undefined, 'root-no-tenant', root)).status, 400);
    assert.equal((await create('MANUAL', undefined, 'root-tenant', root, a.tenant.id)).status, 201);
    assert.equal((await create('INDICATOR', indicator.id, 'foreign', foreign)).status, 404);
    assert.equal((await call(`/cases/${cases.INDICATOR}/origin`, 'GET', undefined, foreign)).status, 404);
    assert.equal((await call(`/cases/${cases.INDICATOR}/origin?tenantId=${a.tenant.id}`, 'GET', undefined, root)).status, 200);
    assert.equal((await call(`/cases/${cases.INDICATOR}/origin`, 'GET', undefined, root)).status, 400);
    assert.equal((await call(`/cases/${cases.INDICATOR}/origin?tenantId=${b.tenant.id}`, 'GET', undefined, root)).status, 404);
    assert.equal((await call(`/cases/${cases.INDICATOR}`, 'DELETE', undefined, admin)).status, 409);
    await assert.rejects(prisma.caseOrigin.update({ where: { caseId: cases.INDICATOR }, data: { sourceId: 'altered' } }));
    await assert.rejects(prisma.caseOrigin.delete({ where: { caseId: cases.INDICATOR } }));
    await assert.rejects(prisma.case.delete({ where: { id: cases.INDICATOR } }));
    await prisma.indicator.update({ where: { id: indicator.id }, data: { status: 'INACTIVE' } });
    const historical = await call(`/cases/${cases.INDICATOR}/origin`, 'GET', undefined, admin);
    assert.equal(historical.status, 200);
    assert.equal(historical.body.currentSourceAvailable, false);
    assert.equal(historical.body.navigationPath, null);
    assert.equal(historical.body.snapshot.severity, 'HIGH');
    const legacy = await call('/cases', 'POST', { title: 'QA legacy' }, admin);
    assert.equal(legacy.status, 201);
    assert.equal((await call(`/cases/${legacy.body.id}/origin`, 'GET', undefined, admin)).body.kind, 'LEGACY_UNKNOWN');
    assert.equal((await call(`/cases/${legacy.body.id}`, 'DELETE', undefined, admin)).status, 200);
    const parallel = await Promise.all(Array.from({ length: 6 }, () => create('MANUAL', undefined, 'parallel')));
    assert.equal(new Set(parallel.map(item => item.body.case?.id)).size, 1, JSON.stringify(parallel));
    assert.equal(await prisma.caseCreateRequest.count({ where: { tenantId: a.tenant.id, idempotencyKey: 'parallel' } }), 1);
    const distinct = await Promise.all(['distinct-1', 'distinct-2', 'distinct-3'].map(key => create('MANUAL', undefined, key)));
    assert.ok(distinct.every(item => item.status === 201), JSON.stringify(distinct));
    assert.equal(new Set(distinct.map(item => item.body.case.id)).size, 3);
    assert.equal((await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'OPEN');
    assert.equal((await prisma.appSecFinding.findUniqueOrThrow({ where: { id: appFinding.id } })).status, 'OPEN');
    process.env.CASE_V2_ORIGIN_ENABLED = 'false';
    assert.equal((await create('MANUAL', undefined, 'disabled')).status, 403);
    process.env.CASE_V2_ORIGIN_ENABLED = 'true';
    const rollbackFinding = await prisma.assetFinding.create({ data: { tenantId: a.tenant.id, assetId: asset.id, title: 'Rollback QA', description: 'QA only', type: 'EXPOSURE', severity: 'HIGH', source: 'QA', sourceKey: `rollback-${marker}` } });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION qa_reject_case_origin_${Date.now()}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sourceId" = '${rollbackFinding.id}' THEN RAISE EXCEPTION 'QA rollback'; END IF; RETURN NEW; END $$`);
    const triggerName = `qa_reject_origin_${marker.replaceAll('-', '_')}`;
    const functionName = (await prisma.$queryRawUnsafe(`SELECT proname FROM pg_proc WHERE proname LIKE 'qa_reject_case_origin_%' ORDER BY oid DESC LIMIT 1`))[0].proname;
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "CaseOrigin" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    const rollback = await create('ASM_FINDING', rollbackFinding.id, 'rollback');
    assert.equal(rollback.status, 500);
    assert.equal(await prisma.alert.count({ where: { tenantId: a.tenant.id, source: 'ASM', sourceKey: `finding:${rollbackFinding.id}` } }), 0);
    assert.equal(await prisma.caseCreateRequest.count({ where: { tenantId: a.tenant.id, idempotencyKey: 'rollback' } }), 0);
    await prisma.$executeRawUnsafe(`DROP TRIGGER "${triggerName}" ON "CaseOrigin"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
    console.log(JSON.stringify({ verdict: 'PASS', database: 'cti_case_v2_qa_20261030', tenantA: a.tenant.id, tenantB: b.tenant.id, adminEmail: a.users.ADMIN.email, cases: Object.keys(cases).length, parallel: parallel.length }));
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
