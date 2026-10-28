const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');
const { AppSecModule } = require('../../dist/src/appsec/appsec.module');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('P1-D reporting reconciles a tenant creation cohort and protects read access', { timeout: 120000 }, async () => {
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const previous = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = marker;
  const moduleRef = await Test.createTestingModule({ imports: [AppSecModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const tenant = await prisma.tenant.create({ data: { name: 'P1D A', slug: `p1d-a-${marker}` } });
    const foreignTenant = await prisma.tenant.create({ data: { name: 'P1D B', slug: `p1d-b-${marker}` } });
    const module = await prisma.appModule.upsert({ where: { slug: 'appsec-posture' }, update: {}, create: { slug: 'appsec-posture', name: 'AppSec', description: 'QA', category: 'APPSEC', features: { create: { key: 'finding-management', name: 'Finding Management' } } } });
    await prisma.moduleFeature.upsert({ where: { moduleId_key: { moduleId: module.id, key: 'finding-management' } }, update: {}, create: { moduleId: module.id, key: 'finding-management', name: 'Finding Management' } });
    await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, renewalAt: new Date(Date.now() + 86400000), status: 'ACTIVE', customModules: { create: { moduleId: module.id } } } });
    await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    async function account(name, role, tenantId, features = []) {
      const person = await prisma.user.create({ data: { name, email: `p1d-${name}-${marker}@example.test`, passwordHash: 'unused', role, tenantId } });
      if (features.length) await prisma.userModuleAccess.create({ data: { userId: person.id, tenantId, moduleId: module.id, featureKeys: features } });
      return person;
    }
    const admin = await account('admin', 'ADMIN', tenant.id, ['finding-management']);
    const reader = await account('reader', 'USER', tenant.id, ['finding-management']);
    const denied = await account('denied', 'USER', tenant.id);
    const root = await account('root', 'SUPER_ADMIN', null);
    const foreign = await account('foreign', 'USER', foreignTenant.id);
    const application = await prisma.application.create({ data: { tenantId: tenant.id, name: 'P1D Application' } });
    const foreignApplication = await prisma.application.create({ data: { tenantId: foreignTenant.id, name: 'Foreign' } });
    const tokens = new Map(await Promise.all([admin, reader, denied, root, foreign].map(async person => [person.id, await createAccessToken(prisma, person.id, marker)])));
    async function get(actor, path) {
      const response = await fetch(base + path, { headers: actor ? { authorization: `Bearer ${tokens.get(actor.id)}` } : {} });
      return { status: response.status, body: await response.json() };
    }
    const day = 86400000;
    const now = Date.now();
    async function finding(title, status, options = {}) {
      return prisma.appSecFinding.create({ data: { tenantId: tenant.id, applicationId: application.id, title, severity: 'HIGH', source: 'MANUAL', status,
        workflowVersion: options.workflowVersion ?? 2, assigneeId: options.assigneeId ?? null, priority: options.priority ?? null,
        verificationState: options.verificationState ?? null, dueDate: options.dueDate ?? null,
        firstSeenAt: options.firstSeenAt ?? new Date(now), createdAt: options.createdAt ?? new Date(now - day),
        ...(status === 'RESOLVED' || status === 'ACCEPTED_RISK' || status === 'FALSE_POSITIVE' ? { resolution: 'QA decision', resolvedAt: new Date(now) } : {}) } });
    }
    await finding('Open assigned overdue', 'OPEN', { assigneeId: admin.id, priority: 'HIGH', dueDate: new Date(now - day), firstSeenAt: new Date(now - 7 * day) });
    await finding('Awaiting', 'IN_PROGRESS', { assigneeId: admin.id, verificationState: 'REQUESTED', firstSeenAt: new Date(now - 8 * day) });
    await finding('Rework', 'IN_PROGRESS', { verificationState: 'REJECTED', firstSeenAt: new Date(now - 31 * day) });
    await finding('Legacy open', 'OPEN', { workflowVersion: 1, firstSeenAt: new Date(now - 91 * day) });
    await finding('Resolved', 'RESOLVED', { assigneeId: reader.id });
    await finding('Accepted', 'ACCEPTED_RISK');
    await finding('False alarm', 'FALSE_POSITIVE');
    await finding('Outside default period', 'OPEN', { createdAt: new Date(now - 40 * day) });
    await finding('At inclusive boundary', 'OPEN', { createdAt: new Date(now - 50 * day) });
    await finding('Inside old cohort', 'OPEN', { createdAt: new Date(now - 45 * day) });
    await prisma.appSecFinding.create({ data: { tenantId: foreignTenant.id, applicationId: foreignApplication.id, title: 'Foreign private', severity: 'LOW', source: 'MANUAL', status: 'OPEN' } });
    const auditBefore = await prisma.auditLog.count({ where: { tenantId: tenant.id } });
    const metrics = await get(reader, '/appsec/findings/operational-metrics');
    assert.equal(metrics.status, 200, JSON.stringify(metrics.body));
    assert.deepEqual(metrics.body.totals, { open: 4, assigned: 2, unassigned: 2, overdue: 1, awaitingVerification: 1, rework: 1, resolved: 1, acceptedRisk: 1, falsePositive: 1 });
    assert.deepEqual(metrics.body.aging.map(item => item.count), [1, 1, 1, 1]);
    assert.equal(metrics.body.owners.reduce((sum, item) => sum + item.open, 0), 4);
    assert.equal(metrics.body.owners.find(item => item.assigneeId === admin.id).name, admin.name);
    assert.equal(metrics.body.owners.some(item => item.assigneeId === reader.id), false);
    assert.equal(metrics.body.filterOwners.find(item => item.assigneeId === reader.id).name, reader.name);
    assert.equal(metrics.body.totals.open + metrics.body.totals.resolved + metrics.body.totals.acceptedRisk + metrics.body.totals.falsePositive, 7);
    const queue = await get(reader, '/appsec/findings/queue?limit=3');
    assert.equal(queue.status, 200);
    assert.equal(queue.body.total, 7);
    assert.equal(queue.body.items.length, 3);
    assert.deepEqual(queue.body.items.map(item => item.id), [...queue.body.items].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || b.id.localeCompare(a.id)).map(item => item.id));
    assert.ok(queue.body.items.every(item => !('email' in item) && !('passwordHash' in item)));
    const overdue = await get(reader, '/appsec/findings/queue?overdue=true&status=RESOLVED');
    assert.equal(overdue.body.total, 0);
    assert.equal((await get(reader, '/appsec/findings/queue?overdue=true')).body.total, 1);
    assert.equal((await get(reader, `/appsec/findings/operational-metrics?ownerId=${admin.id}`)).body.totals.open, 2);
    assert.equal((await get(reader, '/appsec/findings/operational-metrics?ownerId=unassigned')).body.totals.open, 2);
    assert.equal((await get(reader, `/appsec/findings/queue?ownerId=${foreign.id}`)).body.total, 0);
    const from = new Date(now - 2 * day).toISOString();
    const to = new Date(now - day + 1000).toISOString();
    assert.equal((await get(reader, `/appsec/findings/queue?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).body.total, 7);
    const olderFrom = new Date(now - 50 * day).toISOString();
    const olderTo = new Date(now - 40 * day).toISOString();
    assert.equal((await get(reader, `/appsec/findings/queue?from=${encodeURIComponent(olderFrom)}&to=${encodeURIComponent(olderTo)}`)).body.total, 2);
    assert.equal((await get(reader, '/appsec/findings/queue?from=2020-01-01T00:00:00.000Z&to=2022-01-01T00:00:00.000Z')).status, 400);
    assert.equal((await get(reader, '/appsec/findings/queue?limit=101')).status, 400);
    assert.equal((await get(reader, '/appsec/findings/queue?from=bad')).status, 400);
    assert.equal((await get(reader, '/appsec/findings/queue')).status, 200);
    assert.equal((await get(denied, '/appsec/findings/operational-metrics')).status, 403);
    assert.equal((await get(foreign, '/appsec/findings/operational-metrics')).status, 403);
    assert.equal((await get(root, '/appsec/findings/operational-metrics')).status, 400);
    assert.equal((await get(root, `/appsec/findings/operational-metrics?tenantId=${foreignTenant.id}`)).status, 403);
    assert.equal((await get(root, `/appsec/findings/operational-metrics?tenantId=${tenant.id}`)).status, 200);
    assert.equal((await get(null, '/appsec/findings/operational-metrics')).status, 401);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: tenant.id } }), auditBefore);
  } finally {
    await app.close(); await prisma.$disconnect();
    if (previous === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = previous;
  }
});
