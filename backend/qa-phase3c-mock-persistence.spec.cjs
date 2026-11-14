const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID, createHmac } = require('node:crypto');
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { stateFile } = require('./qa-phase3c-mock-store.cjs');

test('Given an unsafe state filename, when mock store opens, then path traversal is rejected', () => {
  const previous = process.env.SICTI_SOAR_MOCK_STATE_FILE;
  try {
    process.env.SICTI_SOAR_MOCK_STATE_FILE = '../outside.json';
    assert.throws(stateFile);
    process.env.SICTI_SOAR_MOCK_STATE_FILE = 'safe-qa.json';
    assert.match(stateFile(), /\.qa-phase3c-state[\\/]safe-qa\.json$/);
  } finally {
    if (previous === undefined) delete process.env.SICTI_SOAR_MOCK_STATE_FILE;
    else process.env.SICTI_SOAR_MOCK_STATE_FILE = previous;
  }
});

test('Given persisted synthetic state, when mock tool restarts, then state, idempotency and nonce replay guard survive', { timeout: 30000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL || '').pathname, /^\/cti_soar_qa_/);
  process.env.SICTI_ISOLATED_QA = 'true';
  process.env.SICTI_SOAR_SANDBOX_SECRET = randomBytes(32).toString('hex');
  const name = `persistence-${randomUUID().replaceAll('-', '')}.json`;
  process.env.SICTI_SOAR_MOCK_STATE_FILE = name;
  const tenantId = 'synthetic-tenant';
  const target = `blocked-${randomUUID()}.example.test`;
  const requestId = randomUUID();
  let child;
  let base;
  async function start() {
    child = spawn(process.execPath, ['qa-phase3b-mock-tool.cjs'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const port = await new Promise((resolve, reject) => {
      child.stdout.once('data', data => { const match = /127\.0\.0\.1:(\d+)/.exec(data.toString()); if (match) resolve(match[1]); else reject(new Error('Mock startup failed')); });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Mock exited ${code}`)));
    });
    base = `http://127.0.0.1:${port}`;
  }
  async function stop() {
    if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  }
  async function signed(path, fields) {
    const body = JSON.stringify({ version: 1, requestId: fields.requestId ?? randomUUID(), tenantId, target: fields.target ?? target, timestamp: Date.now(), nonce: fields.nonce ?? randomUUID(), ...(fields.operation ? { operation: fields.operation } : {}) });
    const signature = createHmac('sha256', process.env.SICTI_SOAR_SANDBOX_SECRET).update(body).digest('hex');
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'x-soar-signature': signature }, body });
    return { status: response.status, body: response.ok ? await response.json() : null, raw: body, signature };
  }
  try {
    await start();
    const nonce = randomUUID();
    const applied = await signed('/v1/action', { requestId, operation: 'BLOCK_DOMAIN', nonce });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.blocked, true);
    await stop(); await start();
    assert.equal((await signed('/v1/state', {})).body.blocked, true);
    const replay = await fetch(`${base}/v1/action`, { method: 'POST', headers: { 'x-soar-signature': applied.signature }, body: applied.raw });
    assert.equal(replay.status, 400);
    const duplicate = await signed('/v1/action', { requestId, operation: 'BLOCK_DOMAIN' });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.blocked, true);
    assert.equal((await signed('/v1/action', { requestId, target: 'different.example.test', operation: 'BLOCK_DOMAIN' })).status, 409);
    const data = JSON.parse(readFileSync(`.qa-phase3c-state/${name}`, 'utf8'));
    assert.equal(Object.keys(data.requests).length, 1);
    assert.ok(Object.hasOwn(data.nonces, nonce));
    assert.equal((await signed('/v1/action', { operation: 'UNBLOCK_DOMAIN' })).body.blocked, false);
    await stop(); await start();
    assert.equal((await signed('/v1/state', {})).body.blocked, false);
  } finally { await stop(); }
});
