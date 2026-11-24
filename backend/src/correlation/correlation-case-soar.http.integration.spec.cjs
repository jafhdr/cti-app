require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { PlaybookModule } = require('../../dist/src/playbooks/playbook.module');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('same worker alert and linked case complete sandbox approval and verification', { timeout: 90000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/cti_soar_qa_/);
  const fixture = JSON.parse(readFileSync('qa-sict39-state.json', 'utf8'));
  const child = spawn(process.execPath, ['qa-phase3b-mock-tool.cjs'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', data => { const match = /127\.0\.0\.1:(\d+)/.exec(data.toString()); match ? resolve(Number(match[1])) : reject(new Error('Mock port missing')); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Mock exited ${code}`)));
  });
  process.env.SICTI_SOAR_SANDBOX_URL = `http://127.0.0.1:${port}/`;
  const prisma = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, PlaybookModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  try {
    const initiator = await createAccessToken(prisma, fixture.adminId, process.env.JWT_ACCESS_SECRET);
    const approver = await createAccessToken(prisma, fixture.approverId, process.env.JWT_ACCESS_SECRET);
    const request = (path, token, body) => fetch(`${api}/playbooks${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const post = (path, token, body = {}) => request(path, token, body);
    const runBefore = await (await request(`/runs/${fixture.runId}`, initiator)).json();
    assert.equal(runBefore.alertId, fixture.alertId);
    assert.equal(runBefore.caseId, fixture.caseId);
    assert.equal(runBefore.alert.caseId, fixture.caseId);
    assert.equal((await post(`/runs/${fixture.runId}/sandbox/execute`, initiator)).status, 403);
    assert.equal((await post(`/runs/${fixture.runId}/decisions`, initiator, { kind: 'CONFIRM', reason: 'Synthetic QA correlation and linked case reviewed.' })).status, 201);
    assert.equal((await post(`/runs/${fixture.runId}/decisions`, approver, { kind: 'APPROVE', reason: 'Independent approval for sandbox domain only.' })).status, 201);
    const queuedResponse = await post(`/runs/${fixture.runId}/sandbox/execute`, initiator);
    assert.equal(queuedResponse.status, 201, await queuedResponse.clone().text());
    const queued = await queuedResponse.json();
    assert.equal(queued.status, 'QUEUED');
    let verified;
    for (let attempt = 0; attempt < 60; attempt++) {
      const candidate = await (await request(`/runs/${fixture.runId}`, initiator)).json();
      if (candidate.status === 'VERIFIED') { verified = candidate; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(verified, 'Sandbox verification did not complete');
    assert.equal(verified.caseId, fixture.caseId);
    assert.equal(verified.sandboxJobs[0].status, 'SUCCEEDED');
    assert.ok(verified.sandboxJobs[0].events.some(event => event.kind === 'STATE_VERIFIED'));
    assert.ok(verified.steps[0].receipts.some(receipt => receipt.result === 'STATE_VERIFIED'));
    console.log(JSON.stringify({ alertId: fixture.alertId, caseId: fixture.caseId, runId: fixture.runId, status: verified.status, sandboxJobId: queued.id }));
  } finally { await app.close(); await prisma.$disconnect(); child.kill(); }
});
