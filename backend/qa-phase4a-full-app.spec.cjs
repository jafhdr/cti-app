require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('./dist/src/app.module');
const { createAccessToken } = require('./src/auth/integration-session.cjs');

test('Given the isolated Phase 4A QA database, when full AppModule starts, then authenticated monitoring is available', { timeout: 100000 }, async () => {
  assert.equal(new URL(process.env.DATABASE_URL || '').pathname, '/cti_phase4a_qa_20261111');
  process.env.SICTI_MONITORING_QA_ENABLED = 'true';
  process.env.SICTI_ISOLATED_QA = 'true';
  process.env.SICTI_SOAR_QA_ENABLED = 'false';
  process.env.THREAT_CORRELATION_PILOT_ENABLED = 'false';
  process.env.NOTIFICATION_WORKER_ENABLED = 'false';
  process.env.TELEGRAM_POLL_ENABLED = 'false';
  process.env.TELEGRAM_BOT_TOKEN = '';
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = '';
  process.env.VIRUSTOTAL_WORKER_INTERVAL_MS = '600000';
  const fixture = JSON.parse(readFileSync('../.omo/evidence/sicti-phase4a-qa-fixture.json', 'utf8'));
  const prisma = new PrismaClient();
  let app;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const token = await createAccessToken(prisma, fixture.own.users.admin.id, process.env.JWT_ACCESS_SECRET);
    const response = await fetch(`http://127.0.0.1:${app.getHttpServer().address().port}/intelligence/monitoring/watchlists`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(await response.json()));
  } finally { if (app) await app.close(); await prisma.$disconnect(); }
});
