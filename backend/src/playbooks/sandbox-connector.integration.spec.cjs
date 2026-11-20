require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID, createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { PlaybookModule } = require('../../dist/src/playbooks/playbook.module');
const { SandboxWorker } = require('../../dist/src/playbooks/sandbox-worker');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('Given two analyst approval, when a synthetic action is queued, then independent tool state and rollback are recorded', { timeout: 90000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/cti_soar_qa_/);
  const fixture = JSON.parse(readFileSync('../.omo/evidence/sicti-phase3b-qa-fixture.json', 'utf8'));
  process.env.SICTI_SOAR_QA_ENABLED = 'true';
  process.env.SICTI_ISOLATED_QA = 'true';
  process.env.SICTI_SOAR_SANDBOX_SECRET = randomBytes(32).toString('hex');
  process.env.SICTI_SOAR_MOCK_STATE_FILE = `connector-${randomUUID().replaceAll('-', '')}.json`;
  const child = spawn(process.execPath, ['qa-phase3b-mock-tool.cjs'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', data => {
      const match = /127\.0\.0\.1:(\d+)/.exec(data.toString());
      if (match) resolve(Number(match[1])); else reject(new Error('Mock server did not report port'));
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Mock server exited ${code}`)));
  });
  process.env.SICTI_SOAR_SANDBOX_URL = `http://127.0.0.1:${port}/`;
  const prisma = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, PlaybookModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  try {
    const tokens = {};
    for (const key of ['initiator', 'approver', 'reader', 'outsider']) tokens[key] = await createAccessToken(prisma, fixture[key].id, process.env.JWT_ACCESS_SECRET);
    const request = (path, token, body) => fetch(`${api}/playbooks${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const post = (path, token, body = {}) => request(path, token, body);
    const created = await (await post('/runs', tokens.initiator, { alertId: fixture.alertId, idempotencyKey: randomUUID() })).json();
    assert.equal(created.status, 'PENDING_CONFIRMATION');
    assert.equal((await post(`/runs/${created.id}/sandbox/execute`, tokens.initiator)).status, 403);
    await post(`/runs/${created.id}/decisions`, tokens.initiator, { kind: 'CONFIRM', reason: 'Synthetic QA target reviewed for connector testing.' });
    await post(`/runs/${created.id}/decisions`, tokens.approver, { kind: 'APPROVE', reason: 'Separate approval for synthetic QA target only.' });
    assert.equal((await post(`/runs/${created.id}/sandbox/execute`, tokens.outsider)).status, 404);
    assert.equal((await post(`/runs/${created.id}/sandbox/execute`, tokens.reader)).status, 403);
    assert.equal((await post(`/runs/${created.id}/execute`, tokens.initiator)).status, 409);
    const queued = await (await post(`/runs/${created.id}/sandbox/execute`, tokens.initiator)).json();
    assert.equal(queued.status, 'QUEUED');
    assert.equal((await (await post(`/runs/${created.id}/sandbox/execute`, tokens.initiator)).json()).id, queued.id);
    async function awaitStatus(status) {
      for (let i = 0; i < 60; i++) {
        const run = await (await request(`/runs/${created.id}`, tokens.initiator)).json();
        if (run.status === status) return run;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error(`Timed out waiting for ${status}`);
    }
    const verified = await awaitStatus('VERIFIED');
    assert.equal(verified.sandboxJobs[0].status, 'SUCCEEDED');
    assert.ok(verified.sandboxJobs[0].events.some(event => event.kind === 'ACKNOWLEDGED'));
    assert.ok(verified.sandboxJobs[0].events.some(event => event.kind === 'STATE_VERIFIED'));
    assert.equal(verified.steps[0].receipts[0].result, 'STATE_VERIFIED');
    await assert.rejects(prisma.sandboxConnectorEvent.update({ where: { id: verified.sandboxJobs[0].events[0].id }, data: { kind: 'ALTERED' } }));
    const rollback = await (await post(`/runs/${created.id}/sandbox/rollback`, tokens.approver)).json();
    assert.equal(rollback.operation, 'UNBLOCK_DOMAIN');
    const restored = await awaitStatus('ROLLED_BACK');
    assert.equal(restored.sandboxJobs[1].status, 'SUCCEEDED');
    assert.ok(restored.sandboxJobs[1].events.some(event => event.kind === 'STATE_VERIFIED' && event.evidence.blocked === false));
    assert.equal((await prisma.alert.findUniqueOrThrow({ where: { id: fixture.alertId } })).status, 'OPEN');
    assert.deepEqual(await (await request(`/runs/${created.id}/sandbox`, tokens.outsider)).status, 404);
    const reason = 'Synthetic correlation evidence reviewed by separate analysts.';
    const concurrentRun = await (await post('/runs', tokens.initiator, { alertId: fixture.alertId, idempotencyKey: randomUUID() })).json();
    await post(`/runs/${concurrentRun.id}/decisions`, tokens.initiator, { kind: 'CONFIRM', reason });
    await post(`/runs/${concurrentRun.id}/decisions`, tokens.approver, { kind: 'APPROVE', reason });
    const concurrent = await Promise.all([post(`/runs/${concurrentRun.id}/sandbox/execute`, tokens.initiator), post(`/runs/${concurrentRun.id}/sandbox/execute`, tokens.initiator)]);
    assert.ok(concurrent.every(item => [201, 409].includes(item.status)));
    assert.ok(concurrent.some(item => item.status === 201));
    assert.equal(await prisma.sandboxConnectorJob.count({ where: { runId: concurrentRun.id, operation: 'BLOCK_DOMAIN' } }), 1);
    for (let i = 0; i < 30; i++) {
      if ((await prisma.playbookRun.findUniqueOrThrow({ where: { id: concurrentRun.id } })).status === 'VERIFIED') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal((await prisma.playbookRun.findUniqueOrThrow({ where: { id: concurrentRun.id } })).status, 'VERIFIED');
    await post(`/runs/${concurrentRun.id}/sandbox/rollback`, tokens.approver);
    for (let i = 0; i < 30; i++) {
      if ((await prisma.playbookRun.findUniqueOrThrow({ where: { id: concurrentRun.id } })).status === 'ROLLED_BACK') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal((await prisma.playbookRun.findUniqueOrThrow({ where: { id: concurrentRun.id } })).status, 'ROLLED_BACK');
    app.get(SandboxWorker).onModuleDestroy();
    const abortRun = await (await post('/runs', tokens.initiator, { alertId: fixture.alertId, idempotencyKey: randomUUID() })).json();
    await post(`/runs/${abortRun.id}/decisions`, tokens.initiator, { kind: 'CONFIRM', reason });
    await post(`/runs/${abortRun.id}/decisions`, tokens.approver, { kind: 'APPROVE', reason });
    const abortJob = await (await post(`/runs/${abortRun.id}/sandbox/execute`, tokens.initiator)).json();
    assert.equal((await post(`/runs/${abortRun.id}/sandbox/abort`, tokens.approver)).status, 201);
    assert.equal((await prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id: abortJob.id } })).status, 'ABORTED');
    assert.equal((await prisma.playbookRun.findUniqueOrThrow({ where: { id: abortRun.id } })).status, 'ABORTED');
    const body = JSON.stringify({ version: 1, requestId: randomUUID(), tenantId: fixture.tenantId, operation: 'BLOCK_DOMAIN', target: fixture.domain, timestamp: Date.now(), nonce: randomUUID() });
    const signature = createHmac('sha256', process.env.SICTI_SOAR_SANDBOX_SECRET).update(body).digest('hex');
    const first = await fetch(`${process.env.SICTI_SOAR_SANDBOX_URL}v1/action`, { method: 'POST', headers: { 'x-soar-signature': signature }, body });
    assert.equal(first.status, 200);
    const replay = await fetch(`${process.env.SICTI_SOAR_SANDBOX_URL}v1/action`, { method: 'POST', headers: { 'x-soar-signature': signature }, body });
    assert.equal(replay.status, 400);
  } finally {
    await app.close(); await prisma.$disconnect(); child.kill();
    delete process.env.SICTI_SOAR_SANDBOX_URL; delete process.env.SICTI_SOAR_SANDBOX_SECRET;
  }
});
