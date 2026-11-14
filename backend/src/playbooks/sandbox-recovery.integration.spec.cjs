require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { PlaybookModule } = require('../../dist/src/playbooks/playbook.module');
const { createAccessToken } = require('../auth/integration-session.cjs');

async function mock(mode) {
  const child = spawn(process.execPath, ['qa-phase3b-mock-tool.cjs'], { env: { ...process.env, SICTI_SOAR_MOCK_MODE: mode }, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', data => { const match = /127\.0\.0\.1:(\d+)/.exec(data.toString()); if (match) resolve(match[1]); else reject(new Error('Mock startup failed')); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Mock exited ${code}`)));
  });
  process.env.SICTI_SOAR_SANDBOX_URL = `http://127.0.0.1:${port}/`;
  return child;
}

async function stopMock(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
}

async function app() {
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, PlaybookModule] }).compile();
  const instance = moduleRef.createNestApplication({ logger: false });
  await instance.listen(0, '127.0.0.1');
  return { instance, api: `http://127.0.0.1:${instance.getHttpServer().address().port}` };
}

test('Given outages and restarts, when the worker recovers, then durable requests and rollback remain auditable', { timeout: 120000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/cti_soar_qa_/);
  const fixture = JSON.parse(readFileSync('../.omo/evidence/sicti-phase3b-qa-fixture.json', 'utf8'));
  process.env.SICTI_SOAR_QA_ENABLED = 'true'; process.env.SICTI_ISOLATED_QA = 'true';
  process.env.SICTI_SOAR_SANDBOX_SECRET = randomBytes(32).toString('hex');
  process.env.SICTI_SOAR_MOCK_STATE_FILE = `recovery-${randomUUID().replaceAll('-', '')}.json`;
  const prisma = new PrismaClient();
  let tool; let host;
  try {
    tool = await mock('outage'); host = await app();
    const initiator = await createAccessToken(prisma, fixture.initiator.id, process.env.JWT_ACCESS_SECRET);
    const approver = await createAccessToken(prisma, fixture.approver.id, process.env.JWT_ACCESS_SECRET);
    const reader = await createAccessToken(prisma, fixture.reader.id, process.env.JWT_ACCESS_SECRET);
    const outsider = await createAccessToken(prisma, fixture.outsider.id, process.env.JWT_ACCESS_SECRET);
    const post = (path, token, body = {}) => fetch(`${host.api}/playbooks${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const run = await (await post('/runs', initiator, { alertId: fixture.alertId, idempotencyKey: randomUUID() })).json();
    await post(`/runs/${run.id}/decisions`, initiator, { kind: 'CONFIRM', reason: 'Synthetic incident evidence reviewed independently.' });
    await post(`/runs/${run.id}/decisions`, approver, { kind: 'APPROVE', reason: 'Approve synthetic connector QA operation only.' });
    const queued = await (await post(`/runs/${run.id}/sandbox/execute`, initiator)).json();
    async function waitFor(predicate) {
      for (let i = 0; i < 100; i++) {
        const job = await prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id: queued.id }, include: { events: true } });
        if (predicate(job)) return job;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error('Timed out waiting for durable job state');
    }
    const failedAttempt = await waitFor(job => job.status === 'QUEUED' && job.attempts === 1);
    assert.equal(failedAttempt.failureCode, 'SANDBOX_HTTP_503');
    await host.instance.close(); await stopMock(tool);
    tool = await mock('normal'); host = await app();
    const recovered = await waitFor(job => job.status === 'SUCCEEDED');
    assert.equal(recovered.requestId, queued.requestId);
    assert.equal(recovered.attempts, 2);
    assert.equal(recovered.events.filter(event => event.kind === 'ACKNOWLEDGED').length, 1);
    assert.equal((await prisma.playbookRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'VERIFIED');
    await stopMock(tool); tool = await mock('rollback-failure');
    const rollback = await (await fetch(`${host.api}/playbooks/runs/${run.id}/sandbox/rollback`, { method: 'POST', headers: { authorization: `Bearer ${approver}`, 'content-type': 'application/json' }, body: '{}' })).json();
    for (let i = 0; i < 80; i++) {
      const current = await prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id: rollback.id } });
      if (current.status === 'FAILED') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const failedRollback = await prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id: rollback.id } });
    assert.equal(failedRollback.status, 'FAILED');
    assert.equal(failedRollback.attempts, 3);
    assert.equal((await prisma.playbookRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'ROLLBACK_FAILED');
    await stopMock(tool); tool = await mock('normal');
    const recoveryPath = `/runs/${run.id}/sandbox/recover-rollback`;
    const recoveryInput = { reason: 'Operator reviewed terminal outage and requests safe restoration.', idempotencyKey: randomUUID() };
    assert.equal((await post(recoveryPath, reader, recoveryInput)).status, 403);
    assert.equal((await post(recoveryPath, outsider, recoveryInput)).status, 404);
    assert.equal((await post(recoveryPath, approver, { ...recoveryInput, reason: 'short' })).status, 400);
    const recoveryResponse = await post(recoveryPath, approver, recoveryInput);
    assert.equal(recoveryResponse.status, 201, await recoveryResponse.clone().text());
    const recoveryJob = await recoveryResponse.json();
    assert.equal(recoveryJob.id, rollback.id);
    assert.notEqual(recoveryJob.requestId, rollback.requestId);
    assert.equal((await (await post(recoveryPath, approver, recoveryInput)).json()).id, rollback.id);
    for (let i = 0; i < 80; i++) {
      if ((await prisma.playbookRun.findUniqueOrThrow({ where: { id: run.id } })).status === 'ROLLED_BACK') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const restored = await prisma.playbookRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(restored.status, 'ROLLED_BACK');
    const recoveryEvents = await prisma.sandboxConnectorEvent.findMany({ where: { jobId: rollback.id }, orderBy: { createdAt: 'asc' } });
    assert.equal(recoveryEvents.filter(event => event.kind === 'RECOVERY_QUEUED').length, 1);
    assert.ok(recoveryEvents.some(event => event.kind === 'STATE_VERIFIED' && event.evidence.blocked === false));
    await assert.rejects(prisma.sandboxConnectorEvent.update({ where: { id: recoveryEvents.find(event => event.kind === 'RECOVERY_QUEUED').id }, data: { kind: 'ALTERED' } }));
    await stopMock(tool); tool = await mock('verification-mismatch');
    const mismatchRun = await (await post('/runs', initiator, { alertId: fixture.alertId, idempotencyKey: randomUUID() })).json();
    await post(`/runs/${mismatchRun.id}/decisions`, initiator, { kind: 'CONFIRM', reason: 'Synthetic mismatch case reviewed by initiator.' });
    await post(`/runs/${mismatchRun.id}/decisions`, approver, { kind: 'APPROVE', reason: 'Independent approval for mismatch QA case.' });
    const mismatchJob = await (await post(`/runs/${mismatchRun.id}/sandbox/execute`, initiator)).json();
    for (let i = 0; i < 80; i++) {
      if ((await prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id: mismatchJob.id } })).status === 'FAILED') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const mismatch = await prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id: mismatchJob.id } });
    assert.equal(mismatch.failureCode, 'SANDBOX_STATE_MISMATCH');
    assert.equal((await prisma.playbookReceipt.count({ where: { runId: mismatchRun.id } })), 0);
    await stopMock(tool); tool = await mock('delay-once');
    const delayedRun = await (await post('/runs', initiator, { alertId: fixture.alertId, idempotencyKey: randomUUID() })).json();
    await post(`/runs/${delayedRun.id}/decisions`, initiator, { kind: 'CONFIRM', reason: 'Synthetic delayed response case reviewed.' });
    await post(`/runs/${delayedRun.id}/decisions`, approver, { kind: 'APPROVE', reason: 'Independent approval for delayed response QA.' });
    const delayedJob = await (await post(`/runs/${delayedRun.id}/sandbox/execute`, initiator)).json();
    for (let i = 0; i < 80; i++) {
      const current = await prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id: delayedJob.id } });
      if (current.status === 'QUEUED' && current.attempts === 1) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal((await prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id: delayedJob.id } })).attempts, 1);
    const persisted = JSON.parse(readFileSync(`.qa-phase3c-state/${process.env.SICTI_SOAR_MOCK_STATE_FILE}`, 'utf8'));
    assert.equal(persisted.requests[delayedJob.requestId].blocked, true);
    await host.instance.close(); await stopMock(tool);
    tool = await mock('normal'); host = await app();
    for (let i = 0; i < 80; i++) {
      if ((await prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id: delayedJob.id } })).status === 'SUCCEEDED') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const delayed = await prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id: delayedJob.id } });
    assert.equal(delayed.status, 'SUCCEEDED');
    assert.equal(delayed.attempts, 2);
    assert.equal(Object.keys(JSON.parse(readFileSync(`.qa-phase3c-state/${process.env.SICTI_SOAR_MOCK_STATE_FILE}`, 'utf8')).requests).filter(id => id === delayedJob.requestId).length, 1);
  } finally {
    if (host) await host.instance.close();
    if (tool) await stopMock(tool);
    await prisma.$disconnect();
    delete process.env.SICTI_SOAR_SANDBOX_URL; delete process.env.SICTI_SOAR_SANDBOX_SECRET;
  }
});
