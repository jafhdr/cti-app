require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { CorrelationModule } = require('../../dist/src/correlation/correlation.module');
const { CasesModule } = require('../../dist/src/cases/cases.module');
const { PlaybookModule } = require('../../dist/src/playbooks/playbook.module');
const { CorrelationQueueService } = require('../../dist/src/correlation/correlation-queue.service');
const { CorrelationCaseService } = require('../../dist/src/correlation/correlation-case.service');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('worker correlation alert links atomically to a case and survives restart', { timeout: 120000 }, async () => {
  const database = new URL(process.env.DATABASE_URL).pathname;
  assert.ok(/^\/cti_corr_qa_/.test(database)
    || (process.env.SICTI_ISOLATED_QA === 'true' && process.env.SICTI_UNIFIED_QA_ENABLED === 'true' && /^\/cti_unified_qa_[a-z0-9]+$/.test(database)));
  const prisma = new PrismaClient();
  const marker = randomUUID();
  async function start() {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, CasesModule, CorrelationModule, PlaybookModule] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    return { app, api: `http://127.0.0.1:${app.getHttpServer().address().port}` };
  }
  let running = await start();
  const call = (path, token, method = 'GET', body) => fetch(`${running.api}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const ti = await prisma.appModule.upsert({ where: { slug: 'threat-intelligence' }, update: {}, create: { slug: 'threat-intelligence', name: 'Threat Intelligence', description: 'QA module', category: 'CTI' } });
    const cm = await prisma.appModule.upsert({ where: { slug: 'case-management' }, update: {}, create: { slug: 'case-management', name: 'Case Management', description: 'QA module', category: 'CTI' } });
    for (const [moduleId, key] of [[ti.id, 'indicator-management'], [cm.id, 'case-workflow']]) await prisma.moduleFeature.upsert({ where: { moduleId_key: { moduleId, key } }, update: {}, create: { moduleId, key, name: key } });
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `CASE CORR ${marker}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: [{ moduleId: ti.id }, { moduleId: cm.id }] } } });
    async function tenant(label) {
      const t = await prisma.tenant.create({ data: { name: label, slug: `${label}-${marker}` } });
      await prisma.tenantSubscription.create({ data: { tenantId: t.id, packageId: pkg.id, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      for (const module of [ti, cm]) await prisma.tenantModule.create({ data: { tenantId: t.id, moduleId: module.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
      return t;
    }
    const own = await tenant('own');
    const foreign = await tenant('foreign');
    async function account(t, role, name, caseGrant = true) {
      const u = await prisma.user.create({ data: { tenantId: t.id, role, name, email: `${name}-${marker}@example.test`, passwordHash: 'synthetic' } });
      await prisma.userModuleAccess.create({ data: { tenantId: t.id, userId: u.id, moduleId: ti.id, featureKeys: ['indicator-management'] } });
      if (caseGrant) await prisma.userModuleAccess.create({ data: { tenantId: t.id, userId: u.id, moduleId: cm.id, featureKeys: ['case-workflow'] } });
      return { id: u.id, token: await createAccessToken(prisma, u.id, process.env.JWT_ACCESS_SECRET) };
    }
    const admin = await account(own, 'ADMIN', 'admin');
    const approver = await account(own, 'ADMIN', 'approver');
    const reader = await account(own, 'USER', 'reader');
    const outsider = await account(foreign, 'ADMIN', 'outsider');
    const noCaseGrant = await account(own, 'ADMIN', 'no-grant', false);
    const foreignCase = await prisma.case.create({ data: { tenantId: foreign.id, caseNumber: 'CASE-2026-00001', title: 'Foreign', createdBy: outsider.id } });
    const existing = await prisma.case.create({ data: { tenantId: own.id, caseNumber: 'CASE-2026-00001', title: 'Existing', createdBy: admin.id } });
    const second = await prisma.case.create({ data: { tenantId: own.id, caseNumber: 'CASE-2026-00002', title: 'Second', createdBy: admin.id } });
    const source = await prisma.intelligenceSource.create({ data: { tenantId: own.id, name: `URLhaus ${marker}`, sourceType: 'COMMUNITY', status: 'ACTIVE', provider: 'URLhaus', createdBy: admin.id } });
    const domain = `bad-${marker}.qa.test`;
    const indicator = await prisma.indicator.create({ data: { tenantId: own.id, type: 'DOMAIN', value: domain, confidence: 90, severity: 'HIGH', status: 'ACTIVE' } });
    await prisma.indicatorSourceObservation.create({ data: { tenantId: own.id, indicatorId: indicator.id, intelligenceSourceId: source.id, sourceKey: source.id, sourceName: 'URLhaus', provider: 'URLhaus', origin: 'FEED' } });
    const event = key => ({ sourceKey: key, observedAt: new Date().toISOString(), observableType: 'DOMAIN', observableValue: domain, ioaKind: 'DNS_QUERY', sourceName: 'QA connector', confidence: 90, tlp: 'AMBER' });
    async function workerAlert(key) {
      const enqueued = await call('/threat-correlations/connector/events', admin.token, 'POST', event(key));
      assert.equal(enqueued.status, 201, await enqueued.clone().text());
      const { eventId } = await enqueued.json();
      process.env.THREAT_CORRELATION_WORKER_ENABLED = 'true';
      try { assert.ok(await running.app.get(CorrelationQueueService).drainOnce() >= 1); }
      finally { process.env.THREAT_CORRELATION_WORKER_ENABLED = 'false'; }
      return (await prisma.threatCorrelation.findFirstOrThrow({ where: { eventId, tenantId: own.id } })).alertId;
    }
    const alertId = await workerAlert(`worker-${marker}`);
    const path = `/threat-correlations/alerts/${alertId}/case`;
    assert.equal((await call(path, null, 'POST', { caseId: existing.id })).status, 401);
    assert.equal((await call(path, reader.token, 'POST', { caseId: existing.id })).status, 403);
    assert.equal((await call(path, noCaseGrant.token, 'POST', { caseId: existing.id })).status, 403);
    assert.equal((await call(path, outsider.token, 'POST', { caseId: existing.id })).status, 404);
    assert.equal((await call(path, admin.token, 'POST', { caseId: foreignCase.id })).status, 404);
    const [a, b] = await Promise.all([call(path, admin.token, 'POST', { caseId: existing.id }), call(path, admin.token, 'POST', { caseId: existing.id })]);
    assert.equal(a.status, 201, await a.clone().text()); assert.equal(b.status, 201, await b.clone().text());
    assert.equal((await a.json()).case.id, existing.id); assert.equal((await b.json()).case.id, existing.id);
    assert.equal((await prisma.alert.findUniqueOrThrow({ where: { id: alertId } })).caseId, existing.id);
    assert.equal((await call(path, admin.token, 'POST', { caseId: second.id })).status, 409);
    assert.equal((await call(path, admin.token, 'POST', { createCase: true })).status, 201);
    assert.equal((await (await call(path, reader.token)).json()).case.id, existing.id);
    const detail = await (await call(`/cases/${existing.id}`, admin.token)).json();
    assert.ok(detail.alerts.some(alert => alert.id === alertId && alert.source === 'CORRELATION'));
    assert.equal(await prisma.auditLog.count({ where: { tenantId: own.id, action: 'CORRELATION_ALERT_CASE_LINKED' } }), 1);
    assert.equal(await prisma.caseActivity.count({ where: { caseId: existing.id, action: 'CORRELATION_ALERT_LINKED' } }), 1);
    const runResponse = await call('/playbooks/runs', admin.token, 'POST', { alertId, idempotencyKey: randomUUID() });
    assert.equal(runResponse.status, 201, await runResponse.clone().text());
    const run = await runResponse.json(); assert.equal(run.caseId, existing.id);
    const rollbackAlert = await workerAlert(`rollback-${marker}`);
    const service = running.app.get(CorrelationCaseService);
    const original = service.cases.create.bind(service.cases);
    service.cases.create = async (...args) => { await original(...args); throw new Error('QA rollback'); };
    try { assert.equal((await call(`/threat-correlations/alerts/${rollbackAlert}/case`, admin.token, 'POST', { createCase: true })).status, 500); }
    finally { service.cases.create = original; }
    assert.equal((await prisma.alert.findUniqueOrThrow({ where: { id: rollbackAlert } })).caseId, null);
    assert.equal(await prisma.case.count({ where: { tenantId: own.id } }), 2);
    const createResponse = await call(`/threat-correlations/alerts/${rollbackAlert}/case`, admin.token, 'POST', { createCase: true });
    assert.equal(createResponse.status, 201, await createResponse.clone().text());
    const created = await createResponse.json();
    assert.equal(created.created, true);
    assert.equal((await prisma.alert.findUniqueOrThrow({ where: { id: rollbackAlert } })).caseId, created.case.id);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: own.id, action: 'CORRELATION_ALERT_CASE_LINKED' } }), 2);
    await running.app.close();
    running = await start();
    assert.equal((await (await call(path, admin.token)).json()).case.id, existing.id);
    assert.equal((await prisma.playbookRun.findUniqueOrThrow({ where: { id: run.id } })).caseId, existing.id);
    writeFileSync('qa-sict39-state.json', JSON.stringify({ tenantId: own.id, adminId: admin.id, approverId: approver.id, alertId, caseId: existing.id, runId: run.id }));
    console.log(JSON.stringify({ alertId, caseId: existing.id, runId: run.id, auditCount: 1, rollbackAlert, restart: true }));
  } finally { await running.app.close(); await prisma.$disconnect(); }
});
