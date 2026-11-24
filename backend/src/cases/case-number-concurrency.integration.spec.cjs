require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { CasesModule } = require('../../dist/src/cases/cases.module');
const { CasesService } = require('../../dist/src/cases/cases.service');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('Given two different authenticated Case requests, when allocation overlaps, then both commit distinct numbers', { timeout: 60000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/cti_corr_qa_sict40$/);
  const db = new PrismaClient();
  const marker = randomUUID();
  const cm = await db.appModule.upsert({ where: { slug: 'case-management' }, update: {}, create: { slug: 'case-management', name: 'Case Management', description: 'QA', category: 'CTI' } });
  await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId: cm.id, key: 'case-workflow' } }, update: {}, create: { moduleId: cm.id, key: 'case-workflow', name: 'Case Workflow' } });
  const pkg = await db.subscriptionPackage.create({ data: { name: `Allocator ${marker}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: { moduleId: cm.id } } } });
  const tenant = await db.tenant.create({ data: { name: 'Allocator QA', slug: `allocator-${marker}` } });
  await db.tenantSubscription.create({ data: { tenantId: tenant.id, packageId: pkg.id, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
  await db.tenantModule.create({ data: { tenantId: tenant.id, moduleId: cm.id, isEnabled: true, access: { create: { role: 'ADMIN', isAllowed: true } } } });
  const user = await db.user.create({ data: { tenantId: tenant.id, role: 'ADMIN', name: 'Allocator analyst', email: `allocator-${marker}@example.test`, passwordHash: 'synthetic' } });
  await db.userModuleAccess.create({ data: { tenantId: tenant.id, userId: user.id, moduleId: cm.id, featureKeys: ['case-workflow'] } });
  const token = await createAccessToken(db, user.id, process.env.JWT_ACCESS_SECRET);
  const moduleRef = await Test.createTestingModule({ imports: [AuthModule, CasesModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const endpoint = `http://127.0.0.1:${app.getHttpServer().address().port}/cases`;
  const post = title => fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  try {
    const service = app.get(CasesService);
    const original = service.generateCaseNumber.bind(service);
    let firstStarted;
    const started = new Promise(resolve => { firstStarted = resolve; });
    let releaseFirst;
    const release = new Promise(resolve => { releaseFirst = resolve; });
    let calls = 0;
    service.generateCaseNumber = async (...args) => {
      const number = await original(...args);
      if (++calls === 1) { firstStarted(); await release; }
      return number;
    };
    const first = post('First concurrent Case');
    await started;
    const second = post('Second concurrent Case');
    await new Promise(resolve => setTimeout(resolve, 250));
    releaseFirst();
    const responses = await Promise.all([first, second]);
    const results = await Promise.all(responses.map(async response => ({ status: response.status, body: await response.json() })));
    console.log(JSON.stringify({ results: results.map(result => ({ status: result.status, caseNumber: result.body.caseNumber ?? null })) }));
    assert.deepEqual(results.map(result => result.status), [201, 201]);
    assert.equal(new Set(results.map(result => result.body.caseNumber)).size, 2);
    assert.equal(await db.case.count({ where: { tenantId: tenant.id } }), 2);
    assert.equal(await db.auditLog.count({ where: { tenantId: tenant.id, action: 'CASE_CREATED' } }), 2);
  } finally { await app.close(); await db.$disconnect(); }
});
