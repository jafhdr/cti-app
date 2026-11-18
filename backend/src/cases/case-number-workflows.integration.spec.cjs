require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID, createHash } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { CasesModule } = require('../../dist/src/cases/cases.module');
const { CasesService } = require('../../dist/src/cases/cases.service');
const { CorrelationModule } = require('../../dist/src/correlation/correlation.module');
const { CorrelationQueueService } = require('../../dist/src/correlation/correlation-queue.service');
const { MonitoringController } = require('../../dist/src/intelligence/monitoring.controller');
const { MonitoringService } = require('../../dist/src/intelligence/monitoring.service');
const { MonitoringLinksService } = require('../../dist/src/intelligence/monitoring-links.service');
const { MonitoringCollectorService } = require('../../dist/src/intelligence/monitoring-collector.service');
const { PrismaService } = require('../../dist/src/prisma.service');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('Given distinct Monitoring and Correlation sources, when Case creation overlaps, then numbers, links and audits stay unique', { timeout: 90000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/cti_corr_qa_sict40$/);
  const db = new PrismaClient();
  const marker = randomUUID();
  const ti = await db.appModule.upsert({ where: { slug: 'threat-intelligence' }, update: {}, create: { slug: 'threat-intelligence', name: 'Threat Intelligence', description: 'QA', category: 'CTI' } });
  const cm = await db.appModule.findUniqueOrThrow({ where: { slug: 'case-management' } });
  await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId: cm.id, key: 'case-v2-origin' } }, update: {}, create: { moduleId: cm.id, key: 'case-v2-origin', name: 'Case V2 Origin' } });
  for (const key of ['indicator-management', 'intelligence-hub']) await db.moduleFeature.upsert({ where: { moduleId_key: { moduleId: ti.id, key } }, update: {}, create: { moduleId: ti.id, key, name: key } });
  const pkg = await db.subscriptionPackage.create({ data: { name: `Workflow allocator ${marker}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: [{ moduleId: ti.id }, { moduleId: cm.id }] } } });
  async function tenant(label) {
    const row = await db.tenant.create({ data: { name: label, slug: `${label}-${marker}` } });
    await db.tenantSubscription.create({ data: { tenantId: row.id, packageId: pkg.id, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
    for (const module of [ti, cm]) await db.tenantModule.create({ data: { tenantId: row.id, moduleId: module.id, isEnabled: true, access: { create: { role: 'ADMIN', isAllowed: true } } } });
    const user = await db.user.create({ data: { tenantId: row.id, role: 'ADMIN', name: label, email: `${label}-${marker}@example.test`, passwordHash: 'synthetic' } });
    await db.userModuleAccess.create({ data: { tenantId: row.id, userId: user.id, moduleId: ti.id, featureKeys: ['indicator-management', 'intelligence-hub'] } });
    await db.userModuleAccess.create({ data: { tenantId: row.id, userId: user.id, moduleId: cm.id, featureKeys: ['case-workflow', 'case-v2-origin'] } });
    return { id: row.id, user, token: await createAccessToken(db, user.id, process.env.JWT_ACCESS_SECRET) };
  }
  const own = await tenant('own');
  const foreign = await tenant('foreign');
  const historical = await db.case.create({ data: { tenantId: own.id, caseNumber: `CASE-${new Date().getFullYear()}-00020`, title: 'Historical maximum', createdBy: own.user.id } });
  const deleted = await db.case.create({ data: { tenantId: own.id, caseNumber: `CASE-${new Date().getFullYear()}-00019`, title: 'Deleted gap', createdBy: own.user.id } });
  await db.case.delete({ where: { id: deleted.id } });
  const source = await db.intelligenceSource.create({ data: { tenantId: own.id, name: `URLhaus ${marker}`, sourceType: 'COMMUNITY', status: 'ACTIVE', provider: 'URLhaus', createdBy: own.user.id } });
  const domain = `bad-${marker}.qa.test`;
  const indicator = await db.indicator.create({ data: { tenantId: own.id, type: 'DOMAIN', value: domain, status: 'ACTIVE', confidence: 90, severity: 'HIGH' } });
  await db.indicatorSourceObservation.create({ data: { tenantId: own.id, indicatorId: indicator.id, intelligenceSourceId: source.id, sourceKey: source.id, sourceName: 'URLhaus', provider: 'URLhaus', origin: 'FEED' } });
  const moduleRef = await Test.createTestingModule({ imports: [AuthModule, CasesModule, CorrelationModule], controllers: [MonitoringController], providers: [MonitoringService, MonitoringLinksService, MonitoringCollectorService, PrismaService] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const post = (path, token, body) => fetch(`${api}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const makeFinding = async key => {
    const watch = await db.monitoringWatchlist.create({ data: { tenantId: own.id, kind: 'DOMAIN', value: `${key}.qa.test`, label: key, createdById: own.user.id } });
    const monitoringSource = await db.monitoringSource.create({ data: { tenantId: own.id, catalogName: 'QA feed', catalogTlp: 'AMBER', providerKey: key, authorized: true } });
    const observation = await db.monitoringObservation.create({ data: { tenantId: own.id, sourceId: monitoringSource.id, providerEventKey: key, kind: 'PHISHING_DOMAIN', domain: `${key}.qa.test`, metadataCategory: 'PHISHING_SIGNAL', evidenceRef: `qa://${key}`, evidenceDigest: createHash('sha256').update(key).digest('hex'), observedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), tlp: 'AMBER' } });
    const match = await db.monitoringMatch.create({ data: { tenantId: own.id, observationId: observation.id, watchlistId: watch.id, rule: 'QA_EXACT', confidence: 90, severity: 'HIGH' } });
    return db.monitoringFinding.create({ data: { tenantId: own.id, matchId: match.id, status: 'CONFIRMED' } });
  };
  async function makeAlert(key) {
    const response = await post('/threat-correlations/connector/events', own.token, { sourceKey: key, observedAt: new Date().toISOString(), observableType: 'DOMAIN', observableValue: domain, ioaKind: 'DNS_QUERY', sourceName: 'QA connector', confidence: 90, tlp: 'AMBER' });
    assert.equal(response.status, 201, await response.clone().text());
    const { eventId } = await response.json();
    process.env.THREAT_CORRELATION_WORKER_ENABLED = 'true';
    try { assert.ok(await app.get(CorrelationQueueService).drainOnce() >= 1); }
    finally { process.env.THREAT_CORRELATION_WORKER_ENABLED = 'false'; }
    return (await db.threatCorrelation.findFirstOrThrow({ where: { tenantId: own.id, eventId } })).alertId;
  }
  const monitor = id => post(`/intelligence/monitoring/findings/${id}/case`, own.token, { createCase: true });
  const correlation = id => post(`/threat-correlations/alerts/${id}/case`, own.token, { createCase: true });
  async function pair(label, left, right) {
    const responses = await Promise.all([left(), right()]);
    const results = await Promise.all(responses.map(async response => ({ status: response.status, body: await response.json() })));
    assert.deepEqual(results.map(result => result.status), [201, 201], JSON.stringify({ label, results }));
    const rows = results.map(result => result.body.case ?? result.body);
    assert.equal(new Set(rows.map(row => row.id)).size, 2);
    assert.equal(new Set(rows.map(row => row.caseNumber)).size, 2);
    for (const row of rows) assert.match(row.caseNumber, /^CASE-\d{4}-\d{5,}$/);
    console.log(JSON.stringify({ label, numbers: rows.map(row => row.caseNumber) }));
    return rows;
  }
  try {
    const [m1, m2] = await Promise.all([makeFinding(`m1-${marker}`), makeFinding(`m2-${marker}`)]);
    const monitoring = await pair('monitoring-monitoring', () => monitor(m1.id), () => monitor(m2.id));
    assert.deepEqual(monitoring.map(row => row.caseNumber).sort(), [`CASE-${new Date().getFullYear()}-00021`, `CASE-${new Date().getFullYear()}-00022`]);
    const a1 = await makeAlert(`a1-${marker}`);
    const a2 = await makeAlert(`a2-${marker}`);
    const correlations = await pair('correlation-correlation', () => correlation(a1), () => correlation(a2));
    const m3 = await makeFinding(`m3-${marker}`);
    const a3 = await makeAlert(`a3-${marker}`);
    const mixed = await pair('monitoring-correlation', () => monitor(m3.id), () => correlation(a3));
    const m4 = await makeFinding(`m4-${marker}`);
    process.env.CASE_V2_ORIGIN_ENABLED = 'true';
    const v2 = () => fetch(`${api}/cases/v2`, { method: 'POST', headers: { authorization: `Bearer ${own.token}`, 'content-type': 'application/json', 'idempotency-key': `allocator-${marker}` }, body: JSON.stringify({ kind: 'MANUAL', title: 'Concurrent V2 Case' }) });
    let withV2;
    try { withV2 = await pair('monitoring-v2', () => monitor(m4.id), v2); }
    finally { process.env.CASE_V2_ORIGIN_ENABLED = 'false'; }
    assert.equal((await (await monitor(m1.id)).json()).id, monitoring[0].id);
    assert.equal((await (await correlation(a1)).json()).case.id, correlations[0].id);
    assert.equal((await post(`/intelligence/monitoring/findings/${m1.id}/case`, foreign.token, { createCase: true })).status, 404);
    assert.equal((await post(`/threat-correlations/alerts/${a1}/case`, foreign.token, { createCase: true })).status, 404);
    const foreignCreate = await post('/cases', foreign.token, { title: 'Foreign tenant first Case' });
    assert.equal(foreignCreate.status, 201, await foreignCreate.clone().text());
    assert.equal((await foreignCreate.json()).caseNumber, `CASE-${new Date().getFullYear()}-00001`);
    const service = app.get(CasesService);
    const original = service.create.bind(service);
    const rollbackFinding = await makeFinding(`rollback-${marker}`);
    service.create = async (...args) => { await original(...args); throw new Error('QA rollback'); };
    try { assert.equal((await monitor(rollbackFinding.id)).status, 500); }
    finally { service.create = original; }
    assert.equal((await db.monitoringFinding.findUniqueOrThrow({ where: { id: rollbackFinding.id } })).caseId, null);
    const created = [...monitoring, ...correlations, ...mixed, ...withV2];
    assert.equal(await db.case.count({ where: { tenantId: own.id } }), created.length + 1);
    assert.equal(await db.auditLog.count({ where: { tenantId: own.id, action: 'CASE_CREATED' } }), created.length - 1);
    assert.equal(await db.auditLog.count({ where: { tenantId: own.id, action: 'CASE_V2_ORIGIN_CREATED' } }), 1);
    assert.equal(await db.auditLog.count({ where: { tenantId: own.id, action: 'MONITORING_CASE_LINKED' } }), 4);
    assert.equal(await db.auditLog.count({ where: { tenantId: own.id, action: 'CORRELATION_ALERT_CASE_LINKED' } }), 3);
    assert.equal((await db.case.findUniqueOrThrow({ where: { id: historical.id } })).caseNumber, `CASE-${new Date().getFullYear()}-00020`);
  } finally { await app.close(); await db.$disconnect(); }
});
