require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('../dist/src/app.module');
const { CorrelationQueueService } = require('../dist/src/correlation/correlation-queue.service');
const { MonitoringService } = require('../dist/src/intelligence/monitoring.service');
const { PlaybookService } = require('../dist/src/playbooks/playbook.service');

test('Given one unified QA database, when the full application starts, then Correlation, SOAR, and Monitoring initialize together', { timeout: 90000 }, async () => {
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/cti_unified_qa_sict72');
  assert.equal(process.env.SICTI_ISOLATED_QA, 'true');
  assert.equal(process.env.SICTI_UNIFIED_QA_ENABLED, 'true');
  assert.equal(process.env.THREAT_CORRELATION_PILOT_ENABLED, 'true');
  assert.equal(process.env.SICTI_SOAR_QA_ENABLED, 'true');
  assert.equal(process.env.SICTI_MONITORING_QA_ENABLED, 'true');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    assert.ok(app.get(CorrelationQueueService));
    assert.ok(app.get(MonitoringService));
    const capabilities = app.get(PlaybookService).capabilities();
    assert.equal(capabilities.simulationEnabled, true);
    assert.equal(capabilities.connectorEnabled, false);
  } finally {
    await app.close();
  }
});
