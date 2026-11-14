require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('./dist/src/auth/auth.module');
const { CorrelationModule } = require('./dist/src/correlation/correlation.module');
const { createAccessToken } = require('./src/auth/integration-session.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function startWorker() {
  const child = spawn(process.execPath, ['qa-correlation-worker.cjs'], { cwd: __dirname,
    env: { ...process.env, THREAT_CORRELATION_WORKER_ENABLED: 'true' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  await Promise.race([
    new Promise((resolve, reject) => { let output = ''; child.stdout.on('data', chunk => {
      output += chunk.toString(); if (output.includes('WORKER_READY')) resolve(); });
      child.on('exit', code => reject(new Error(`Worker exited ${code}: ${stderr.slice(-500)}`))); }),
    wait(15000).then(() => { throw new Error(`Worker startup timed out: ${stderr.slice(-500)}`); }),
  ]);
  return child;
}
async function stopWorker(child) {
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, wait(10000).then(() => { throw new Error('Worker did not stop'); })]);
}

async function main() {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/cti_corr_qa_/);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('connection_limit', '2');
  process.env.DATABASE_URL = url.toString();
  process.env.THREAT_CORRELATION_WORKER_ENABLED = 'false';
  const fixture = JSON.parse(process.env.CORRELATION_QA_FIXTURE);
  const db = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, CorrelationModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(33110, '127.0.0.1');
  const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  let worker;
  try {
    await db.indicatorSourceObservation.updateMany({ where: { tenantId: fixture.tenantId, provider: 'URLhaus',
      indicator: { type: 'DOMAIN', value: fixture.value } }, data: { lastSeenAt: new Date() } });
    const user = await db.user.findUniqueOrThrow({ where: { email: fixture.email } });
    const admin = await createAccessToken(db, user.id, process.env.JWT_ACCESS_SECRET);
    const issued = await fetch(`${api}/threat-correlations/connector-credentials`, { method: 'POST',
      headers: { authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Worker restart QA', expiresInDays: 1 }) });
    assert.equal(issued.status, 201);
    const { token } = await issued.json();
    const alertBase = await db.alert.count({ where: { source: 'CORRELATION', tenantId: fixture.tenantId } });
    async function enqueue(count) {
      const ids = [];
      for (let index = 0; index < count; index++) {
        const response = await fetch(`${api}/threat-correlations/machine/events`, { method: 'POST',
          headers: { authorization: `SICTIConnector ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceKey: `restart-${randomUUID()}`, sourceName: 'Restart QA machine', observedAt: new Date().toISOString(),
            observableType: 'DOMAIN', observableValue: fixture.value, ioaKind: 'DNS_QUERY', confidence: 90, tlp: 'AMBER' }) });
        assert.equal(response.status, 201, await response.clone().text());
        ids.push((await response.json()).eventId);
      }
      return ids;
    }
    async function waitMatched(ids) {
      const start = Date.now();
      while (Date.now() - start < 30000) {
        const matched = await db.threatEvent.count({ where: { id: { in: ids }, processingStatus: 'MATCHED' } });
        if (matched === ids.length) return Date.now() - start;
        await wait(100);
      }
      throw new Error('Worker did not drain after restart');
    }
    worker = await startWorker();
    const first = await enqueue(10);
    const firstDrainMs = await waitMatched(first);
    await stopWorker(worker); worker = undefined;
    const second = await enqueue(25);
    assert.equal(await db.threatEvent.count({ where: { id: { in: second }, processingStatus: 'PENDING' } }), 25);
    worker = await startWorker();
    const recoveryMs = await waitMatched(second);
    assert.equal(await db.alert.count({ where: { source: 'CORRELATION', sourceKey: { startsWith: 'EVENT:' }, tenantId: fixture.tenantId } }), alertBase + 35);
    console.log(JSON.stringify({ verdict: 'PASS', firstEvents: 10, queuedDuringDowntime: 25,
      firstDrainMs, recoveryMs, duplicateAlerts: 0, actualWorkerProcessRestart: true }));
  } finally { if (worker) await stopWorker(worker); await app.close(); await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
