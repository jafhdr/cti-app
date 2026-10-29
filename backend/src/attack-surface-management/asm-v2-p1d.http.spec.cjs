const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const { PrismaClient, Prisma } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { AttackSurfaceManagementModule } = require('../../dist/src/attack-surface-management/attack-surface-management.module');
const { AsmV2EvidenceService } = require('../../dist/src/attack-surface-management/asm-v2-evidence.service');

test('ASM V2 P1-D operational reporting reuses reviewed priority without writes', { timeout: 120000 }, async () => {
  assert.equal(new URL(process.env.DATABASE_URL).pathname.slice(1), 'cti_asm62_qa_20261029_0930');
  process.env.ASM_V2_EVIDENCE_ENABLED = 'true';
  process.env.ASM_V2_REVIEW_ENABLED = 'true';
  process.env.ASM_V2_PRIORITY_ENABLED = 'true';
  process.env.ASM_V2_OPERATIONS_ENABLED = 'true';
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
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `ASM62 ${marker}`, type: 'PREDEFINED', priceMonthly: 0, priceYearly: 0, modules: { create: [{ moduleId: asm.id }] } } });
    packageId = pkg.id;
    for (const suffix of ['a', 'b']) {
      const tenant = await prisma.tenant.create({ data: { name: `ASM62 ${suffix}`, slug: `asm62-${suffix}-${marker}` } });
      tenants.push(tenant.id);
      await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: asm.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    }
    const password = randomUUID();
    const passwordHash = await bcrypt.hash(password, 4);
    const accounts = [];
    for (const [role, tenantId, features] of [['ADMIN', tenants[0], ['asset-management', 'asset-correlation-review']], ['USER', tenants[0], ['asset-management']], ['USER', tenants[1], ['asset-management']], ['SUPER_ADMIN', null, []]]) {
      const account = await prisma.user.create({ data: { name: `ASM62 ${role}`, email: `asm62-${accounts.length}-${marker}@example.test`, passwordHash, role, tenantId } });
      users.push(account.id); accounts.push(account);
      if (tenantId) await prisma.userModuleAccess.create({ data: { userId: account.id, tenantId, moduleId: asm.id, featureKeys: features } });
    }
    const [admin, reader, foreign, root] = accounts;
    const asset = await prisma.asset.create({ data: { tenantId: tenants[0], name: 'ASM62 high', type: 'IP_ADDRESS', value: '192.0.2.210', criticality: 'HIGH' } });
    const overcap = await prisma.asset.create({ data: { tenantId: tenants[0], name: 'ASM62 overcap', type: 'IP_ADDRESS', value: '192.0.2.211', criticality: 'CRITICAL' } });
    for (let index = 0; index < 10; index++) await prisma.asset.create({ data: { tenantId: tenants[0], name: `ASM62 empty ${index}`, type: 'IP_ADDRESS', value: `192.0.2.${220 + index}` } });
    const service = await prisma.assetPortService.create({ data: { tenantId: tenants[0], assetId: asset.id, protocol: 'TCP', port: 22, product: 'OpenSSH', version: '8.4', source: 'QA', status: 'OPEN' } });
    for (const [cveId, name] of [['CVE-2026-62001', 'Valid'], ['CVE-2026-62002', 'False'], ['CVE-2026-62003', 'Pending']]) {
      await prisma.vulnerability.create({ data: { tenantId: tenants[0], cveId, name, severity: 'HIGH', cvssScore: cveId.endsWith('1') ? 8.4 : null, affectedProduct: 'OpenSSH', affectedVersionExact: '8.4', source: 'PRIVATE_TI_SOURCE' } });
    }
    const overVuln = await prisma.vulnerability.create({ data: { tenantId: tenants[0], cveId: 'CVE-2026-62999', name: 'Overcap', severity: 'CRITICAL', affectedProduct: 'OtherProduct', affectedVersionExact: '8.4' } });
    await prisma.assetPortService.createMany({ data: Array.from({ length: 101 }, (_, index) => ({ tenantId: tenants[0], assetId: overcap.id, protocol: 'TCP', port: 1000 + index, product: 'OpenSSH', version: '8.4', status: 'OPEN' })) });
    const overServices = await prisma.assetPortService.findMany({ where: { tenantId: tenants[0], assetId: overcap.id }, select: { id: true } });
    await prisma.assetVulnerabilityCorrelation.createMany({ data: overServices.map(item => ({ tenantId: tenants[0], assetId: overcap.id, serviceId: item.id, vulnerabilityId: overVuln.id, confidence: 'HIGH', status: 'ACTIVE', workflowVersion: 2, revision: 1, reviewStatus: 'ACCEPTED', evidenceHash: 'QA_HASH', reviewedEvidenceHash: 'QA_HASH', matchReason: 'QA overcap', evidence: {} })) });
    const cookies = new Map();
    for (const account of accounts) {
      const login = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password }) });
      assert.equal(login.status, 201);
      cookies.set(account.id, login.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; '));
    }
    async function request(account, route, method = 'GET', body) {
      const response = await fetch(api + route, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: cookies.get(account.id) } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }
    const summary = '/attack-surface/v2/operations/summary';
    const assets = '/attack-surface/v2/operations/assets';
    assert.equal((await request(null, summary)).status, 401);
    assert.equal((await request(root, summary)).status, 400);
    assert.equal((await request(foreign, summary)).status, 403);
    assert.equal((await request(admin, `${summary}?tenantId=${tenants[1]}`)).status, 403);
    assert.equal((await request(admin, '/attack-surface/v2/enrollment', 'POST', { enabled: true })).status, 201);
    const refresh = `/attack-surface/assets/${asset.id}/vulnerability-correlations/refresh`;
    assert.equal((await request(admin, refresh, 'POST')).status, 201);
    const rows = await prisma.assetVulnerabilityCorrelation.findMany({ where: { tenantId: tenants[0], assetId: asset.id }, include: { vulnerability: true } });
    const byCve = new Map(rows.map(row => [row.vulnerability.cveId, row]));
    const decide = async (cve, kind) => {
      const row = byCve.get(cve);
      return request(admin, `/attack-surface/v2/assets/${asset.id}/correlations/${row.id}/decisions`, 'POST', { kind, reason: `ASM62 ${kind} inspected`, expectedRevision: row.revision, evidenceHash: row.evidenceHash, requestKey: randomUUID(), inspectedEvidence: true });
    };
    assert.equal((await decide('CVE-2026-62001', 'ACCEPT')).status, 201);
    assert.equal((await decide('CVE-2026-62002', 'REJECT')).status, 201);
    await prisma.assetFinding.create({ data: { tenantId: tenants[0], assetId: asset.id, title: 'Historical V1 finding', description: 'QA historical', type: 'QA', source: 'MANUAL', sourceKey: 'QA_V1_OPEN', severity: 'HIGH', status: 'OPEN' } });
    const before = { finding: await prisma.assetFinding.count({ where: { tenantId: tenants[0] } }), alert: await prisma.alert.count({ where: { tenantId: tenants[0] } }), decisions: await prisma.asmCorrelationDecision.count({ where: { tenantId: tenants[0] } }), audits: await prisma.auditLog.count({ where: { tenantId: tenants[0] } }), snapshots: await prisma.asmRiskSnapshot.count({ where: { tenantId: tenants[0] } }) };
    const first = await request(reader, summary);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.metrics.totalAssets, 12);
    assert.equal(first.body.metrics.correlations.total, 104);
    assert.equal(first.body.metrics.correlations.pending, 1);
    assert.equal(first.body.metrics.correlations.accepted, 102);
    assert.equal(first.body.metrics.correlations.rejected, 1);
    assert.equal(first.body.metrics.correlations.active, 104);
    assert.equal(first.body.metrics.correlations.stale, 0);
    assert.equal(first.body.metrics.correlations.fresh, 104);
    assert.equal(first.body.metrics.actionableCorrelations, 1);
    assert.equal(first.body.metrics.highPriorityAssets, 1);
    assert.equal(first.body.metrics.notAssessedAssets, 11);
    assert.equal(first.body.metrics.limitExceededAssets, 1);
    const aggregatePlan = await prisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT count(*) FROM "AssetVulnerabilityCorrelation" WHERE "tenantId" = ${tenants[0]} AND "workflowVersion" = 2`;
    const rankedPlan = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) WITH ranked AS (SELECT id, "assetId", ROW_NUMBER() OVER (PARTITION BY "assetId" ORDER BY id) AS rn FROM "AssetVulnerabilityCorrelation" WHERE "tenantId" = ${tenants[0]} AND "assetId" IN (${Prisma.join([asset.id, overcap.id])})) SELECT id FROM ranked WHERE rn <= 101`);
    for (const [name, plan] of [['aggregate', aggregatePlan], ['ranked', rankedPlan]]) {
      const detail = plan[0]['QUERY PLAN'][0];
      const nodes = [];
      const walk = node => { nodes.push({ type: node['Node Type'], index: node['Index Name'] ?? null, rows: node['Actual Rows'] }); for (const child of node.Plans ?? []) walk(child); };
      walk(detail.Plan);
      console.log(`ASM62 PROFILE ${name}: ${JSON.stringify({ nodes, ms: detail['Execution Time'], buffers: detail.Plan['Shared Hit Blocks'] })}`);
    }
    const high = await request(reader, `${assets}?priority=HIGH&limit=1`);
    assert.equal(high.status, 200, JSON.stringify(high.body));
    assert.equal(high.body.total, 1);
    assert.equal(high.body.items[0].assetId, asset.id);
    assert.equal(high.body.items[0].score, 78);
    assert.equal((await request(reader, `${assets}?q=ASM62%20high&limit=5`)).body.total, 1);
    assert.ok(!JSON.stringify(high.body).includes('PRIVATE_TI_SOURCE'));
    const unknown = await request(reader, `${assets}?priority=NOT_ASSESSED&limit=25`);
    assert.equal(unknown.body.total, 11);
    assert.ok(unknown.body.items.some(item => item.assetId === overcap.id && item.missing.includes('CORRELATION_LIMIT_EXCEEDED')));
    const seen = new Set();
    let cursor = null;
    do {
      const page = await request(reader, `${assets}?limit=5${cursor ? `&cursor=${cursor}` : ''}`);
      assert.equal(page.status, 200);
      assert.equal(page.body.total, 12);
      for (const item of page.body.items) { assert.ok(!seen.has(item.assetId)); seen.add(item.assetId); }
      cursor = page.body.nextCursor;
    } while (cursor);
    assert.equal(seen.size, 12);
    assert.equal((await request(reader, `${assets}?priority=NOPE`)).status, 400);
    assert.equal((await request(reader, `${assets}?limit=26`)).status, 400);
    assert.equal((await request(reader, `${assets}?cursor=foreign-id`)).status, 404);
    assert.deepEqual({ finding: await prisma.assetFinding.count({ where: { tenantId: tenants[0] } }), alert: await prisma.alert.count({ where: { tenantId: tenants[0] } }), decisions: await prisma.asmCorrelationDecision.count({ where: { tenantId: tenants[0] } }), audits: await prisma.auditLog.count({ where: { tenantId: tenants[0] } }), snapshots: await prisma.asmRiskSnapshot.count({ where: { tenantId: tenants[0] } }) }, before);
    assert.equal((await request(reader, `/attack-surface/v2/assets/${asset.id}/correlations/${byCve.get('CVE-2026-62003').id}/decisions`, 'POST', { kind: 'ACCEPT' })).status, 403);
    await prisma.vulnerability.update({ where: { tenantId_cveId: { tenantId: tenants[0], cveId: 'CVE-2026-62001' } }, data: { cvssScore: null } });
    const missingCvss = await request(reader, `${assets}?priority=HIGH`);
    assert.equal(missingCvss.body.items[0].score, 70);
    assert.ok(missingCvss.body.items[0].missing.includes('TI_CVSS_UNAVAILABLE'));
    await prisma.vulnerability.update({ where: { tenantId_cveId: { tenantId: tenants[0], cveId: 'CVE-2026-62001' } }, data: { cvssScore: 8.4 } });
    const old = new Date(Date.now() - 31 * 86400000);
    await prisma.assetPortService.update({ where: { id: service.id }, data: { lastSeenAt: old } });
    const expired = await request(admin, summary);
    assert.equal(expired.body.metrics.actionableCorrelations, 0);
    assert.ok(expired.body.metrics.staleSourceExclusions >= 1);
    await prisma.assetPortService.update({ where: { id: service.id }, data: { lastSeenAt: new Date() } });
    const staleRun = await prisma.asmDiscoveryRun.create({ data: { tenantId: tenants[0], assetId: asset.id, source: 'QA_COMPLETE', status: 'COMPLETED' } });
    await prisma.assetPortService.update({ where: { id: service.id }, data: { status: 'CLOSED', lastSeenAt: new Date() } });
    await app.get(AsmV2EvidenceService).markNotObserved(tenants[0], asset.id, byCve.get('CVE-2026-62001').id, staleRun.id);
    const acceptedButStale = await request(admin, summary);
    assert.equal(acceptedButStale.body.metrics.correlations.accepted, 102);
    assert.equal(acceptedButStale.body.metrics.correlations.stale, 1);
    assert.equal(acceptedButStale.body.metrics.actionableCorrelations, 0);
    await prisma.assetPortService.update({ where: { id: service.id }, data: { status: 'OPEN', lastSeenAt: new Date() } });
    assert.equal((await request(admin, refresh, 'POST')).status, 201);
    assert.equal((await request(admin, summary)).body.metrics.actionableCorrelations, 1);
    await prisma.assetPortService.update({ where: { id: service.id }, data: { version: '8.4.1' } });
    await prisma.vulnerability.updateMany({ where: { tenantId: tenants[0], cveId: { in: ['CVE-2026-62001', 'CVE-2026-62002', 'CVE-2026-62003'] } }, data: { affectedVersionExact: '8.4.1' } });
    assert.equal((await request(admin, refresh, 'POST')).status, 201);
    const changed = await request(admin, summary);
    assert.equal(changed.body.metrics.correlations.reviewRequired, 2);
    assert.equal(changed.body.metrics.actionableCorrelations, 0);
    assert.equal(changed.body.metrics.highPriorityAssets, 0);
    const run = await prisma.asmDiscoveryRun.create({ data: { tenantId: tenants[0], assetId: asset.id, source: 'QA_COMPLETE', status: 'COMPLETED' } });
    await prisma.assetPortService.update({ where: { id: service.id }, data: { status: 'CLOSED', lastSeenAt: new Date() } });
    await app.get(AsmV2EvidenceService).markNotObserved(tenants[0], asset.id, byCve.get('CVE-2026-62001').id, run.id);
    const stale = await request(admin, summary);
    assert.equal(stale.body.metrics.correlations.stale, 1);
    assert.equal(stale.body.metrics.correlations.reviewRequired, 2);
    process.env.ASM_V2_OPERATIONS_ENABLED = 'false';
    assert.equal((await request(admin, summary)).status, 403);
    assert.equal((await request(admin, assets)).status, 403);
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
