require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { Test } = require('@nestjs/testing');
const { PrismaClient } = require('@prisma/client');
const { PrismaService } = require('../../dist/src/prisma.service');
const { MonitoringService } = require('../../dist/src/intelligence/monitoring.service');
const { MonitoringCollectorService } = require('../../dist/src/intelligence/monitoring-collector.service');

test('Given an authorized simulator, when a scheduled job retries and a lease expires, then collection remains scoped and idempotent', { timeout: 90000 }, async () => {
  assert.equal(new URL(process.env.DATABASE_URL || '').pathname, '/cti_phase4a_qa_20261111');
  const fixture = JSON.parse(readFileSync('../.omo/evidence/sicti-phase4a-qa-fixture.json', 'utf8'));
  process.env.SICTI_MONITORING_CONNECTOR_QA_ENABLED = 'true';
  process.env.SICTI_MONITORING_SIMULATOR_URL = 'http://127.0.0.1:33103/v1/collect';
  process.env.SICTI_MONITORING_SIMULATOR_SECRET = randomBytes(32).toString('base64url');
  process.env.SICTI_MONITORING_SIMULATOR_FAIL_ONCE = 'true';
  process.env.SICTI_MONITORING_IDENTITY_ACTIVE_VERSION = 'v1';
  process.env.SICTI_MONITORING_IDENTITY_KEY_V1 = randomBytes(32).toString('base64url');
  process.env.SICTI_MONITORING_IDENTITY_KEY_V2 = randomBytes(32).toString('base64url');
  const simulator = spawn(process.execPath, ['qa-phase4b-simulator.cjs'], { cwd: process.cwd(), env: process.env, stdio: 'ignore', windowsHide: true });
  const prisma = new PrismaClient();
  const module = await Test.createTestingModule({ providers: [PrismaService, MonitoringService, MonitoringCollectorService] }).compile();
  const monitoring = module.get(MonitoringService);
  const collector = module.get(MonitoringCollectorService);
  const own = { sub: fixture.own.users.admin.id, tenantId: fixture.own.tenantId, role: 'ADMIN' };
  const foreign = { sub: fixture.foreign.users.admin.id, tenantId: fixture.foreign.tenantId, role: 'ADMIN' };
  try {
    for (let i = 0; i < 30; i++) {
      try { await fetch('http://127.0.0.1:33103/v1/collect'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    const watch = await monitoring.addWatchlist(own, { kind: 'BRAND', value: `qa${randomUUID().slice(0, 8)}` });
    const source = await monitoring.addSource(own, { catalogSourceId: fixture.own.sourceId, providerKey: `qa-fixture-${randomUUID()}`, retentionDays: 30 });
    await assert.rejects(collector.configure(foreign, source.id, 1), { status: 404 });
    await collector.configure(own, source.id, 1);
    assert.equal(await collector.scheduleDue(fixture.own.tenantId), 1);
    const queued = (await collector.history(own))[0];
    assert.equal(queued.status, 'QUEUED');
    assert.equal(await collector.processDue(fixture.own.tenantId), 1);
    assert.equal((await collector.history(own))[0].status, 'RETRY');
    await prisma.monitoringCollectionJob.update({ where: { id: queued.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    assert.equal(await collector.processDue(fixture.own.tenantId), 1);
    assert.equal((await collector.history(own))[0].status, 'SUCCEEDED');
    assert.equal(await prisma.monitoringObservation.count({ where: { tenantId: own.tenantId, collectionJobId: queued.id } }), 1);
    assert.equal((await monitoring.findings(own)).some(finding => finding.match.watchlist.label === watch.label), true);
    await prisma.monitoringCollectionJob.update({ where: { id: queued.id }, data: { status: 'RUNNING', leaseUntil: new Date(Date.now() - 1000), attempt: 1 } });
    const restartedWorker = new MonitoringCollectorService(module.get(PrismaService), monitoring);
    assert.equal(await restartedWorker.processDue(fixture.own.tenantId), 1);
    assert.equal((await collector.history(own))[0].status, 'SUCCEEDED');
    assert.equal(await prisma.monitoringObservation.count({ where: { tenantId: own.tenantId, collectionJobId: queued.id } }), 1);
    assert.equal((await collector.history(foreign)).some(job => job.id === queued.id), false);
    await prisma.monitoringCollectionJob.update({ where: { id: queued.id }, data: { createdAt: new Date(Date.now() - 6_000) } });
    const manual = await collector.enqueue(own, source.id);
    assert.equal(manual.status, 'QUEUED');
    await assert.rejects(collector.enqueue(own, source.id), { status: 429 });
    process.env.SICTI_MONITORING_CONNECTOR_QA_ENABLED = 'false';
    await assert.rejects(collector.enqueue(own, source.id), { status: 403 });
    const bad = await fetch('http://127.0.0.1:33103/v1/collect', { method: 'POST', body: '{}' });
    assert.equal(bad.status, 401);
    process.env.SICTI_MONITORING_CONNECTOR_QA_ENABLED = 'true';
    const domain = await monitoring.addWatchlist(own, { kind: 'DOMAIN', value: fixture.own.domain });
    const identity = `analyst@${domain.label}`;
    const oldWatch = await monitoring.addWatchlist(own, { kind: 'IDENTITY_HASH', value: identity });
    assert.equal((await prisma.monitoringWatchlist.findUniqueOrThrow({ where: { id: oldWatch.id } })).identityKeyVersion, 'v1');
    process.env.SICTI_MONITORING_IDENTITY_ACTIVE_VERSION = 'v2';
    const credential = await monitoring.ingest(own, { sourceId: source.id, providerEventKey: randomUUID(), kind: 'CREDENTIAL_EXPOSURE', identity, metadataCategory: 'ACCOUNT_PRESENT', evidenceRef: 'qa://fixture/rotated-identity', evidenceDigest: 'a'.repeat(64), observedAt: new Date().toISOString(), tlp: 'AMBER' });
    assert.equal(credential.matches.length, 1);
    assert.equal((await prisma.monitoringObservation.findUniqueOrThrow({ where: { id: credential.id } })).identityKeyVersion, 'v2');
    await monitoring.redact(own, credential.id, 'Synthetic retention deletion requested');
    const redacted = await prisma.monitoringObservation.findUniqueOrThrow({ where: { id: credential.id } });
    assert.equal(redacted.identityHash, null);
    assert.equal(redacted.evidenceRef, 'qa://expired/redacted');
    assert.equal((await monitoring.findings(own)).some(finding => finding.match.observation.id === credential.id), false);
    const legacy = await prisma.monitoringWatchlist.create({ data: { tenantId: own.tenantId, kind: 'IDENTITY_HASH', value: 'b'.repeat(64), label: `***@${domain.label}`, active: false, createdById: own.sub } });
    await assert.rejects(monitoring.updateWatchlist(own, legacy.id, { active: true }), { status: 400 });
    const reEnrolled = await monitoring.addWatchlist(own, { kind: 'IDENTITY_HASH', value: `legacy@${domain.label}` });
    assert.equal((await prisma.monitoringWatchlist.findUniqueOrThrow({ where: { id: reEnrolled.id } })).identityKeyVersion, 'v2');
    const expiring = await monitoring.ingest(own, { sourceId: source.id, providerEventKey: randomUUID(), kind: 'BRAND_IMPERSONATION', domain: `${watch.label}-expired.test`, metadataCategory: 'LOOKALIKE_DOMAIN', evidenceRef: 'qa://fixture/expiring', evidenceDigest: 'c'.repeat(64), observedAt: new Date().toISOString(), tlp: 'AMBER' });
    await prisma.monitoringObservation.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    assert.ok(await monitoring.scrubExpired() >= 1);
    const scrubbed = await prisma.monitoringObservation.findUniqueOrThrow({ where: { id: expiring.id } });
    assert.equal(scrubbed.domain, null);
    assert.equal(scrubbed.evidenceRef, 'qa://expired/redacted');
    assert.equal(await prisma.auditLog.count({ where: { tenantId: own.tenantId, action: 'MONITORING_EVIDENCE_REDACTED', metadata: { path: ['observationId'], equals: expiring.id } } }), 1);
    const slow = createServer(async (_request, response) => { await new Promise(resolve => setTimeout(resolve, 4_000)); response.writeHead(200).end('{}'); });
    await new Promise(resolve => slow.listen(0, '127.0.0.1', resolve));
    try {
      process.env.SICTI_MONITORING_SIMULATOR_URL = `http://127.0.0.1:${slow.address().port}/v1/collect`;
      assert.equal(await collector.processDue(own.tenantId), 1);
      assert.equal((await prisma.monitoringCollectionJob.findUniqueOrThrow({ where: { id: manual.id } })).status, 'RETRY');
      await collector.disable(own, source.id);
      await prisma.monitoringCollectionJob.update({ where: { id: manual.id }, data: { dueAt: new Date(Date.now() - 1_000) } });
      assert.equal(await collector.processDue(own.tenantId), 1);
      assert.equal((await prisma.monitoringCollectionJob.findUniqueOrThrow({ where: { id: manual.id } })).status, 'RETRY');
    } finally { slow.closeAllConnections(); await new Promise(resolve => slow.close(resolve)); }
  } finally {
    simulator.kill();
    await module.close();
    await prisma.$disconnect();
  }
});
