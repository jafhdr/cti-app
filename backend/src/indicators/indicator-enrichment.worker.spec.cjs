const assert = require('node:assert/strict');
const { test } = require('node:test');

function setup(options = {}) {
  const jobs = [{ id: 'job-1', tenantId: 'tenant-a', indicatorId: 'indicator-1', provider: 'VIRUSTOTAL', trigger: 'TELEGRAM_APPROVAL', requestedById: 'admin-a', status: 'PENDING', attempts: 0, availableAt: new Date(0), lockedAt: null, lastError: null }];
  const audits = [];
  const outbox = [];
  let calls = 0;
  const prisma = {
    indicatorEnrichmentJob: {
      updateMany: async ({ where, data }) => {
        const job = jobs.find(row => row.id === where.id && row.tenantId === where.tenantId && row.status === where.status
          && (where.attempts === undefined || row.attempts === where.attempts)
          && (where.lockedAt === undefined || row.lockedAt?.getTime() === where.lockedAt?.getTime()));
        if (!job) return { count: 0 };
        Object.assign(job, data, { attempts: job.attempts + (data.attempts?.increment ?? 0) });
        return { count: 1 };
      },
      findFirst: async ({ where }) => jobs.find(row => row.status === where.status && row.availableAt <= where.availableAt.lte) ?? null,
      findUnique: async ({ where }) => jobs.find(row => row.id === where.id) ?? null,
      update: async ({ where, data }) => { const job = jobs.find(row => row.id === where.id); Object.assign(job, data); return job; },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    notificationOutbox: { create: async ({ data }) => { outbox.push(data); return data; } },
    $transaction: async callback => callback(prisma),
  };
  const enrichment = {
    runVirusTotalAutomation: async (tenantId, indicatorId, cooldownMs) => {
      calls += 1;
      assert.equal(tenantId, 'tenant-a'); assert.equal(indicatorId, 'indicator-1'); assert.equal(cooldownMs, 60_000);
      return options.result ?? { kind: 'success', enrichmentId: 'enrichment-1' };
    },
  };
  return { prisma, enrichment, jobs, audits, outbox, calls: () => calls };
}

function worker(state, environment = {}) {
  const previous = { ...process.env };
  Object.assign(process.env, { VIRUSTOTAL_MAX_CONCURRENCY: '1', VIRUSTOTAL_MAX_ATTEMPTS: '3', VIRUSTOTAL_RETRY_BASE_MS: '1000', VIRUSTOTAL_COOLDOWN_MS: '60000', ...environment });
  const { IndicatorEnrichmentWorker } = require('../../dist/src/indicators/indicator-enrichment.worker.js');
  const value = new IndicatorEnrichmentWorker(state.prisma, state.enrichment, { addInterval() {} });
  process.env = previous;
  return value;
}

test('Given a due VT job, when worker succeeds, then the job and audit are completed', async () => {
  const state = setup();
  await worker(state).runOnce();
  assert.equal(state.jobs[0].status, 'SUCCESS'); assert.equal(state.calls(), 1);
  assert.equal(state.audits[0].action, 'INDICATOR_ENRICHMENT_COMPLETED');
  assert.equal(state.outbox[0].type, 'INDICATOR_ENRICHMENT_COMPLETED');
});

test('Given two workers see one job, when both run, then only one claims it', async () => {
  const state = setup();
  await Promise.all([worker(state).runOnce(), worker(state).runOnce()]);
  assert.equal(state.calls(), 1);
});

test('Given a retryable VT failure, when worker runs, then the job is rescheduled', async () => {
  const state = setup({ result: { kind: 'failure', retryable: true, message: 'Provider HTTP status 429', retryAfterMs: 5000 } });
  await worker(state).runOnce();
  assert.equal(state.jobs[0].status, 'PENDING'); assert.equal(state.jobs[0].lastError, 'Provider HTTP status 429');
  assert.ok(state.jobs[0].availableAt.getTime() > Date.now());
  assert.equal(state.outbox.length, 0);
});

test('Given a permanent VT failure, when worker runs, then the job fails without retry', async () => {
  const state = setup({ result: { kind: 'failure', retryable: false, message: 'VIRUSTOTAL_API_KEY belum dikonfigurasi' } });
  await worker(state).runOnce();
  assert.equal(state.jobs[0].status, 'FAILED'); assert.equal(state.audits[0].action, 'INDICATOR_ENRICHMENT_FAILED');
  assert.equal(state.outbox[0].type, 'INDICATOR_ENRICHMENT_FAILED');
});

test('Given the final retryable attempt, when worker fails, then max attempts stops retry', async () => {
  const state = setup({ result: { kind: 'failure', retryable: true, message: 'Provider timeout', retryAfterMs: null } });
  state.jobs[0].attempts = 2;
  await worker(state).runOnce();
  assert.equal(state.jobs[0].status, 'FAILED');
});
