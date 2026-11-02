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

test('ASM V2 P1-A real HTTP guards, enrollment and evidence', { timeout: 120000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL || 'postgresql://invalid/cti').pathname.slice(1), /^cti_asm(59|60|61|62)_qa_/);
  const previousFlag = process.env.ASM_V2_EVIDENCE_ENABLED;
  process.env.ASM_V2_EVIDENCE_ENABLED = 'true';
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const tenantIds = [];
  const userIds = [];
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
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `ASM59 ${marker}`, type: 'PREDEFINED', priceMonthly: 0, priceYearly: 0, modules: { create: [{ moduleId: asm.id }] } } });
    packageId = pkg.id;
    const own = await prisma.tenant.create({ data: { name: 'ASM59 own', slug: `asm59-own-${marker}` } });
    const foreign = await prisma.tenant.create({ data: { name: 'ASM59 foreign', slug: `asm59-foreign-${marker}` } });
    tenantIds.push(own.id, foreign.id);
    await prisma.tenantSubscription.create({ data: { tenantId: own.id, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
    await prisma.tenantModule.create({ data: { tenantId: own.id, moduleId: asm.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    const password = randomUUID();
    const passwordHash = await bcrypt.hash(password, 4);
    const accounts = [];
    for (const role of ['ADMIN', 'USER', 'USER', 'SUPER_ADMIN']) {
      const account = await prisma.user.create({ data: { name: `ASM59 ${role}`, email: `asm59-${role.toLowerCase()}-${accounts.length}-${marker}@example.test`, passwordHash, role, tenantId: role === 'SUPER_ADMIN' ? null : own.id } });
      accounts.push(account); userIds.push(account.id);
    }
    const [admin, user, denied, root] = accounts;
    await prisma.userModuleAccess.create({ data: { userId: admin.id, tenantId: own.id, moduleId: asm.id, featureKeys: ['asset-management'] } });
    await prisma.userModuleAccess.create({ data: { userId: user.id, tenantId: own.id, moduleId: asm.id, featureKeys: ['asset-management'] } });
    const asset = await prisma.asset.create({ data: { tenantId: own.id, name: 'ASM59 IP', type: 'IP_ADDRESS', value: '192.0.2.80' } });
    const foreignAsset = await prisma.asset.create({ data: { tenantId: foreign.id, name: 'Foreign', type: 'IP_ADDRESS', value: '192.0.2.81' } });
    await prisma.assetPortService.create({ data: { tenantId: own.id, assetId: asset.id, protocol: 'TCP', port: 22, product: 'OpenSSH', version: '8.4', source: 'QA', status: 'OPEN' } });
    await prisma.vulnerability.create({ data: { tenantId: own.id, cveId: 'CVE-2026-59001', name: 'QA CVE', severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionExact: '8.4' } });
    const cookies = new Map();
    for (const account of accounts) {
      const response = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password }) });
      assert.equal(response.status, 201, JSON.stringify(await response.json()));
      cookies.set(account.id, response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; '));
    }
    async function request(account, path, method = 'GET', body) {
      const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Cookie: cookies.get(account.id) } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }
    const base = `/attack-surface/v2/assets/${asset.id}/correlations`;
    assert.equal((await request(null, base)).status, 401);
    assert.equal((await request(denied, base)).status, 403);
    assert.equal((await request(root, base)).status, 400);
    assert.equal((await request(admin, `/attack-surface/v2/assets/${foreignAsset.id}/correlations`)).status, 404);
    assert.equal((await request(admin, `${base}?tenantId=${foreign.id}`)).status, 403);
    assert.equal((await request(user, '/attack-surface/v2/enrollment', 'POST', { enabled: true })).status, 403);
    assert.equal((await request(root, '/attack-surface/v2/enrollment', 'POST', { enabled: true })).status, 400);
    assert.equal((await request(admin, '/attack-surface/v2/enrollment', 'POST', { enabled: true })).status, 201);
    assert.equal((await request(admin, '/attack-surface/v2/enrollment')).body.active, true);
    const refreshed = await request(admin, `/attack-surface/assets/${asset.id}/vulnerability-correlations/refresh`, 'POST');
    assert.equal(refreshed.status, 201);
    assert.equal(refreshed.body[0].workflowVersion, 2);
    const id = refreshed.body[0].id;
    assert.equal((await request(user, base)).body[0].id, id);
    assert.equal((await request(admin, `${base}/${id}`)).status, 200);
    const history = await request(user, `${base}/${id}/observations`);
    assert.equal(history.status, 200);
    assert.equal(history.body.total, 1);
    assert.equal(history.body.items[0].kind, 'MATCHED');
    assert.equal((await request(admin, `${base}/${id}/observations?page=0`)).status, 400);
    assert.equal((await request(admin, `/attack-surface/v2/assets/${foreignAsset.id}/correlations/${id}`)).status, 404);
    assert.equal((await request(user, `${base}/${id}/activate`, 'POST')).status, 403);
    assert.equal(await prisma.assetFinding.count({ where: { tenantId: own.id, assetId: asset.id } }), 0);
  } finally {
    if (app) await app.close();
    await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId: { in: tenantIds } }, { userId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    if (packageId) await prisma.subscriptionPackage.delete({ where: { id: packageId } });
    await prisma.$disconnect();
    if (previousFlag === undefined) delete process.env.ASM_V2_EVIDENCE_ENABLED;
    else process.env.ASM_V2_EVIDENCE_ENABLED = previousFlag;
  }
});
