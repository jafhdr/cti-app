const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const net = require('node:net');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { AttackSurfaceManagementModule } = require('../../dist/src/attack-surface-management/attack-surface-management.module');

const candidatePorts = [3389, 6379, 9200, 27017, 445, 1433, 3306, 5432, 21];
async function openProbeTarget() {
  for (const port of candidatePorts) {
    const server = net.createServer(socket => socket.end());
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      return { server, port };
    } catch (error) {
      server.close();
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
    }
  }
  throw new Error('No supported management-service port available for local probe');
}

// Given isolated tenants, real users, an active ASM entitlement and a local TCP target.
// When authenticated HTTP requests pass through all Nest guards and the real Prisma adapter.
// Then status, tenant isolation, finding data and deduplication match the database.
test('ASM Findings: authenticated HTTP against local PostgreSQL', { timeout: 180000 }, async t => {
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, AttackSurfaceManagementModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const tenantIds = [];
  const userIds = [];
  let packageId;
  let target;
  try {
    await app.listen(0, '127.0.0.1');
    const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const asm = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'attack-surface-management' }, include: { features: true } });
    assert.ok(asm.features.some(feature => feature.key === 'asset-management'));
    assert.ok(asm.features.some(feature => feature.key === 'asset-discovery'));
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `Findings HTTP QA ${marker}`, type: 'PREDEFINED', priceMonthly: 0, priceYearly: 0, modules: { create: [{ moduleId: asm.id }] } } });
    packageId = pkg.id;
    for (const label of ['own', 'foreign']) {
      const tenant = await prisma.tenant.create({ data: { name: `Findings QA ${label}`, slug: `findings-qa-${label}-${marker}` } });
      tenantIds.push(tenant.id);
    }
    const [ownTenant, foreignTenant] = tenantIds;
    const renewalAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.tenantSubscription.create({ data: { tenantId: ownTenant, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt } });
    await prisma.tenantModule.create({ data: { tenantId: ownTenant, moduleId: asm.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    const password = `QA-${randomUUID()}`;
    const passwordHash = await bcrypt.hash(password, 4);
    const users = [];
    for (const [role, tenantId] of [['ADMIN', ownTenant], ['USER', ownTenant], ['SUPER_ADMIN', null]]) {
      const user = await prisma.user.create({ data: { name: `${role} Findings QA`, email: `findings-${role.toLowerCase()}-${marker}@example.test`, passwordHash, role, tenantId } });
      users.push(user);
      userIds.push(user.id);
    }
    const [admin, deniedUser, root] = users;
    const allowedUser = await prisma.user.create({ data: { name: 'USER ASM QA', email: `findings-allowed-${marker}@example.test`, passwordHash, role: 'USER', tenantId: ownTenant } });
    users.push(allowedUser);
    userIds.push(allowedUser.id);
    await prisma.userModuleAccess.create({ data: { userId: admin.id, tenantId: ownTenant, moduleId: asm.id, featureKeys: ['asset-management', 'asset-discovery'] } });
    await prisma.userModuleAccess.create({ data: { userId: allowedUser.id, tenantId: ownTenant, moduleId: asm.id, featureKeys: ['asset-management'] } });
    const ownAsset = await prisma.asset.create({ data: { tenantId: ownTenant, name: 'Findings QA IP', type: 'IP_ADDRESS', value: '127.0.0.1' } });
    const foreignAsset = await prisma.asset.create({ data: { tenantId: foreignTenant, name: 'Foreign QA IP', type: 'IP_ADDRESS', value: '192.0.2.250' } });
    const foreignFinding = await prisma.assetFinding.create({ data: { tenantId: foreignTenant, assetId: foreignAsset.id, title: 'Foreign QA finding', description: 'Isolation fixture', type: 'MANUAL', severity: 'LOW', source: 'MANUAL', sourceKey: `qa:${marker}` } });
    const fingerprint = await prisma.assetPortService.create({ data: { tenantId: ownTenant, assetId: ownAsset.id, port: 22, protocol: 'TCP', service: 'ssh', product: 'OpenSSH', version: '8.4', status: 'OPEN', source: 'MANUAL' } });
    const catalogEntry = await prisma.vulnerability.create({ data: { tenantId: ownTenant, cveId: 'CVE-2026-88888', name: 'QA version match', severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionExact: '8.4', source: 'QA' } });
    const cookies = new Map();
    async function request(account, path, method = 'GET', body) {
      const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: cookies.get(account.id) ?? '' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }
    for (const account of users) {
      const response = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password }) });
      assert.equal(response.status, 201, `login ${account.role}`);
      cookies.set(account.id, response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; '));
    }
    const base = `/attack-surface/assets/${ownAsset.id}/findings`;
    const foreignBase = `/attack-surface/assets/${foreignAsset.id}/findings`;
    await t.test('unauthenticated 401 and unassigned USER 403', async () => {
      assert.equal((await request(null, base)).status, 401);
      assert.equal((await request(deniedUser, base)).status, 403);
      assert.equal((await request(deniedUser, `${base}/risk-summary`)).status, 403);
    });
    await t.test('ADMIN list, create, detail and update follow route permissions', async () => {
      assert.deepEqual((await request(admin, base)).body, []);
      const created = await request(admin, base, 'POST', { title: 'QA manual finding', description: 'Observed for HTTP validation', type: 'EXPOSURE', severity: 'HIGH' });
      assert.equal(created.status, 201);
      assert.equal(created.body.tenantId, ownTenant);
      const findingId = created.body.id;
      const listed = await request(admin, base);
      assert.equal(listed.status, 200);
      assert.equal(listed.body.length, 1);
      assert.equal(listed.body[0].id, findingId);
      assert.equal((await request(admin, `${base}/${findingId}`)).body.id, findingId);
      const updated = await request(admin, `${base}/${findingId}`, 'PATCH', { status: 'IN_PROGRESS', severity: 'CRITICAL' });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.status, 'IN_PROGRESS');
      assert.equal(updated.body.severity, 'CRITICAL');
      assert.equal((await request(deniedUser, base, 'POST', { title: 'No', description: 'No', type: 'NO', severity: 'LOW' })).status, 403);
    });
    await t.test('foreign asset and finding IDs are hidden with 404', async () => {
      assert.equal((await request(admin, foreignBase)).status, 404);
      assert.equal((await request(admin, `${foreignBase}?tenantId=${foreignTenant}`)).status, 404);
      assert.equal((await request(admin, `${base}/${foreignFinding.id}`)).status, 404);
      assert.equal((await request(admin, foreignBase, 'POST', { title: 'No', description: 'No', type: 'NO', severity: 'LOW' })).status, 404);
      assert.equal((await prisma.assetFinding.count({ where: { tenantId: foreignTenant } })), 1);
    });
    await t.test('SUPER_ADMIN needs tenant context and can select either tenant', async () => {
      assert.equal((await request(root, base)).status, 400);
      assert.equal((await request(root, `${base}?tenantId=${ownTenant}`)).status, 200);
      assert.equal((await request(root, `${foreignBase}?tenantId=${foreignTenant}`)).body[0].id, foreignFinding.id);
      assert.equal((await request(root, `${base}?tenantId=${foreignTenant}`)).status, 404);
    });
    await t.test('risk summary matches persisted active finding counts', async () => {
      const rows = await prisma.assetFinding.findMany({ where: { tenantId: ownTenant, assetId: ownAsset.id } });
      const active = rows.filter(row => ['OPEN', 'IN_PROGRESS'].includes(row.status));
      const summary = await request(admin, `${base}/risk-summary`);
      assert.equal(summary.status, 200);
      assert.deepEqual(summary.body, {
        total: rows.length,
        critical: active.filter(row => row.severity === 'CRITICAL').length,
        high: active.filter(row => row.severity === 'HIGH').length,
        medium: active.filter(row => row.severity === 'MEDIUM').length,
        low: active.filter(row => row.severity === 'LOW').length,
        open: active.length,
      });
    });
    await t.test('vulnerability correlation route enforces guards, tenant isolation, and reuse', async () => {
      const url = `/attack-surface/assets/${ownAsset.id}/vulnerability-correlations`;
      assert.equal((await request(null, url)).status, 401);
      assert.equal((await request(deniedUser, url)).status, 403);
      assert.equal((await request(admin, url)).status, 200);
      assert.equal((await request(allowedUser, url)).status, 200);
      assert.equal((await request(allowedUser, `${url}/refresh`, 'POST')).status, 403);
      assert.equal((await request(admin, `/attack-surface/assets/${foreignAsset.id}/vulnerability-correlations`)).status, 404);
      assert.equal((await request(root, url)).status, 400);
      assert.equal((await request(root, `${url}?tenantId=${ownTenant}`)).status, 200);
      const first = await request(admin, `${url}/refresh`, 'POST');
      assert.equal(first.status, 201);
      assert.equal(first.body.length, 1);
      assert.equal(first.body[0].vulnerabilityId, catalogEntry.id);
      assert.equal(first.body[0].serviceId, fingerprint.id);
      const second = await request(admin, `${url}/refresh`, 'POST');
      assert.equal(second.body[0].id, first.body[0].id);
      assert.equal(second.body[0].firstSeenAt, first.body[0].firstSeenAt);
      assert.equal((await request(admin, `${url}/${first.body[0].id}`)).status, 200);
      assert.equal((await request(admin, `/attack-surface/assets/${foreignAsset.id}/vulnerability-correlations/${first.body[0].id}`)).status, 404);
    });
    await t.test('discovery schedule and run routes enforce guards and tenant context', async () => {
      const base = `/attack-surface/assets/${ownAsset.id}/discovery`;
      assert.equal((await request(null, `${base}/schedule`)).status, 401);
      assert.equal((await request(deniedUser, `${base}/schedule`)).status, 403);
      assert.equal((await request(allowedUser, `${base}/schedule`)).status, 403);
      assert.equal((await request(admin, `${base}/schedule`)).status, 200);
      assert.equal((await request(admin, `/attack-surface/assets/${foreignAsset.id}/discovery/schedule`)).status, 404);
      assert.equal((await request(root, `${base}/schedule`)).status, 400);
      assert.equal((await request(root, `${base}/schedule?tenantId=${ownTenant}`)).status, 200);
      assert.equal((await request(deniedUser, `${base}/schedule`, 'PATCH', { enabled: true, intervalMinutes: 60 })).status, 403);
      const configured = await request(admin, `${base}/schedule`, 'PATCH', { enabled: false, intervalMinutes: 60 });
      assert.equal(configured.status, 200);
      assert.equal(configured.body.intervalMinutes, 60);
      const run = await request(admin, `${base}/runs`, 'POST');
      assert.equal(run.status, 201);
      assert.ok(run.body.id);
      assert.equal((await request(admin, `${base}/runs`)).body[0].id, run.body.id);
      assert.equal((await request(admin, `${base}/runs/${run.body.id}`)).status, 200);
      assert.equal((await request(admin, `${base}/changes`)).status, 200);
      assert.equal((await request(admin, `/attack-surface/assets/${foreignAsset.id}/discovery/runs/${run.body.id}`)).status, 404);
    });
    await t.test('repeated HTTP port discovery reuses automatic finding and updates last seen', async () => {
      target = await openProbeTarget();
      const discovery = `/attack-surface/assets/${ownAsset.id}/port-services/discover`;
      const first = await request(admin, discovery, 'POST');
      assert.equal(first.status, 201);
      assert.ok(first.body.runId);
      assert.ok(first.body.results.some(row => row.port === target.port && row.status === 'open'));
      const key = `TCP:${target.port}`;
      const where = { tenantId: ownTenant, assetId: ownAsset.id, source: 'PORT_DISCOVERY', sourceKey: key };
      const before = await prisma.assetFinding.findUniqueOrThrow({ where: { tenantId_assetId_source_sourceKey: where } });
      const second = await request(admin, discovery, 'POST');
      assert.equal(second.status, 201);
      const after = await prisma.assetFinding.findUniqueOrThrow({ where: { tenantId_assetId_source_sourceKey: where } });
      assert.equal((await prisma.assetFinding.count({ where })), 1);
      assert.equal(after.id, before.id);
      assert.equal(after.firstSeenAt.getTime(), before.firstSeenAt.getTime());
      assert.ok(after.lastSeenAt.getTime() > before.lastSeenAt.getTime());
    });
  } finally {
    if (target) await new Promise(resolve => target.server.close(resolve));
    await app.close();
    await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId: { in: tenantIds } }, { userId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    if (packageId) await prisma.subscriptionPackage.delete({ where: { id: packageId } });
    await prisma.$disconnect();
  }
});
