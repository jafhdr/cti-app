require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { Test } = require('@nestjs/testing');
const { PrismaClient } = require('@prisma/client');
const { PrismaService } = require('./dist/src/prisma.service');
const { MonitoringService } = require('./dist/src/intelligence/monitoring.service');
const { MonitoringCollectorService } = require('./dist/src/intelligence/monitoring-collector.service');

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL || '').pathname, '/cti_phase4a_qa_20261111');
  assert.equal(process.env.SICTI_ISOLATED_QA, 'true');
  const fixture = JSON.parse(readFileSync('../.omo/evidence/sicti-phase4a-qa-fixture.json', 'utf8'));
  process.env.SICTI_MONITORING_QA_ENABLED = 'true';
  process.env.SICTI_MONITORING_CONNECTOR_QA_ENABLED = 'true';
  process.env.SICTI_MONITORING_SIMULATOR_URL = 'http://127.0.0.1:33104/v1/collect';
  process.env.SICTI_MONITORING_SIMULATOR_SECRET = randomBytes(32).toString('base64url');
  process.env.SICTI_MONITORING_IDENTITY_ACTIVE_VERSION = 'v1';
  process.env.SICTI_MONITORING_IDENTITY_KEY_V1 = randomBytes(32).toString('base64url');
  const simulator = spawn(process.execPath, ['qa-phase4b-simulator.cjs'], { cwd: process.cwd(), env: process.env, stdio: 'ignore', windowsHide: true });
  const prisma = new PrismaClient();
  const module = await Test.createTestingModule({ providers: [PrismaService, MonitoringService, MonitoringCollectorService] }).compile();
  const monitoring = module.get(MonitoringService);
  const collector = module.get(MonitoringCollectorService);
  const actor = { sub: fixture.own.users.admin.id, tenantId: fixture.own.tenantId, role: 'ADMIN' };
  try {
    for (let i = 0; i < 40; i++) {
      try { await fetch(process.env.SICTI_MONITORING_SIMULATOR_URL); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    await monitoring.addWatchlist(actor, { kind: 'BRAND', value: `closure${randomUUID().slice(0, 8)}` });
    const sources = [];
    for (let i = 0; i < 12; i++) {
      const source = await monitoring.addSource(actor, { catalogSourceId: fixture.own.sourceId, providerKey: `qa-fixture-load-${randomUUID()}`, retentionDays: 30 });
      await collector.configure(actor, source.id, 1440);
      sources.push(source.id);
    }
    const startedAt = Date.now();
    assert.equal(await collector.scheduleDue(actor.tenantId), 12);
    const initial = await prisma.monitoringCollectionJob.count({ where: { tenantId: actor.tenantId, sourceId: { in: sources }, status: 'QUEUED' } });
    assert.equal(initial, 12);
    let cycles = 0;
    while (Date.now() - startedAt < 65_000) {
      cycles++;
      await collector.processDue(actor.tenantId);
      const succeeded = await prisma.monitoringCollectionJob.count({ where: { tenantId: actor.tenantId, sourceId: { in: sources }, status: 'SUCCEEDED' } });
      if (succeeded === 12) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const jobs = await prisma.monitoringCollectionJob.findMany({ where: { tenantId: actor.tenantId, sourceId: { in: sources } }, select: { id: true, status: true, attempt: true, collectionLatencyMs: true, processingLatencyMs: true, observationCount: true } });
    const evidence = {
      scope: 'isolated synthetic QA', sources: 12, initialQueueDepth: initial, cycles,
      elapsedMs: Date.now() - startedAt,
      succeeded: jobs.filter(job => job.status === 'SUCCEEDED').length,
      failed: jobs.filter(job => job.status === 'FAILED').length,
      retries: jobs.reduce((sum, job) => sum + Math.max(0, job.attempt - 1), 0),
      collectionLatencyMs: jobs.filter(job => job.collectionLatencyMs !== null).map(job => job.collectionLatencyMs),
      processingLatencyMs: jobs.filter(job => job.processingLatencyMs !== null).map(job => job.processingLatencyMs),
      observationCount: jobs.reduce((sum, job) => sum + job.observationCount, 0),
    };
    writeFileSync('../docs/audits/sicti-phase4c-workload-evidence.json', JSON.stringify(evidence, null, 2));
    assert.equal(evidence.succeeded, 12);
    assert.equal(evidence.failed, 0);
    assert.equal(evidence.observationCount, 12);
    console.log(JSON.stringify(evidence));
  } finally {
    simulator.kill();
    await module.close();
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
