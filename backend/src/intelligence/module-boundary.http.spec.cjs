const { createAccessToken } = require('../auth/integration-session.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { IntelligenceModule } = require('../../dist/src/intelligence/intelligence.module');
const { MitreThreatActorIngestionScheduler } = require('../../dist/src/intelligence/mitre-threat-actor-ingestion.scheduler');
const { TelegramWorker } = require('../../dist/src/telegram/telegram.worker');

test('TI HTTP routes cannot read or mutate Case and Alert across module boundary', { timeout: 60000 }, async () => {
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const previousSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = marker;
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), IntelligenceModule] })
    .overrideProvider(MitreThreatActorIngestionScheduler).useValue({})
    .overrideProvider(TelegramWorker).useValue({})
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  const jwt = app.get(JwtService);
  const tenants = [];
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const [a, b] = await Promise.all(['a', 'b'].map(async label => {
      const tenant = await prisma.tenant.create({ data: { name: `TI boundary ${label}`, slug: `ti-boundary-${label}-${marker}` } });
      tenants.push(tenant.id);
      return tenant;
    }));
    const ti = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'threat-intelligence' } });
    const subscription = await prisma.tenantSubscription.create({ data: { tenantId: a.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000), customModules: { create: { moduleId: ti.id } } } });
    await prisma.tenantModule.create({ data: { tenantId: a.id, moduleId: ti.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    const admin = await prisma.user.create({ data: { name: 'TI Admin', email: `ti-admin-${marker}@example.test`, passwordHash: 'unused', role: 'ADMIN', tenantId: a.id } });
    const user = await prisma.user.create({ data: { name: 'TI User', email: `ti-user-${marker}@example.test`, passwordHash: 'unused', role: 'USER', tenantId: a.id } });
    const foreign = await prisma.user.create({ data: { name: 'Foreign', email: `foreign-${marker}@example.test`, passwordHash: 'unused', role: 'ADMIN', tenantId: b.id } });
    for (const actor of [admin, user]) await prisma.userModuleAccess.create({ data: { userId: actor.id, tenantId: a.id, moduleId: ti.id, featureKeys: ['intelligence-hub'] } });
    const caseItem = await prisma.case.create({ data: { tenantId: b.id, caseNumber: `CASE-${marker}`, title: 'Foreign secret', createdBy: foreign.id } });
    const alert = await prisma.alert.create({ data: { tenantId: b.id, source: 'ASM', sourceKey: `boundary-${marker}`, title: 'Foreign alert', severity: 'HIGH', caseId: caseItem.id } });
    const tokens = new Map(await Promise.all([admin, user, foreign].map(async actor => [actor.id, await createAccessToken(prisma, actor.id, marker)])));
    async function call(actor, path, method = 'GET', body) {
      return fetch(base + path, { method, headers: { ...(actor ? { authorization: `Bearer ${tokens.get(actor.id)}` } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    }
    assert.equal((await call(null, '/intelligence/overview')).status, 401);
    assert.equal((await call(foreign, '/intelligence/overview')).status, 403);
    for (const actor of [admin, user]) {
      const response = await call(actor, `/intelligence/overview?tenantId=${b.id}`);
      assert.equal(response.status, 200);
      const overview = await response.json();
      assert.deepEqual(overview.cases, []);
      assert.deepEqual(overview.alerts, []);
      assert.equal(JSON.stringify(overview).includes(caseItem.title), false);
      for (const [method, path, body] of [
        ['POST', '/intelligence/cases', { tenantId: b.id, title: 'Denied' }],
        ['PATCH', `/intelligence/cases/${caseItem.id}/status`, { tenantId: b.id, status: 'CLOSED' }],
        ['POST', '/intelligence/alerts', { tenantId: b.id, title: 'Denied' }],
        ['PATCH', `/intelligence/alerts/${alert.id}/status`, { tenantId: b.id, status: 'CLOSED' }],
      ]) assert.equal((await call(actor, path, method, body)).status, 404, `${method} ${path}`);
    }
    assert.equal(await prisma.case.count({ where: { tenantId: a.id } }), 0);
    assert.equal(await prisma.alert.count({ where: { tenantId: a.id } }), 0);
    assert.equal((await prisma.case.findUniqueOrThrow({ where: { id: caseItem.id } })).status, 'OPEN');
    assert.equal((await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'OPEN');
    await prisma.alert.delete({ where: { id: alert.id } });
    await prisma.case.delete({ where: { id: caseItem.id } });
    await prisma.tenantSubscription.delete({ where: { id: subscription.id } });
  } finally {
    await app.close();
    for (const tenantId of tenants) await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
    process.env.JWT_ACCESS_SECRET = previousSecret;
  }
});

