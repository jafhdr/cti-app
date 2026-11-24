require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID, createHash } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { CasesModule } = require('../../dist/src/cases/cases.module');
const { CasesService } = require('../../dist/src/cases/cases.service');
const { PrismaService } = require('../../dist/src/prisma.service');
const { MonitoringController } = require('../../dist/src/intelligence/monitoring.controller');
const { MonitoringService } = require('../../dist/src/intelligence/monitoring.service');
const { MonitoringLinksService } = require('../../dist/src/intelligence/monitoring-links.service');
const { MonitoringCollectorService } = require('../../dist/src/intelligence/monitoring-collector.service');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('Given a confirmed finding, when two authenticated requests create a Case concurrently, then exactly one Case and link commit', { timeout: 90000 }, async () => {
  const database = new URL(process.env.DATABASE_URL).pathname;
  assert.ok(/^\/cti_phase4a_qa_sict36[a-z0-9]+$/.test(database)
    || (process.env.SICTI_ISOLATED_QA === 'true' && process.env.SICTI_UNIFIED_QA_ENABLED === 'true' && /^\/cti_unified_qa_[a-z0-9]+$/.test(database)));
  assert.equal(process.env.SICTI_ISOLATED_QA, 'true');
  assert.equal(process.env.SICTI_MONITORING_QA_ENABLED, 'true');
  const db = new PrismaClient();
  const marker = randomUUID().slice(0, 8);
  const ti = await db.appModule.upsert({ where: { slug: 'threat-intelligence' }, update: {}, create: { slug: 'threat-intelligence', name: 'Threat Intelligence', description: 'Synthetic QA', category: 'CTI', features: { create: { key: 'intelligence-hub', name: 'Intelligence Hub' } } } });
  const cm = await db.appModule.upsert({ where: { slug: 'case-management' }, update: {}, create: { slug: 'case-management', name: 'Case Management', description: 'Synthetic QA', category: 'CTI', features: { create: { key: 'case-workflow', name: 'Case Workflow' } } } });
  const pkg = await db.subscriptionPackage.create({ data: { name: `Atomicity ${marker}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: [{ moduleId: ti.id }, { moduleId: cm.id }] } } });
  async function tenant(label) {
    const row = await db.tenant.create({ data: { name: `Atomicity ${label}`, slug: `atomicity-${label}-${marker}` } });
    await db.tenantSubscription.create({ data: { tenantId: row.id, packageId: pkg.id, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
    for (const module of [ti, cm]) await db.tenantModule.create({ data: { tenantId: row.id, moduleId: module.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    return row;
  }
  const own = await tenant('own');
  const foreign = await tenant('foreign');
  async function account(tenantId, role, label) {
    const user = await db.user.create({ data: { tenantId, role, name: label, email: `${label}-${marker}@example.test`, passwordHash: 'synthetic' } });
    for (const module of [ti, cm]) await db.userModuleAccess.create({ data: { userId: user.id, tenantId, moduleId: module.id, featureKeys: module.id === ti.id ? ['intelligence-hub'] : ['case-workflow'] } });
    return createAccessToken(db, user.id, process.env.JWT_ACCESS_SECRET);
  }
  const admin = await account(own.id, 'ADMIN', 'admin');
  const reader = await account(own.id, 'USER', 'reader');
  const outsider = await account(foreign.id, 'ADMIN', 'outsider');
  const source = await db.intelligenceSource.create({ data: { tenantId: own.id, name: `Local ${marker}`, sourceType: 'COMMUNITY', status: 'ACTIVE', provider: 'QA', tlp: 'AMBER', createdBy: 'qa' } });
  const moduleRef = await Test.createTestingModule({ imports: [AuthModule, CasesModule], controllers: [MonitoringController], providers: [MonitoringService, MonitoringLinksService, MonitoringCollectorService, PrismaService] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  async function call(path, token, body) {
    const response = await fetch(`${origin}/intelligence/monitoring/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  try {
    const domain = `atomic-${marker}.example.test`;
    const asset = await db.asset.create({ data: { tenantId: own.id, name: `ASM monitored ${marker}`, type: 'DOMAIN', value: domain } });
    const watch = await call('watchlists', admin, { kind: 'DOMAIN', value: domain, assetId: asset.id });
    assert.equal(watch.status, 201);
    assert.equal(watch.body.assetId, asset.id);
    assert.equal((await db.monitoringWatchlist.findUniqueOrThrow({ where: { id: watch.body.id } })).assetId, asset.id);
    const authorized = await call('sources', admin, { catalogSourceId: source.id, providerKey: `qa-fixture-${marker}`, retentionDays: 30 });
    assert.equal(authorized.status, 201);
    const observation = await call('observations', admin, { sourceId: authorized.body.id, providerEventKey: marker, kind: 'PHISHING_DOMAIN', domain, metadataCategory: 'PHISHING_SIGNAL', evidenceRef: `qa://atomic/${marker}`, evidenceDigest: createHash('sha256').update(marker).digest('hex'), observedAt: new Date().toISOString(), tlp: 'AMBER' });
    assert.equal(observation.status, 201);
    const findingId = observation.body.matches[0].finding.id;
    assert.equal((await call(`findings/${findingId}/reviews`, admin, { status: 'UNDER_REVIEW', expectedStatus: 'NEW', reason: 'Synthetic concurrency review started' })).status, 201);
    assert.equal((await call(`findings/${findingId}/reviews`, admin, { status: 'CONFIRMED', expectedStatus: 'UNDER_REVIEW', reason: 'Synthetic concurrency signal confirmed' })).status, 201);
    const endpoint = `findings/${findingId}/case`;
    const foreignFinding = await call(endpoint, outsider, { createCase: true });
    const readerDenied = await call(endpoint, reader, { createCase: true });
    const unauthenticated = await call(endpoint, null, { createCase: true });
    assert.equal(foreignFinding.status, 404);
    assert.equal(readerDenied.status, 403);
    assert.equal(unauthenticated.status, 401);
    const foreignActor = await db.user.findFirstOrThrow({ where: { tenantId: foreign.id } });
    const foreignCase = await db.case.create({ data: { tenantId: foreign.id, caseNumber: `FOREIGN-${marker}`, title: 'Foreign synthetic case', createdBy: foreignActor.id } });
    const foreignCaseDenied = await call(endpoint, admin, { caseId: foreignCase.id });
    assert.equal(foreignCaseDenied.status, 404);
    assert.equal(await db.case.count({ where: { tenantId: own.id } }), 0);
    const cases = app.get(CasesService);
    const original = cases.create.bind(cases);
    let calls = 0;
    let firstLocked;
    const firstLockHeld = new Promise(resolve => { firstLocked = resolve; });
    let releaseFirst;
    const firstMayContinue = new Promise(resolve => { releaseFirst = resolve; });
    cases.create = async (...args) => {
      if (++calls === 1) {
        firstLocked();
        await firstMayContinue;
      }
      return original(...args);
    };
    const firstRequest = call(endpoint, admin, { createCase: true });
    await firstLockHeld;
    const secondRequest = call(endpoint, admin, { createCase: true });
    let overlapObserved = false;
    try {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const [activity] = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%MonitoringFinding%' AND query LIKE '%FOR UPDATE%'`;
        if (activity.count > 0) { overlapObserved = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally { releaseFirst(); }
    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    assert.equal(overlapObserved, true, 'second request must wait on the first finding row lock');
    assert.equal(first.status, 201, JSON.stringify(first));
    assert.equal(second.status, 201, JSON.stringify(second));
    assert.equal(first.body.id, second.body.id);
    const finding = await db.monitoringFinding.findUniqueOrThrow({ where: { id: findingId } });
    const rows = await db.case.findMany({ where: { tenantId: own.id } });
    assert.equal(rows.length, 1, 'no orphan Case may commit');
    assert.equal(finding.caseId, rows[0].id);
    assert.equal(first.body.id, finding.caseId);
    const replay = await call(endpoint, admin, { createCase: true });
    assert.equal(replay.status, 201);
    assert.equal(replay.body.id, rows[0].id);
    assert.equal(await db.auditLog.count({ where: { tenantId: own.id, action: 'CASE_CREATED' } }), 1);
    assert.equal(await db.auditLog.count({ where: { tenantId: own.id, action: 'MONITORING_CASE_LINKED' } }), 1);
    const secondObservation = await call('observations', admin, { sourceId: authorized.body.id, providerEventKey: `${marker}-rollback`, kind: 'PHISHING_DOMAIN', domain, metadataCategory: 'PHISHING_SIGNAL', evidenceRef: `qa://atomic/${marker}-rollback`, evidenceDigest: createHash('sha256').update(`${marker}-rollback`).digest('hex'), observedAt: new Date().toISOString(), tlp: 'AMBER' });
    assert.equal(secondObservation.status, 201);
    const rollbackFindingId = secondObservation.body.matches[0].finding.id;
    assert.equal((await call(`findings/${rollbackFindingId}/reviews`, admin, { status: 'UNDER_REVIEW', expectedStatus: 'NEW', reason: 'Synthetic rollback review started' })).status, 201);
    assert.equal((await call(`findings/${rollbackFindingId}/reviews`, admin, { status: 'CONFIRMED', expectedStatus: 'UNDER_REVIEW', reason: 'Synthetic rollback signal confirmed' })).status, 201);
    cases.create = async (...args) => {
      await original(...args);
      throw new Error('QA induced failure after Case creation');
    };
    const failed = await call(`findings/${rollbackFindingId}/case`, admin, { createCase: true });
    assert.equal(failed.status, 500);
    const rollbackFinding = await db.monitoringFinding.findUniqueOrThrow({ where: { id: rollbackFindingId } });
    const rollbackCaseCount = await db.case.count({ where: { tenantId: own.id } });
    const rollbackCaseAudits = await db.auditLog.count({ where: { tenantId: own.id, action: 'CASE_CREATED' } });
    const rollbackLinkAudits = await db.auditLog.count({ where: { tenantId: own.id, action: 'MONITORING_CASE_LINKED' } });
    assert.equal(rollbackFinding.caseId, null);
    assert.equal(rollbackCaseCount, 1);
    assert.equal(rollbackCaseAudits, 1);
    assert.equal(rollbackLinkAudits, 1);
    cases.create = original;

    async function confirmedFinding(suffix) {
      const observed = await call('observations', admin, { sourceId: authorized.body.id, providerEventKey: `${marker}-${suffix}`, kind: 'PHISHING_DOMAIN', domain, metadataCategory: 'PHISHING_SIGNAL', evidenceRef: `qa://atomic/${marker}-${suffix}`, evidenceDigest: createHash('sha256').update(`${marker}-${suffix}`).digest('hex'), observedAt: new Date().toISOString(), tlp: 'AMBER' });
      assert.equal(observed.status, 201);
      const confirmedId = observed.body.matches[0].finding.id;
      assert.equal((await call(`findings/${confirmedId}/reviews`, admin, { status: 'UNDER_REVIEW', expectedStatus: 'NEW', reason: `Synthetic ${suffix} review started` })).status, 201);
      assert.equal((await call(`findings/${confirmedId}/reviews`, admin, { status: 'CONFIRMED', expectedStatus: 'UNDER_REVIEW', reason: `Synthetic ${suffix} signal confirmed` })).status, 201);
      return confirmedId;
    }

    const adminActor = await db.user.findFirstOrThrow({ where: { tenantId: own.id, role: 'ADMIN' } });
    const activeCase = await db.case.create({ data: { tenantId: own.id, caseNumber: `ACTIVE-${marker}`, title: 'Active monitoring policy Case', status: 'OPEN', createdBy: adminActor.id } });
    const activeFindingId = await confirmedFinding('active');
    const activeLink = await call(`findings/${activeFindingId}/case`, admin, { caseId: activeCase.id });
    assert.equal(activeLink.status, 201);
    assert.equal(activeLink.body.id, activeCase.id);
    await db.case.update({ where: { id: activeCase.id }, data: { status: 'RESOLVED' } });
    const historicalReplay = await call(`findings/${activeFindingId}/case`, admin, { caseId: activeCase.id });
    assert.equal(historicalReplay.status, 201);
    assert.equal(historicalReplay.body.id, activeCase.id);
    assert.equal(await db.auditLog.count({ where: { tenantId: own.id, action: 'MONITORING_CASE_LINKED', metadata: { path: ['findingId'], equals: activeFindingId } } }), 1);

    const inProgressCase = await db.case.create({ data: { tenantId: own.id, caseNumber: `IN-PROGRESS-${marker}`, title: 'In-progress monitoring policy Case', status: 'IN_PROGRESS', createdBy: adminActor.id } });
    const inProgressFindingId = await confirmedFinding('in-progress');
    const inProgressLink = await call(`findings/${inProgressFindingId}/case`, admin, { caseId: inProgressCase.id });
    assert.equal(inProgressLink.status, 201);
    assert.equal(inProgressLink.body.id, inProgressCase.id);

    for (const status of ['RESOLVED', 'CLOSED']) {
      const inactiveCase = await db.case.create({ data: { tenantId: own.id, caseNumber: `${status}-${marker}`, title: `${status} monitoring policy Case`, status, createdBy: adminActor.id } });
      const inactiveFindingId = await confirmedFinding(status.toLowerCase());
      const linkAuditsBefore = await db.auditLog.count({ where: { tenantId: own.id, action: 'MONITORING_CASE_LINKED' } });
      const rejected = await call(`findings/${inactiveFindingId}/case`, admin, { caseId: inactiveCase.id });
      assert.equal(rejected.status, 409);
      assert.equal((await db.monitoringFinding.findUniqueOrThrow({ where: { id: inactiveFindingId } })).caseId, null);
      assert.equal(await db.auditLog.count({ where: { tenantId: own.id, action: 'MONITORING_CASE_LINKED' } }), linkAuditsBefore);
    }

    const racingCase = await db.case.create({ data: { tenantId: own.id, caseNumber: `RACING-${marker}`, title: 'Racing monitoring policy Case', status: 'OPEN', createdBy: adminActor.id } });
    const racingFindingId = await confirmedFinding('racing');
    let statusLocked;
    const statusLockHeld = new Promise(resolve => { statusLocked = resolve; });
    let releaseStatus;
    const statusMayCommit = new Promise(resolve => { releaseStatus = resolve; });
    const statusChange = db.$transaction(async tx => {
      await tx.case.update({ where: { id: racingCase.id }, data: { status: 'RESOLVED' } });
      statusLocked();
      await statusMayCommit;
    });
    await statusLockHeld;
    const racingLink = call(`findings/${racingFindingId}/case`, admin, { caseId: racingCase.id });
    let caseLockWaitObserved = false;
    try {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const [activity] = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%FROM "Case"%' AND query LIKE '%FOR UPDATE%'`;
        if (activity.count > 0) { caseLockWaitObserved = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally { releaseStatus(); }
    await statusChange;
    const racingRejected = await racingLink;
    assert.equal(caseLockWaitObserved, true, 'link request must serialize behind the Case status row lock');
    assert.equal(racingRejected.status, 409);
    assert.equal((await db.monitoringFinding.findUniqueOrThrow({ where: { id: racingFindingId } })).caseId, null);
    assert.equal(await db.auditLog.count({ where: { tenantId: own.id, action: 'MONITORING_CASE_LINKED', metadata: { path: ['findingId'], equals: racingFindingId } } }), 0);
    console.log(JSON.stringify({ first: first.status, second: second.status, overlapObserved, sameCase: first.body.id === second.body.id, caseCount: rows.length, findingLinked: finding.caseId === rows[0].id, createAudits: 1, linkAudits: 1, denials: { foreignFinding: foreignFinding.status, foreignCase: foreignCaseDenied.status, reader: readerDenied.status, unauthenticated: unauthenticated.status }, rollback: { status: failed.status, caseCount: rollbackCaseCount, findingUnlinked: rollbackFinding.caseId === null, caseAudits: rollbackCaseAudits, linkAudits: rollbackLinkAudits } }));
  } finally { await app.close(); await db.$disconnect(); }
});
