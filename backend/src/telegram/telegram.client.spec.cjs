const assert = require('node:assert/strict');
const { test } = require('node:test');

function load() { return require('../../dist/src/telegram/telegram.client.js'); }
const response = (status, body) => ({ statusCode: status, body: { json: async () => body } });

test('Given a transient network error, when polling, then the client retries', async () => {
  let calls = 0;
  const { TelegramClient } = load();
  const client = new TelegramClient('secret', async () => { calls += 1; if (calls === 1) throw new Error('network'); return response(200, { ok: true, result: [] }); }, async () => {});
  assert.deepEqual(await client.getUpdates(0, 1, 1), []);
  assert.equal(calls, 2);
});

test('Given HTTP 429, when polling, then retry_after is honored without exposing the token', async () => {
  const waits = []; let calls = 0;
  const { TelegramClient } = load();
  const client = new TelegramClient('super-secret', async url => { assert.equal(String(url).includes('super-secret'), false); calls += 1; return calls === 1 ? response(429, { ok: false, parameters: { retry_after: 3 } }) : response(200, { ok: true, result: [] }); }, async ms => waits.push(ms));
  await client.getUpdates(0, 1, 1);
  assert.deepEqual(waits, [3000]);
});

test('Given HTTP 500, when polling, then the client retries with backoff', async () => {
  const waits = []; let calls = 0;
  const { TelegramClient } = load();
  const client = new TelegramClient('secret', async () => { calls += 1; return calls === 1 ? response(503, {}) : response(200, { ok: true, result: [] }); }, async ms => waits.push(ms));
  await client.getUpdates(0, 1, 1);
  assert.deepEqual(waits, [1000]);
});
