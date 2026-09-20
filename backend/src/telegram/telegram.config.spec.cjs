const assert = require('node:assert/strict');
const { test } = require('node:test');

function load() { return require('../../dist/src/telegram/telegram.config.js'); }

test('Given polling enabled without a token, when config is parsed, then validation fails without a secret', () => {
  const { parseTelegramConfig } = load();
  assert.throws(() => parseTelegramConfig({ TELEGRAM_POLL_ENABLED: 'true', TELEGRAM_ALLOWED_CHAT_IDS: '-100123' }), error => !error.message.includes('token='));
});

test('Given an invalid poll limit, when config is parsed, then validation fails', () => {
  const { parseTelegramConfig } = load();
  assert.throws(() => parseTelegramConfig({ TELEGRAM_POLL_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'secret', TELEGRAM_ALLOWED_CHAT_IDS: '-100123', TELEGRAM_POLL_BATCH_LIMIT: '101' }));
});

test('Given a valid config, when parsed, then allowlist values are normalized', () => {
  const { parseTelegramConfig } = load();
  const config = parseTelegramConfig({ TELEGRAM_POLL_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'secret', TELEGRAM_ALLOWED_CHAT_IDS: ' -100123, -100456 ' });
  assert.deepEqual([...config.allowedChatIds], ['-100123', '-100456']);
});
