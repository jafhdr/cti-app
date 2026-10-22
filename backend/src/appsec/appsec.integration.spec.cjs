const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const { AppSecModule } = require('../../dist/src/appsec/appsec.module');
const { NotificationOutboxWorker } = require('../../dist/src/notifications/notification-outbox.worker');
const { ModuleAccessService } = require('../../dist/src/auth/module-access.service');
const { createAccessToken } = require('../auth/integration-session.cjs');

const transitions = [
  ['OPEN', 'IN_PROGRESS', 200], ['OPEN', 'RESOLVED', 200],
  ['OPEN', 'ACCEPTED_RISK', 200], ['OPEN', 'FALSE_POSITIVE', 200],
  ['IN_PROGRESS', 'OPEN', 200], ['IN_PROGRESS', 'RESOLVED', 200],
  ['IN_PROGRESS', 'ACCEPTED_RISK', 200], ['IN_PROGRESS', 'FALSE_POSITIVE', 200],
  ['RESOLVED', 'OPEN', 200], ['ACCEPTED_RISK', 'OPEN', 200], ['FALSE_POSITIVE', 'OPEN', 200],
  ['RESOLVED', 'IN_PROGRESS', 400], ['ACCEPTED_RISK', 'RESOLVED', 400], ['FALSE_POSITIVE', 'RESOLVED', 400],
];

test('AppSec real database HTTP lifecycle, tenant and feature access', { timeout: 120000 }, async t => {
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const previousSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = marker;
  const tenants = [];
  const users = [];
  const moduleRef = await Test.createTestingModule({ imports: [AppSecModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const jwt = app.get(JwtService);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    for (const label of ['a', 'b']) tenants.push(await prisma.tenant.create({ data: { name: `AppSec ${label}`, slug: `appsec-${label}-${marker}` } }));
    const [a, b] = tenants;
    const module = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'appsec-posture' }, include: { features: true } });
    for (const key of ['posture-overview', 'advanced-chart', 'application-inventory', 'finding-management']) assert.ok(module.features.some(feature => feature.key === key), key);
    const setting = await prisma.tenantModule.create({ data: { tenantId: a.id, moduleId: module.id, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    const subscription = await prisma.tenantSubscription.create({ data: { tenantId: a.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, renewalAt: new Date(Date.now() + 86400000), status: 'ACTIVE', customModules: { create: { moduleId: module.id } } } });
    for (const [role, tenantId] of [['ADMIN', a.id], ['USER', a.id], ['SUPER_ADMIN', null]]) {
      users.push(await prisma.user.create({ data: { name: role, email: `${role.toLowerCase()}-${marker}@example.test`, passwordHash: 'unused', role, tenantId } }));
    }
    const [admin, user, root] = users;
    for (const account of [admin, user]) await prisma.userModuleAccess.create({ data: { userId: account.id, tenantId: a.id, moduleId: module.id, featureKeys: ['application-inventory', 'finding-management', 'posture-overview'] } });
    const asm = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'attack-surface-management' } });
    await prisma.tenantCustomModule.create({ data: { subscriptionId: subscription.id, moduleId: asm.id } });
    await prisma.tenantModule.create({ data: { tenantId: a.id, moduleId: asm.id, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    await prisma.userModuleAccess.create({ data: { userId: admin.id, tenantId: a.id, moduleId: asm.id, featureKeys: ['asset-management'] } });
    const tokens = new Map(await Promise.all(users.map(async account => [account.id, await createAccessToken(prisma, account.id, marker)])));
    async function call(actor, path, method = 'GET', body) {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(actor ? { authorization: `Bearer ${tokens.get(actor.id)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }
    const appPath = '/appsec/applications';
    const findingPath = '/appsec/findings';
    await t.test('module, feature and role enforcement', async () => {
      assert.equal((await call(null, appPath)).status, 401);
      assert.equal((await call(user, appPath)).status, 200);
      assert.equal((await call(user, appPath, 'POST', { name: 'Denied' })).status, 403);
      await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: user.id, tenantId: a.id, moduleId: module.id } }, data: { featureKeys: [] } });
      assert.equal((await call(user, appPath)).status, 403);
      assert.equal((await call(user, findingPath)).status, 403);
      await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: user.id, tenantId: a.id, moduleId: module.id } }, data: { featureKeys: ['application-inventory', 'finding-management', 'posture-overview'] } });
      await prisma.tenantModule.update({ where: { id: setting.id }, data: { isEnabled: false } });
      assert.equal((await call(admin, appPath)).status, 403);
      await prisma.tenantModule.update({ where: { id: setting.id }, data: { isEnabled: true } });
    });
    const created = await call(admin, appPath, 'POST', { name: 'Portal', criticality: 'HIGH' });
    assert.equal(created.status, 201); const applicationId = created.body.id;
    const foreign = await prisma.application.create({ data: { tenantId: b.id, name: 'Portal' } });
    await t.test('posture feature and required tenant', async () => {
      assert.equal((await call(root, '/appsec/posture')).status, 400);
      assert.equal((await call(admin, '/appsec/posture')).status, 200);
      const access = { userId: user.id, tenantId: a.id, moduleId: module.id };
      await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: access }, data: { featureKeys: ['finding-management'] } });
      assert.equal((await call(user, '/appsec/posture')).status, 403);
      await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: access }, data: { featureKeys: ['application-inventory', 'finding-management', 'posture-overview'] } });
    });
    await t.test('application CRUD and tenant isolation', async () => {
      assert.equal((await call(admin, appPath, 'POST', { name: 'Portal' })).status, 409);
      assert.equal((await call(admin, `${appPath}/${applicationId}`)).status, 200);
      assert.equal((await call(admin, `${appPath}/${foreign.id}`)).status, 404);
      assert.equal((await call(admin, `${appPath}?tenantId=${b.id}`)).status, 403);
      assert.equal((await call(root, appPath)).status, 400);
      assert.equal((await call(root, `${appPath}/${foreign.id}?tenantId=${a.id}`)).status, 404);
      assert.equal((await call(root, `${appPath}/${applicationId}?tenantId=${a.id}`)).status, 200);
      assert.equal((await call(root, `${appPath}?tenantId=${b.id}`, 'POST', { name: 'Root managed' })).status, 201);
      assert.equal((await call(admin, `${appPath}/${applicationId}`, 'PATCH', { owner: 'Team' })).status, 200);
      assert.equal((await call(admin, appPath)).body.total, 1);
    });
    await t.test('ASM relation requires entitlement and keeps both foreign keys tenant scoped', async () => {
      const own = await prisma.asset.create({ data: { tenantId: a.id, name: 'Portal domain', type: 'DOMAIN', value: `portal-${marker}.example.test` } });
      const second = await prisma.asset.create({ data: { tenantId: a.id, name: 'Portal API domain', type: 'DOMAIN', value: `api-${marker}.example.test` } });
      const other = await prisma.asset.create({ data: { tenantId: b.id, name: 'Foreign domain', type: 'DOMAIN', value: `foreign-${marker}.example.test` } });
      const path = `${appPath}/${applicationId}/assets`;
      assert.equal((await call(admin, `${path}/${own.id}`, 'POST')).status, 201);
      assert.equal((await call(admin, `${path}/${second.id}`, 'POST')).status, 201);
      assert.equal((await call(admin, `${path}/${own.id}`, 'POST')).status, 409);
      assert.equal((await call(admin, `${path}/${other.id}`, 'POST')).status, 404);
      assert.equal((await call(root, `${path}/${other.id}?tenantId=${a.id}`, 'POST')).status, 404);
      assert.equal((await call(admin, `${appPath}/${foreign.id}/assets`)).status, 404);
      assert.deepEqual(new Set((await call(admin, path)).body.map((asset) => asset.id)), new Set([own.id, second.id]));
      assert.equal((await call(admin, `${path}/available?search=Portal`)).body.total, 0);
      assert.equal((await call(user, path)).status, 403);
      assert.equal((await call(user, appPath)).body.items[0].linkedAssetCount, null);
      assert.equal((await call(admin, appPath)).body.items[0].linkedAssetCount, 2);
      assert.equal((await call(admin, `${path}/${own.id}`, 'DELETE')).status, 200);
      assert.equal((await call(admin, path)).body.length, 1);
      for (const action of ['APPSEC_APPLICATION_ASSET_LINKED', 'APPSEC_APPLICATION_ASSET_UNLINKED']) {
        const audit = await prisma.auditLog.findFirst({ where: { tenantId: a.id, action, metadata: { path: ['assetId'], equals: own.id } } });
        assert.equal(audit.metadata.applicationId, applicationId);
        assert.equal(audit.metadata.assetId, own.id);
      }
    });
    await t.test('finding creation and tenant isolation', async () => {
      assert.equal((await call(admin, findingPath, 'POST', { applicationId: foreign.id, title: 'Bad', severity: 'HIGH' })).status, 404);
      assert.equal((await call(root, findingPath)).status, 400);
      assert.equal((await call(admin, `${findingPath}?tenantId=${b.id}`)).status, 403);
      const made = await call(admin, findingPath, 'POST', { applicationId, title: 'Manual', severity: 'HIGH', status: 'RESOLVED', source: 'SAST' });
      assert.equal(made.status, 201); assert.equal(made.body.status, 'OPEN'); assert.equal(made.body.source, 'MANUAL');
      const unique = await call(admin, findingPath, 'POST', { applicationId, title: 'Scanner key', severity: 'LOW', sourceKey: 'same-key' });
      assert.equal(unique.status, 201);
      assert.equal((await call(admin, findingPath, 'POST', { applicationId, title: 'Duplicate key', severity: 'LOW', sourceKey: 'same-key' })).status, 409);
      assert.equal((await call(user, `${findingPath}/${made.body.id}`)).status, 200);
      assert.equal((await call(user, `${findingPath}/${made.body.id}`, 'PATCH', { title: 'Denied' })).status, 403);
      const other = await prisma.appSecFinding.create({ data: { tenantId: b.id, applicationId: foreign.id, title: 'Other', severity: 'LOW' } });
      assert.equal((await call(admin, `${findingPath}/${other.id}`)).status, 404);
      assert.equal((await call(root, `${findingPath}/${other.id}?tenantId=${a.id}`)).status, 404);
      assert.equal((await call(user, findingPath, 'POST', { applicationId, title: 'Denied', severity: 'LOW' })).status, 403);
      assert.deepEqual((await call(user, `${findingPath}/applications`)).body.map(item => item.name), ['Portal']);
      const dated = await call(admin, findingPath, 'POST', { applicationId, title: 'Due date', severity: 'LOW', dueDate: '2026-10-20T00:00:00.000Z' });
      assert.equal(dated.status, 201);
      const cleared = await call(admin, `${findingPath}/${dated.body.id}`, 'PATCH', { dueDate: null });
      assert.equal(cleared.status, 200); assert.equal(cleared.body.dueDate, null);
    });
    await t.test('SUPER_ADMIN respects selected tenant cross-module entitlements', async () => {
      const rootApplication = await prisma.application.findFirstOrThrow({ where: { tenantId: b.id, name: 'Root managed' } });
      const rootFinding = await prisma.appSecFinding.create({ data: { tenantId: b.id, applicationId: rootApplication.id, title: 'No entitlement', severity: 'HIGH' } });
      const asset = await prisma.asset.create({ data: { tenantId: b.id, name: 'No entitlement asset', type: 'DOMAIN', value: `denied-${marker}.example.test` } });
      const cve = await prisma.vulnerability.create({ data: { tenantId: b.id, cveId: `CVE-2026-${marker.slice(0, 8)}-denied`, name: 'No entitlement CVE' } });
      const application = `${appPath}/${rootApplication.id}/assets?tenantId=${b.id}`;
      const path = `${findingPath}/${rootFinding.id}`;
      assert.equal((await call(root, application)).status, 403);
      assert.equal((await call(root, `${appPath}/${rootApplication.id}/assets/${asset.id}?tenantId=${b.id}`, 'POST')).status, 403);
      assert.equal((await call(root, `${path}/exposure?tenantId=${b.id}`)).status, 403);
      assert.equal((await call(root, `${path}/vulnerability?tenantId=${b.id}`)).status, 403);
      assert.equal((await call(root, `${path}/vulnerability?tenantId=${b.id}`, 'POST', { vulnerabilityId: cve.id })).status, 403);
      assert.equal((await call(root, `${path}/case?tenantId=${b.id}`)).status, 403);
      assert.equal((await call(root, `${path}/case?tenantId=${b.id}`, 'POST')).status, 403);
      assert.equal((await call(root, `${path}?tenantId=${b.id}`)).status, 200);
      await prisma.appSecFinding.delete({ where: { id: rootFinding.id } });
    });
    await t.test('cross-module workflow and access', async () => {
      const ti = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'threat-intelligence' } });
      const caseModule = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'case-management' } });
      for (const item of [ti, caseModule]) {
        await prisma.tenantCustomModule.create({ data: { subscriptionId: subscription.id, moduleId: item.id } });
        await prisma.tenantModule.create({ data: { tenantId: a.id, moduleId: item.id, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
      }
      for (const account of [admin, user]) {
        await prisma.userModuleAccess.create({ data: { userId: account.id, tenantId: a.id, moduleId: ti.id, featureKeys: ['intelligence-hub'] } });
        await prisma.userModuleAccess.create({ data: { userId: account.id, tenantId: a.id, moduleId: caseModule.id, featureKeys: ['case-workflow'] } });
      }
      const made = await call(admin, findingPath, 'POST', { applicationId, title: 'Cross module issue', severity: 'HIGH', cweId: 'CWE-79' });
      assert.equal(made.status, 201);
      const path = `${findingPath}/${made.body.id}`;
      const own = await prisma.vulnerability.create({ data: { tenantId: a.id, cveId: `CVE-2026-${marker.slice(0, 8)}`, name: 'Own CVE', severity: 'HIGH' } });
      const foreignCve = await prisma.vulnerability.create({ data: { tenantId: b.id, cveId: `CVE-2025-${marker.slice(0, 8)}`, name: 'Foreign CVE' } });
      assert.equal((await call(admin, `${path}/vulnerability`, 'POST', { vulnerabilityId: foreignCve.id })).status, 404);
      assert.equal((await call(root, `${path}/vulnerability?tenantId=${a.id}`, 'POST', { vulnerabilityId: foreignCve.id })).status, 404);
      assert.equal((await call(admin, `${path}/vulnerabilities/available`)).body.total, 1);
      assert.equal((await call(admin, `${path}/vulnerability`, 'POST', { vulnerabilityId: own.id })).status, 201);
      assert.equal((await call(user, `${path}/vulnerability`)).body.cveId, own.cveId);
      assert.equal((await call(user, `${path}/vulnerability`, 'DELETE')).status, 403);
      const ownAsset = await prisma.asset.create({ data: { tenantId: a.id, name: 'Application exposure', type: 'DOMAIN', value: `exposure-${marker}.example.test` } });
      const foreignAsset = await prisma.asset.create({ data: { tenantId: b.id, name: 'Secret asset', type: 'DOMAIN', value: `secret-${marker}.example.test` } });
      await prisma.applicationAsset.create({ data: { tenantId: a.id, applicationId, assetId: ownAsset.id } });
      assert.ok((await call(admin, `${path}/exposure`)).body.some(item => item.id === ownAsset.id));
      assert.equal((await call(user, `${path}/exposure`)).status, 403);
      assert.equal((await call(root, `${path}/exposure?tenantId=${a.id}`)).body.some(item => item.id === foreignAsset.id), false);
      assert.equal((await call(user, `${path}/case`, 'POST')).status, 403);
      const createdCase = await call(admin, `${path}/case`, 'POST');
      assert.equal(createdCase.status, 201, JSON.stringify(createdCase.body));
      assert.equal(createdCase.body.status, 'OPEN'); assert.equal(createdCase.body.tenantId, a.id);
      assert.equal((await call(admin, `${path}/case`, 'POST')).body.id, createdCase.body.id);
      assert.equal((await call(user, `${path}/case`)).body.id, createdCase.body.id);
      assert.equal(await prisma.appSecFindingCase.count({ where: { findingId: made.body.id } }), 1);
      assert.equal(await prisma.case.count({ where: { id: createdCase.body.id } }), 1);
      assert.equal((await call(root, `${path}/case?tenantId=${b.id}`)).status, 403);
      const foreignCase = await prisma.case.create({ data: { tenantId: b.id, caseNumber: 'CASE-2026-00001', title: 'Foreign Case', createdBy: root.id } });
      const unlinkedFinding = await call(admin, findingPath, 'POST', { applicationId, title: 'Foreign Case rejected', severity: 'LOW' });
      await assert.rejects(prisma.appSecFindingCase.create({ data: { findingId: unlinkedFinding.body.id, tenantId: a.id, caseId: foreignCase.id } }), error => error.code === 'P2003');
      assert.equal(await prisma.appSecFindingCase.count({ where: { findingId: unlinkedFinding.body.id } }), 0);

      const concurrentFinding = await call(admin, findingPath, 'POST', { applicationId, title: 'Concurrent Case', severity: 'MEDIUM' });
      const concurrent = await Promise.all([call(admin, `${findingPath}/${concurrentFinding.body.id}/case`, 'POST'), call(admin, `${findingPath}/${concurrentFinding.body.id}/case`, 'POST')]);
      assert.ok(concurrent.every(result => [200, 201].includes(result.status)), JSON.stringify(concurrent));
      assert.equal(concurrent[0].body.id, concurrent[1].body.id);
      const occupiedNumber = (await prisma.case.count({ where: { tenantId: a.id } })) + 2;
      await prisma.case.create({ data: { tenantId: a.id, caseNumber: `CASE-${new Date().getFullYear()}-${String(occupiedNumber).padStart(5, '0')}`, title: 'Existing Case with gap', createdBy: admin.id } });
      const distinctFindings = await Promise.all(['First parallel Case', 'Second parallel Case'].map(title => call(admin, findingPath, 'POST', { applicationId, title, severity: 'MEDIUM' })));
      assert.ok(distinctFindings.every(result => result.status === 201));
      const distinctCases = await Promise.all(distinctFindings.map(result => call(admin, `${findingPath}/${result.body.id}/case`, 'POST')));
      assert.ok(distinctCases.every(result => result.status === 201), JSON.stringify(distinctCases));
      assert.equal(new Set(distinctCases.map(result => result.body.caseNumber)).size, 2);
      assert.ok(distinctCases.every(result => /^CASE-\d{4}-\d{5,}$/.test(result.body.caseNumber)));
      const rollbackFinding = await call(admin, findingPath, 'POST', { applicationId, title: 'Rollback Case link', severity: 'LOW' });
      const beforeCases = await prisma.case.count({ where: { tenantId: a.id } });
      await prisma.$executeRawUnsafe(`CREATE FUNCTION appsec5_reject_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.\"findingId\" = '${rollbackFinding.body.id}' THEN RAISE EXCEPTION 'forced link failure'; END IF; RETURN NEW; END; $$`);
      await prisma.$executeRawUnsafe('CREATE TRIGGER appsec5_reject_link_trigger BEFORE INSERT ON "AppSecFindingCase" FOR EACH ROW EXECUTE FUNCTION appsec5_reject_link()');
      try {
        assert.equal((await call(admin, `${findingPath}/${rollbackFinding.body.id}/case`, 'POST')).status, 500);
        assert.equal(await prisma.case.count({ where: { tenantId: a.id } }), beforeCases);
        assert.equal(await prisma.appSecFindingCase.count({ where: { findingId: rollbackFinding.body.id } }), 0);
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER appsec5_reject_link_trigger ON "AppSecFindingCase"');
        await prisma.$executeRawUnsafe('DROP FUNCTION appsec5_reject_link()');
      }
      for (const action of ['APPSEC_FINDING_VULNERABILITY_LINKED', 'APPSEC_FINDING_CASE_CREATED', 'APPSEC_FINDING_CASE_REUSED']) assert.ok(await prisma.auditLog.count({ where: { tenantId: a.id, action } }), action);
      for (const [moduleId, route, feature] of [[ti.id, 'vulnerability', 'intelligence-hub'], [caseModule.id, 'case', 'case-workflow']]) {
        await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: admin.id, tenantId: a.id, moduleId } }, data: { featureKeys: [] } });
        assert.equal((await call(admin, `${path}/${route}`)).status, 403);
        assert.equal((await call(admin, `${path}/${route}`, 'POST', route === 'case' ? undefined : { vulnerabilityId: own.id })).status, 403);
        assert.equal((await call(admin, path)).status, 200);
        await prisma.userModuleAccess.update({ where: { userId_tenantId_moduleId: { userId: admin.id, tenantId: a.id, moduleId } }, data: { featureKeys: [feature] } });
      }
      assert.equal((await call(admin, `${path}/vulnerability`, 'DELETE')).status, 200);
      assert.equal((await call(admin, `${path}/vulnerability`)).body, null);
      assert.ok(await prisma.auditLog.count({ where: { tenantId: a.id, action: 'APPSEC_FINDING_VULNERABILITY_UNLINKED' } }));
    });
    await t.test('transitions, resolution timestamps and audit', async () => {
      for (const [from, to, expected] of transitions) {
        const made = await call(admin, findingPath, 'POST', { applicationId, title: `${from}-${to}-${randomUUID()}`, severity: 'MEDIUM' });
        if (from !== 'OPEN') {
          const setup = from === 'IN_PROGRESS' ? ['IN_PROGRESS'] : ['IN_PROGRESS', from];
          for (const status of setup) assert.equal((await call(admin, `${findingPath}/${made.body.id}`, 'PATCH', { status, ...(status === 'IN_PROGRESS' ? {} : { resolution: 'Reviewed' }) })).status, 200);
        }
        const before = await prisma.auditLog.count({ where: { tenantId: a.id, action: 'APPSEC_FINDING_STATUS_CHANGED', metadata: { path: ['findingId'], equals: made.body.id } } });
        const result = await call(admin, `${findingPath}/${made.body.id}`, 'PATCH', { status: to, ...(to === 'OPEN' || to === 'IN_PROGRESS' ? {} : { resolution: 'Reviewed' }) });
        assert.equal(result.status, expected, `${from} -> ${to}: ${JSON.stringify(result.body)}`);
        if (expected === 200) {
          assert.equal(Boolean(result.body.resolvedAt), ['RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE'].includes(to));
          if (to === 'OPEN' && ['RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE'].includes(from)) assert.equal(result.body.resolution, null);
          const after = await prisma.auditLog.findMany({ where: { tenantId: a.id, action: 'APPSEC_FINDING_STATUS_CHANGED', metadata: { path: ['findingId'], equals: made.body.id } }, orderBy: { createdAt: 'desc' } });
          assert.equal(after.length, before + 1);
          assert.equal(after[0].metadata.fromStatus, from); assert.equal(after[0].metadata.toStatus, to);
          if (['RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE'].includes(from)) assert.equal(after[0].metadata.previousResolution, 'Reviewed');
          if (['RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE'].includes(to)) assert.equal(after[0].metadata.resolution, 'Reviewed');
        }
      }
      const made = await call(admin, findingPath, 'POST', { applicationId, title: 'Resolution required', severity: 'LOW' });
      assert.equal((await call(admin, `${findingPath}/${made.body.id}`, 'PATCH', { status: 'RESOLVED' })).status, 400);
      const count = await prisma.auditLog.count({ where: { tenantId: a.id, action: 'APPSEC_FINDING_STATUS_CHANGED', metadata: { path: ['findingId'], equals: made.body.id } } });
      assert.equal((await call(admin, `${findingPath}/${made.body.id}`, 'PATCH', { status: 'OPEN', remediationNote: 'Note' })).status, 200);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: a.id, action: 'APPSEC_FINDING_STATUS_CHANGED', metadata: { path: ['findingId'], equals: made.body.id } } }), count);
      for (const action of ['APPSEC_APPLICATION_CREATED', 'APPSEC_APPLICATION_UPDATED', 'APPSEC_FINDING_CREATED', 'APPSEC_FINDING_UPDATED', 'APPSEC_FINDING_STATUS_CHANGED']) assert.ok(await prisma.auditLog.count({ where: { tenantId: a.id, action } }), action);
    });
    await t.test('authenticated high risk delivery, validation and inactive policies', async () => {
      const recipient = await prisma.user.create({ data: { name: 'Notification admin', email: `notification-${marker}@example.test`, passwordHash: 'qa', role: 'ADMIN', tenantId: a.id } });
      users.push(recipient);
      await prisma.userModuleAccess.create({ data: { userId: recipient.id, tenantId: a.id, moduleId: module.id, featureKeys: ['finding-management'] } });
      const high = await call(admin, findingPath, 'POST', { applicationId, title: `High risk ${marker}`, severity: 'CRITICAL' });
      assert.equal(high.status, 201);
      assert.equal(await prisma.notificationOutbox.count({ where: { tenantId: a.id, type: 'APPSEC_FINDING_CREATED_HIGH_RISK', payload: { path: ['findingId'], equals: high.body.id } } }), 1);
      const worker = new NotificationOutboxWorker(prisma, new ModuleAccessService(prisma), { addInterval() {} });
      for (let pass = 0; pass < 20; pass += 1) {
        if (await prisma.notification.findFirst({ where: { tenantId: a.id, resourceId: high.body.id } })) break;
        await worker.runOnce();
      }
      const notice = await prisma.notification.findFirstOrThrow({ where: { tenantId: a.id, resourceId: high.body.id } });
      assert.equal(await prisma.notificationRecipient.count({ where: { notificationId: notice.id, userId: recipient.id } }), 1);
      assert.equal(await prisma.notificationRecipient.count({ where: { notificationId: notice.id, userId: admin.id } }), 0);
      await worker.runOnce();
      assert.equal(await prisma.notification.count({ where: { tenantId: a.id, resourceId: high.body.id } }), 1);
      assert.equal((await call(admin, findingPath, 'POST', { applicationId, title: '', severity: 'HIGH' })).status, 400);
      assert.equal((await call(admin, findingPath, 'POST', { applicationId, title: 'Bad severity', severity: 'EXTREME' })).status, 400);
      assert.equal((await call(admin, `${findingPath}/${high.body.id}`, 'PATCH', { status: 'NOT_A_STATUS' })).status, 400);
      const auditsBefore = await prisma.auditLog.count({ where: { tenantId: a.id, action: 'APPSEC_FINDING_CREATED' } });
      await prisma.$executeRawUnsafe("CREATE FUNCTION appsec_db22_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa outbox rollback'; END $$");
      await prisma.$executeRawUnsafe('CREATE TRIGGER appsec_db22_reject_outbox_trigger BEFORE INSERT ON "NotificationOutbox" FOR EACH ROW EXECUTE FUNCTION appsec_db22_reject_outbox()');
      try { assert.equal((await call(admin, findingPath, 'POST', { applicationId, title: `Rollback ${marker}`, severity: 'HIGH' })).status, 500); }
      finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER appsec_db22_reject_outbox_trigger ON "NotificationOutbox"');
        await prisma.$executeRawUnsafe('DROP FUNCTION appsec_db22_reject_outbox()');
      }
      assert.equal(await prisma.appSecFinding.count({ where: { tenantId: a.id, title: `Rollback ${marker}` } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: a.id, action: 'APPSEC_FINDING_CREATED' } }), auditsBefore);
      await prisma.tenantSubscription.update({ where: { id: subscription.id }, data: { renewalAt: new Date(Date.now() - 1000) } });
      assert.equal((await call(admin, `${findingPath}/${high.body.id}`)).status, 403);
      await prisma.tenantSubscription.update({ where: { id: subscription.id }, data: { renewalAt: new Date(Date.now() + 86400000) } });
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      assert.equal((await call(user, findingPath)).status, 401);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
      await prisma.tenant.update({ where: { id: a.id }, data: { isActive: false } });
      try { assert.equal((await call(admin, findingPath)).status, 401); }
      finally { await prisma.tenant.update({ where: { id: a.id }, data: { isActive: true } }); }
    });
    await t.test('posture aggregates actual tenant findings and excludes foreign data', async () => {
      const c = await prisma.tenant.create({ data: { name: 'AppSec posture', slug: `appsec-posture-${marker}` } });
      tenants.push(c);
      const path = `/appsec/posture?tenantId=${c.id}`;
      assert.equal((await call(root, path)).body.applications.total, 0);
      const first = await call(root, `${appPath}?tenantId=${c.id}`, 'POST', { name: 'Alpha', criticality: 'CRITICAL' });
      const second = await call(root, `${appPath}?tenantId=${c.id}`, 'POST', { name: 'Beta' });
      const onlyApps = (await call(root, path)).body;
      assert.equal(onlyApps.applications.total, 2);
      assert.equal(onlyApps.findings.total, 0);
      const cases = [
        [first.body.id, 'CRITICAL', 'OPEN'],
        [first.body.id, 'HIGH', 'IN_PROGRESS'],
        [second.body.id, 'MEDIUM', 'RESOLVED'],
        [second.body.id, 'LOW', 'FALSE_POSITIVE'],
      ];
      for (const [applicationId, severity, status] of cases) {
        const made = await call(root, `${findingPath}?tenantId=${c.id}`, 'POST', { applicationId, title: `${severity} ${status}`, severity });
        assert.equal(made.status, 201);
        if (status !== 'OPEN') assert.equal((await call(root, `${findingPath}/${made.body.id}?tenantId=${c.id}`, 'PATCH', { status, ...(status === 'IN_PROGRESS' ? {} : { resolution: 'Reviewed' }) })).status, 200);
      }
      const result = await call(root, path);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.applications, { total: 2, active: 2 });
      assert.deepEqual(result.body.findings, { total: 4, active: 2, resolved: 2 });
      assert.deepEqual(result.body.severity, { critical: 1, high: 1, medium: 1, low: 1 });
      assert.deepEqual(result.body.status, { open: 1, inProgress: 1, resolved: 1, acceptedRisk: 0, falsePositive: 1 });
      assert.equal(result.body.applicationsWithActiveFindings, 1);
      assert.deepEqual(result.body.topApplications.map(item => [item.name, item.activeFindings, item.criticalFindings, item.highFindings]), [['Alpha', 2, 1, 1]]);
      assert.equal((await call(root, `/appsec/posture?tenantId=${b.id}`)).body.findings.total, 1);
      assert.equal((await call(admin, path)).status, 403);
    });
  } finally {
    await app.close();
    for (const tenant of tenants) await prisma.case.deleteMany({ where: { tenantId: tenant.id } });
    for (const account of users) await prisma.user.delete({ where: { id: account.id } });
    for (const tenant of tenants) {
      await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
    await prisma.$disconnect();
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previousSecret;
  }
});

