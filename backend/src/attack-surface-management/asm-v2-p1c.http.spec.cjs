const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { AttackSurfaceManagementModule } = require('../../dist/src/attack-surface-management/attack-surface-management.module');

test('P1-A/B/C authenticated priority and isolation', { timeout: 120000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^cti_asm(61|62)_qa_/);
  process.env.ASM_V2_EVIDENCE_ENABLED = 'true';
  process.env.ASM_V2_REVIEW_ENABLED = 'true';
  process.env.ASM_V2_PRIORITY_ENABLED = 'true';
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const tenants = [];
  const users = [];
  let packageId;
  let app;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, AttackSurfaceManagementModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const asm = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'attack-surface-management' } });
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `ASM61 ${marker}`, type: 'PREDEFINED', priceMonthly: 0, priceYearly: 0, modules: { create: [{ moduleId: asm.id }] } } });
    packageId = pkg.id;
    for (const suffix of ['own', 'foreign']) {
      const tenant = await prisma.tenant.create({ data: { name: `ASM61 ${suffix}`, slug: `asm61-${suffix}-${marker}` } });
      tenants.push(tenant.id);
      await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: asm.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    }
    const password = randomUUID();
    const passwordHash = await bcrypt.hash(password, 4);
    const accounts = [];
    for (const [role, tenantId, features] of [['ADMIN', tenants[0], ['asset-management', 'asset-correlation-review']], ['USER', tenants[0], ['asset-management']], ['USER', tenants[1], ['asset-management']], ['SUPER_ADMIN', null, []]]) {
      const account = await prisma.user.create({ data: { name: `ASM61 ${role}`, email: `asm61-${accounts.length}-${marker}@example.test`, passwordHash, role, tenantId } });
      users.push(account.id); accounts.push(account);
      if (tenantId) await prisma.userModuleAccess.create({ data: { userId: account.id, tenantId, moduleId: asm.id, featureKeys: features } });
    }
    const [admin, reader, foreign, root] = accounts;
    const asset = await prisma.asset.create({ data: { tenantId: tenants[0], name: 'ASM61 IP', type: 'IP_ADDRESS', value: '192.0.2.161', criticality: 'HIGH' } });
    const service = await prisma.assetPortService.create({ data: { tenantId: tenants[0], assetId: asset.id, protocol: 'TCP', port: 22, product: 'OpenSSH', version: '8.4', source: 'QA', status: 'OPEN' } });
    const vulnerability = await prisma.vulnerability.create({ data: { tenantId: tenants[0], cveId: 'CVE-2026-61001', name: 'ASM61 CVE', severity: 'HIGH', cvssScore: 8.4, affectedProduct: 'OpenSSH', affectedVersionExact: '8.4', source: 'restricted-ti-qa' } });
    const cookies = new Map();
    for (const account of accounts) {
      const login = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password }) });
      assert.equal(login.status, 201);
      cookies.set(account.id, login.headers.getSetCookie().map(value => value.split(';')[0]).join('; '));
    }
    async function request(account, path, method = 'GET', body) {
      const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: cookies.get(account.id) } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }
    const priorityUrl = `/attack-surface/v2/assets/${asset.id}/priority`;
    const refreshUrl = `/attack-surface/assets/${asset.id}/vulnerability-correlations/refresh`;
    const base = `/attack-surface/v2/assets/${asset.id}/correlations`;
    assert.equal((await request(admin, '/attack-surface/v2/enrollment', 'POST', { enabled: true })).status, 201);
    assert.equal((await request(null, priorityUrl)).status, 401);
    assert.equal((await request(foreign, priorityUrl)).status, 403);
    assert.equal((await request(admin, `${priorityUrl}?tenantId=${tenants[1]}`)).status, 403);
    assert.equal((await request(root, priorityUrl)).status, 400);
    assert.equal((await request(root, `${priorityUrl}?tenantId=${tenants[1]}`)).status, 403);
    assert.equal((await request(admin, priorityUrl)).body.priority, 'NOT_ASSESSED');
    const refreshed = await request(admin, refreshUrl, 'POST');
    assert.equal(refreshed.status, 201);
    const id = refreshed.body[0].id;
    assert.equal((await request(admin, priorityUrl)).body.priority, 'NOT_ASSESSED');
    const decisionUrl = `${base}/${id}/decisions`;
    const detail = (await request(admin, `${base}/${id}`)).body;
    const payload = (kind, row) => ({ kind, reason: 'QA inspected current evidence', expectedRevision: row.revision, evidenceHash: row.evidenceHash, requestKey: randomUUID(), inspectedEvidence: true });
    assert.equal((await request(reader, decisionUrl, 'POST', payload('ACCEPT', detail))).status, 403);
    assert.equal((await request(admin, decisionUrl, 'POST', payload('ACCEPT', detail))).status, 201);
    const before = { snapshots: await prisma.asmRiskSnapshot.count({ where: { tenantId: tenants[0] } }), findings: await prisma.assetFinding.count({ where: { tenantId: tenants[0] } }), alerts: await prisma.alert.count({ where: { tenantId: tenants[0] } }), decisions: await prisma.asmCorrelationDecision.count({ where: { tenantId: tenants[0] } }), audits: await prisma.auditLog.count({ where: { tenantId: tenants[0] } }) };
    const accepted = await request(reader, priorityUrl);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.priority, 'HIGH');
    assert.equal(accepted.body.score, 78);
    assert.equal(accepted.body.contributing[0].cveId, vulnerability.cveId);
    assert.equal(accepted.body.contributing[0].factors.assetCriticality, 30);
    assert.equal(accepted.body.contributing[0].factors.tiCvss, 8);
    assert.ok(!JSON.stringify(accepted.body).includes('restricted-ti-qa'));
    assert.ok(!JSON.stringify(accepted.body).includes('tiSnapshot'));
    const again = await request(reader, priorityUrl);
    assert.deepEqual({ ...again.body, asOf: null }, { ...accepted.body, asOf: null });
    assert.deepEqual({ snapshots: await prisma.asmRiskSnapshot.count({ where: { tenantId: tenants[0] } }), findings: await prisma.assetFinding.count({ where: { tenantId: tenants[0] } }), alerts: await prisma.alert.count({ where: { tenantId: tenants[0] } }), decisions: await prisma.asmCorrelationDecision.count({ where: { tenantId: tenants[0] } }), audits: await prisma.auditLog.count({ where: { tenantId: tenants[0] } }) }, before);
    await prisma.assetPortService.update({ where: { id: service.id }, data: { version: '8.4.1' } });
    await prisma.vulnerability.update({ where: { id: vulnerability.id }, data: { affectedVersionExact: '8.4.1' } });
    const changedBeforeRefresh = await request(admin, priorityUrl);
    assert.equal(changedBeforeRefresh.body.priority, 'NOT_ASSESSED');
    assert.equal(changedBeforeRefresh.body.excluded.EVIDENCE_CHANGED, 1);
    assert.equal((await request(admin, refreshUrl, 'POST')).status, 201);
    const changed = (await request(admin, `${base}/${id}`)).body;
    assert.equal(changed.reviewStatus, 'REVIEW_REQUIRED');
    assert.equal((await request(admin, priorityUrl)).body.priority, 'NOT_ASSESSED');
    assert.equal((await request(admin, decisionUrl, 'POST', payload('REJECT', changed))).status, 201);
    assert.equal((await request(admin, priorityUrl)).body.excluded.REJECTED, 1);
    assert.equal((await request(admin, refreshUrl, 'POST')).status, 201);
    assert.equal((await request(admin, priorityUrl)).body.excluded.REJECTED, 1);
    process.env.ASM_V2_PRIORITY_ENABLED = 'false';
    assert.equal((await request(admin, priorityUrl)).status, 403);
  } finally {
    if (app) await app.close();
    await prisma.asmCorrelationDecision.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId: { in: tenants } }, { userId: { in: users } }] } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
    if (packageId) await prisma.subscriptionPackage.delete({ where: { id: packageId } });
    await prisma.$disconnect();
  }
});
