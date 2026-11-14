require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('./dist/src/app.module');
const { createAccessToken } = require('./src/auth/integration-session.cjs');

test('Given disposable QA database, when full AppModule starts, then authenticated Playbook route works with connector disabled', { timeout: 90000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL || '').pathname, /^\/cti_soar_qa_[a-z0-9_]+$/);
  process.env.SICTI_SOAR_QA_ENABLED = 'false';
  process.env.THREAT_CORRELATION_PILOT_ENABLED = 'false';
  process.env.NOTIFICATION_WORKER_ENABLED = 'false';
  process.env.TELEGRAM_POLL_ENABLED = 'false';
  process.env.TELEGRAM_BOT_TOKEN = '';
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = '';
  process.env.VIRUSTOTAL_WORKER_INTERVAL_MS = '600000';
  const fixture = JSON.parse(readFileSync('../.omo/evidence/sicti-phase3b-qa-fixture.json', 'utf8'));
  const prisma = new PrismaClient();
  let app;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const token = await createAccessToken(prisma, fixture.initiator.id, process.env.JWT_ACCESS_SECRET);
    const headers = { authorization: `Bearer ${token}` };
    const capabilities = await fetch(`${api}/playbooks/capabilities`, { headers });
    assert.equal(capabilities.status, 200);
    assert.equal((await capabilities.json()).connectorEnabled, false);
    const runs = await fetch(`${api}/playbooks/runs`, { headers });
    assert.equal(runs.status, 200);
    assert.ok(Array.isArray(await runs.json()));
  } finally {
    if (app) await app.close();
    await prisma.$disconnect();
  }
});
