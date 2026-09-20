require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { NotFoundException } = require('@nestjs/common');
const { IndicatorEnrichmentService } = require('../../dist/src/indicators/indicator-enrichment.service.js');
const { EnrichmentConfigurationError, ProviderHttpError, ProviderTimeoutError } = require('../../dist/src/indicators/indicator-enrichment.client.js');

function setup(options = {}) {
  const writes = [];
  let calls = 0;
  const prisma = {
    indicator: { findFirst: async ({ where }) => options.indicator === null ? null : { id: where.id, tenantId: where.tenantId, type: 'DOMAIN', value: 'evil.example' } },
    indicatorEnrichment: {
      findFirst: async () => options.fresh ? { id: 'fresh-enrichment' } : null,
      create: async ({ data }) => { const row = { id: `enrichment-${writes.length + 1}`, ...data }; writes.push(row); return row; },
    },
  };
  const client = {
    enrich: async () => { calls += 1; if (options.error) throw options.error; return { provider: 'VIRUSTOTAL', data: { reputation: -1 } }; },
  };
  return { service: new IndicatorEnrichmentService(prisma, client), writes, calls: () => calls };
}

test('Given no fresh VT result, when automation succeeds, then a tenant-scoped enrichment is saved', async () => {
  const state = setup();
  const result = await state.service.runVirusTotalAutomation('tenant-a', 'indicator-1', 60_000);
  assert.equal(result.kind, 'success'); assert.equal(state.writes[0].tenantId, 'tenant-a'); assert.equal(state.writes[0].status, 'SUCCESS');
});

test('Given a fresh VT result, when automation runs, then no provider request or duplicate history is created', async () => {
  const state = setup({ fresh: true });
  const result = await state.service.runVirusTotalAutomation('tenant-a', 'indicator-1', 60_000);
  assert.equal(result.kind, 'fresh'); assert.equal(state.calls(), 0); assert.equal(state.writes.length, 0);
});

test('Given a tenant mismatch, when automation runs, then the indicator is not exposed or enriched', async () => {
  const state = setup({ indicator: null });
  await assert.rejects(() => state.service.runVirusTotalAutomation('tenant-b', 'indicator-1', 60_000), error => error instanceof NotFoundException);
  assert.equal(state.calls(), 0); assert.equal(state.writes.length, 0);
});

test('Given HTTP 429, when automation fails, then the result is retryable and Retry-After is retained', async () => {
  const state = setup({ error: new ProviderHttpError(429, 5_000) });
  const result = await state.service.runVirusTotalAutomation('tenant-a', 'indicator-1', 60_000);
  assert.equal(result.kind, 'failure'); assert.equal(result.retryable, true); assert.equal(result.retryAfterMs, 5_000); assert.equal(state.writes[0].status, 'FAILED');
});

test('Given HTTP 500, when automation fails, then the result is retryable', async () => {
  const state = setup({ error: new ProviderHttpError(500, null) });
  const result = await state.service.runVirusTotalAutomation('tenant-a', 'indicator-1', 60_000);
  assert.equal(result.kind, 'failure'); assert.equal(result.retryable, true);
});

test('Given a provider timeout, when automation fails, then the result is retryable', async () => {
  const state = setup({ error: new ProviderTimeoutError(15_000) });
  const result = await state.service.runVirusTotalAutomation('tenant-a', 'indicator-1', 60_000);
  assert.equal(result.kind, 'failure'); assert.equal(result.retryable, true);
});

test('Given a missing API key, when automation fails, then the result is permanent', async () => {
  const state = setup({ error: new EnrichmentConfigurationError('VIRUSTOTAL_API_KEY') });
  const result = await state.service.runVirusTotalAutomation('tenant-a', 'indicator-1', 60_000);
  assert.equal(result.kind, 'failure'); assert.equal(result.retryable, false); assert.equal(result.permanent, true);
});
