const assert = require('node:assert/strict');
const { test } = require('node:test');

function setup(lastUpdateId = null) {
  process.env.TELEGRAM_POLL_ENABLED = 'true';
  process.env.TELEGRAM_BOT_TOKEN = 'private-token';
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = '-100123';
  const states = lastUpdateId === null ? [] : [{ intelligenceSourceId: 'source-1', tenantId: 'tenant-1', lastUpdateId }];
  const messages = [];
  const transaction = {
    $queryRaw: async () => [{ acquired: true }],
    intelligenceSource: { findMany: async query => query.select.telegramChatId ? [{ id: 'source-1', tenantId: 'tenant-1', telegramChatId: '-100123' }] : [{ id: 'source-1', tenantId: 'tenant-1' }] },
    telegramPollingState: {
      findMany: async () => states,
      upsert: async ({ create, update }) => { if (states[0]) Object.assign(states[0], update); else states.push({ ...create }); },
    },
    telegramStagingMessage: { upsert: async ({ create }) => messages.push(create) },
  };
  const prisma = { $transaction: async callback => callback(transaction) };
  const { TelegramWorker } = require('../../dist/src/telegram/telegram.worker.js');
  return { worker: new TelegramWorker(prisma), states, messages };
}

test('Given a durable offset, when a restarted worker polls, then it resumes at the next update', async () => {
  const { worker } = setup('41'); let receivedOffset;
  await worker.pollOnce({ getUpdates: async offset => { receivedOffset = offset; return []; } });
  assert.equal(receivedOffset, 42);
});

test('Given safe processing succeeds, when a batch completes, then the offset advances', async () => {
  const { worker, states } = setup();
  await worker.pollOnce({ getUpdates: async () => [{ update_id: 41, channel_post: { message_id: 7, date: 1_700_000_000, chat: { id: -100123, type: 'channel', title: 'Intel' }, text: 'report' } }] });
  assert.equal(states[0].lastUpdateId, '41');
});

test('Given staging fails, when processing a batch, then the offset does not advance', async () => {
  const { worker, states } = setup();
  worker.prisma.$transaction = async callback => {
    const transaction = {
      $queryRaw: async () => [{ acquired: true }],
      intelligenceSource: { findMany: async query => query.select.telegramChatId ? [{ id: 'source-1', tenantId: 'tenant-1', telegramChatId: '-100123' }] : [{ id: 'source-1', tenantId: 'tenant-1' }] },
      telegramPollingState: { findMany: async () => states, upsert: async () => states.push({ lastUpdateId: '41' }) },
      telegramStagingMessage: { upsert: async () => { throw new Error('database unavailable'); } },
    };
    return callback(transaction);
  };
  await assert.rejects(() => worker.pollOnce({ getUpdates: async () => [{ update_id: 41, channel_post: { message_id: 7, date: 1_700_000_000, chat: { id: -100123, type: 'channel', title: 'Intel' }, text: 'report' } }] }));
  assert.equal(states.length, 0);
});

test('Given another worker holds the lock, when polling starts, then no API request runs', async () => {
  const { worker } = setup(); let calls = 0;
  worker.prisma.$transaction = async callback => callback({ $queryRaw: async () => [{ acquired: false }] });
  assert.equal(await worker.pollOnce({ getUpdates: async () => { calls += 1; return []; } }), false);
  assert.equal(calls, 0);
});
