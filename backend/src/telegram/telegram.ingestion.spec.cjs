const assert = require('node:assert/strict');
const { test } = require('node:test');

const channelPost = (overrides = {}) => ({
  update_id: 41,
  channel_post: {
    message_id: 7,
    date: 1_700_000_000,
    chat: { id: -100123, type: 'channel', title: 'Intel', username: 'intel_feed' },
    text: 'Threat report',
  },
  ...overrides,
});

function load() {
  return require('../../dist/src/telegram/telegram.ingestion.js');
}

function fakePrisma(sources = [{ id: 'source-1', tenantId: 'tenant-1', telegramChatId: '-100123' }]) {
  const messages = [];
  const states = [];
  return {
    messages,
    states,
    intelligenceSource: { findMany: async () => sources },
    telegramPollingState: {
      findMany: async () => states,
      upsert: async ({ where, create, update }) => {
        const current = states.find(row => row.intelligenceSourceId === where.intelligenceSourceId);
        if (current) Object.assign(current, update); else states.push({ ...create });
      },
    },
    telegramStagingMessage: {
      upsert: async ({ where, create, update }) => {
        const key = where.tenantId_telegramChatId_messageId;
        const current = messages.find(row => row.tenantId === key.tenantId && row.telegramChatId === key.telegramChatId && row.messageId === key.messageId);
        if (current) Object.assign(current, update); else messages.push({ ...create });
      },
    },
  };
}

test('Given an allowed channel post, when ingested, then it is staged for the mapped tenant and source', async () => {
  const db = fakePrisma();
  const { TelegramIngestion } = load();
  const result = await new TelegramIngestion(db, new Set(['-100123'])).process(channelPost());
  assert.equal(result, 'staged');
  assert.equal(db.messages[0].tenantId, 'tenant-1');
  assert.equal(db.messages[0].intelligenceSourceId, 'source-1');
  assert.equal(db.messages[0].messageUrl, 'https://t.me/intel_feed/7');
});

test('Given a channel outside the allowlist, when ingested, then no staging record is created', async () => {
  const db = fakePrisma();
  const { TelegramIngestion } = load();
  assert.equal(await new TelegramIngestion(db, new Set(['-999'])).process(channelPost()), 'rejected');
  assert.equal(db.messages.length, 0);
});

test('Given a source mapped to another tenant, when ingested, then data stays in that tenant', async () => {
  const db = fakePrisma([{ id: 'source-2', tenantId: 'tenant-2', telegramChatId: '-100123' }]);
  const { TelegramIngestion } = load();
  await new TelegramIngestion(db, new Set(['-100123'])).process(channelPost());
  assert.equal(db.messages[0].tenantId, 'tenant-2');
});

test('Given a duplicate message, when ingested twice, then only one staging row exists', async () => {
  const db = fakePrisma();
  const { TelegramIngestion } = load();
  const ingestion = new TelegramIngestion(db, new Set(['-100123']));
  await ingestion.process(channelPost()); await ingestion.process(channelPost({ update_id: 42 }));
  assert.equal(db.messages.length, 1);
});

test('Given a duplicate update, when ingested twice, then only one staging row exists', async () => {
  const db = fakePrisma();
  const { TelegramIngestion } = load();
  const ingestion = new TelegramIngestion(db, new Set(['-100123']));
  await ingestion.process(channelPost()); await ingestion.process(channelPost());
  assert.equal(db.messages.length, 1);
});

test('Given an edited channel post, when ingested, then content and edit timestamp are updated', async () => {
  const db = fakePrisma();
  const { TelegramIngestion } = load();
  const ingestion = new TelegramIngestion(db, new Set(['-100123']));
  await ingestion.process(channelPost());
  await ingestion.process(channelPost({ update_id: 42, channel_post: undefined, edited_channel_post: { ...channelPost().channel_post, edit_date: 1_700_000_100, text: 'Updated report' } }));
  assert.equal(db.messages[0].content, 'Updated report');
  assert.equal(db.messages[0].editTimestamp.toISOString(), '2023-11-14T22:15:00.000Z');
});

test('Given an unmapped allowed chat, when ingested, then it cannot cross tenant boundaries', async () => {
  const db = fakePrisma([]);
  const { TelegramIngestion } = load();
  assert.equal(await new TelegramIngestion(db, new Set(['-100123'])).process(channelPost()), 'rejected');
  assert.equal(db.messages.length, 0);
});
