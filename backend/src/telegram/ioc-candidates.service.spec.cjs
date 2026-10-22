const assert = require('node:assert/strict');
const { test } = require('node:test');

function service(db) { const { IocCandidatesService } = require('../../dist/src/telegram/ioc-candidates.service.js'); return new IocCandidatesService(db); }
function fakeDb(options = {}) {
  const candidates = []; const observations = []; const audits = []; const jobs = []; const outbox = []; const indicators = [...(options.indicators ?? [])];
  const messages = options.messages ?? [];
  const tx = {
    iocCandidate: {
      findUnique: async ({ where }) => { const key = where.tenantId_type_normalizedValue; return candidates.find(row => row.tenantId === key.tenantId && row.type === key.type && row.normalizedValue === key.normalizedValue) ?? null; },
      upsert: async ({ where, create, update }) => { const key = where.tenantId_type_normalizedValue; let item = candidates.find(row => row.tenantId === key.tenantId && row.type === key.type && row.normalizedValue === key.normalizedValue); if (!item) { item = { id: `candidate-${candidates.length + 1}`, status: 'PENDING', ...create }; candidates.push(item); } else if (update.confidence?.set) item.confidence = update.confidence.set; return item; },
      update: async ({ where, data }) => { const id = where.id_tenantId?.id ?? where.id; const item = candidates.find(row => row.id === id); Object.assign(item, data); return item; },
      updateMany: async ({ where, data }) => { const item = candidates.find(row => row.id === where.id && row.tenantId === where.tenantId && row.status === where.status); if (!item) return { count: 0 }; Object.assign(item, data); return { count: 1 }; },
    },
    indicator: {
      createMany: async ({ data }) => { if (options.indicatorCreateError) throw new Error('indicator creation failed'); const exists = indicators.some(row => row.tenantId === data.tenantId && row.type === data.type && row.value === data.value); if (exists) return { count: 0 }; indicators.push({ id: `indicator-${indicators.length + 1}`, ...data }); return { count: 1 }; },
      findUnique: async ({ where }) => { const key = where.tenantId_type_value; return indicators.find(row => row.tenantId === key.tenantId && row.type === key.type && row.value === key.value) ?? null; },
    },
    iocObservation: { upsert: async ({ where, create }) => { const key = where.tenantId_candidateId_telegramStagingMessageId_extractionMethod_spanStart_spanEnd; let item = observations.find(row => row.candidateId === key.candidateId && row.telegramStagingMessageId === key.telegramStagingMessageId && row.spanStart === key.spanStart); if (!item) { item = { id: `observation-${observations.length + 1}`, ...create }; observations.push(item); } return item; } },
    telegramStagingMessage: { update: async ({ where, data }) => Object.assign(messages.find(row => row.id === where.id), data) },
    notificationOutbox: { createMany: async ({ data }) => { if (outbox.some(row => row.id === data.id)) return { count: 0 }; outbox.push(data); return { count: 1 }; } },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    indicatorEnrichmentJob: {
      createMany: async ({ data }) => {
        if (options.jobCreateError) throw new Error('job creation failed');
        const exists = jobs.some(row => row.tenantId === data.tenantId && row.indicatorId === data.indicatorId && row.provider === data.provider);
        if (exists) return { count: 0 };
        jobs.push({ id: `job-${jobs.length + 1}`, status: 'PENDING', attempts: 0, ...data }); return { count: 1 };
      },
      updateMany: async ({ where, data }) => { const job = jobs.find(row => row.tenantId === where.tenantId && row.indicatorId === where.indicatorId && row.provider === where.provider && where.status.in.includes(row.status)); if (!job) return { count: 0 }; Object.assign(job, data); return { count: 1 }; },
      findUniqueOrThrow: async ({ where }) => { const key = where.tenantId_indicatorId_provider; return jobs.find(row => row.tenantId === key.tenantId && row.indicatorId === key.indicatorId && row.provider === key.provider); },
    },
  };
  return {
    candidates, observations, audits, jobs, indicators, outbox,
    telegramStagingMessage: { findMany: async () => messages.filter(row => row.processingStatus === 'PENDING'), update: tx.telegramStagingMessage.update },
    iocCandidate: { findMany: async ({ where }) => candidates.filter(row => row.tenantId === where.tenantId && row.status === where.status), findFirst: async ({ where }) => candidates.find(row => row.id === where.id && row.tenantId === where.tenantId) ?? null },
    $transaction: async callback => {
      if (options.transactionError) throw new Error('database unavailable');
      const snapshots = { candidates: structuredClone(candidates), indicators: structuredClone(indicators), audits: structuredClone(audits), jobs: structuredClone(jobs), outbox: structuredClone(outbox) };
      try { return await callback(tx); }
      catch (error) {
        candidates.splice(0, candidates.length, ...snapshots.candidates);
        indicators.splice(0, indicators.length, ...snapshots.indicators);
        audits.splice(0, audits.length, ...snapshots.audits);
        jobs.splice(0, jobs.length, ...snapshots.jobs);
        outbox.splice(0, outbox.length, ...snapshots.outbox);
        throw error;
      }
    },
  };
}
function message(id, tenantId, content) { return { id, tenantId, intelligenceSourceId: `source-${tenantId}`, content, text: content, caption: null, entities: [], processingStatus: 'PENDING', ingestedAt: new Date() }; }

test('Given duplicate IOC observations, when processed, then one candidate retains both provenance records', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-a', '8.8.8.8'), message('m2', 'tenant-a', '8.8.8.8')] });
  assert.deepEqual(await service(db).processPending(), { processed: 2, failed: 0 });
  assert.equal(db.candidates.length, 1); assert.equal(db.observations.length, 2);
  assert.equal(db.outbox.length, 1);
});

test('Given the same IOC in two tenants, when processed, then candidates remain tenant isolated', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-a', '8.8.8.8'), message('m2', 'tenant-b', '8.8.8.8')] });
  await service(db).processPending(); assert.equal(db.candidates.length, 2);
  const visible = await service(db).listPending({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }); assert.equal(visible.length, 1); assert.equal(visible[0].tenantId, 'tenant-a');
});

test('Given an admin candidate, when approved, then status changes and an audit is written', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-a', 'evil.example')] }); await service(db).processPending();
  const result = await service(db).approve({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-1');
  assert.equal(result.status, 'APPROVED'); assert.equal(result.indicatorCreated, true); assert.equal(result.indicatorId, 'indicator-1');
  assert.equal(db.jobs.length, 1); assert.equal(db.jobs[0].provider, 'VIRUSTOTAL'); assert.equal(db.jobs[0].tenantId, 'tenant-a');
  assert.equal(db.audits[0].action, 'INDICATOR_CREATED_FROM_IOC_CANDIDATE'); assert.equal(db.audits[1].action, 'IOC_CANDIDATE_APPROVED'); assert.equal(db.audits[2].action, 'INDICATOR_ENRICHMENT_QUEUED');
});

test('Given an existing tenant indicator, when candidate is approved, then it is linked without duplication', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-a', 'evil.example')], indicators: [{ id: 'existing-indicator', tenantId: 'tenant-a', type: 'DOMAIN', value: 'evil.example' }] }); await service(db).processPending();
  const result = await service(db).approve({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-1');
  assert.equal(result.indicatorCreated, false); assert.equal(result.indicatorId, 'existing-indicator'); assert.equal(db.indicators.length, 1); assert.equal(db.candidates[0].indicatorId, 'existing-indicator');
});

test('Given duplicate approved candidates, when they share an IOC, then one indicator is reused', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-a', 'evil.example')] }); await service(db).processPending();
  db.candidates.push({ ...db.candidates[0], id: 'candidate-2', status: 'PENDING' });
  await service(db).approve({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-1');
  const second = await service(db).approve({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-2');
  assert.equal(second.indicatorCreated, false); assert.equal(db.indicators.length, 1); assert.equal(db.jobs.length, 1);
  assert.equal(db.audits.filter(entry => entry.action === 'INDICATOR_ENRICHMENT_QUEUED').length, 1);
});

test('Given VT job persistence fails, when candidate is approved, then approval and indicator rollback', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-a', 'evil.example')], jobCreateError: true }); await service(db).processPending();
  await assert.rejects(() => service(db).approve({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-1'), /job creation failed/);
  assert.equal(db.candidates[0].status, 'PENDING'); assert.equal(db.indicators.length, 0); assert.equal(db.audits.length, 0); assert.equal(db.jobs.length, 0);
});

test('Given another tenant has the IOC, when candidate is approved, then a tenant-local indicator is created', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-a', 'evil.example')], indicators: [{ id: 'tenant-b-indicator', tenantId: 'tenant-b', type: 'DOMAIN', value: 'evil.example' }] }); await service(db).processPending();
  const result = await service(db).approve({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-1');
  assert.equal(result.indicatorCreated, true); assert.equal(db.indicators.length, 2); assert.equal(db.indicators[1].tenantId, 'tenant-a');
});

test('Given an admin candidate, when rejected, then status changes and an audit is written', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-a', 'evil.example')] }); await service(db).processPending();
  const result = await service(db).reject({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-1');
  assert.equal(result.status, 'REJECTED'); assert.equal(db.indicators.length, 0); assert.equal(db.audits[0].action, 'IOC_CANDIDATE_REJECTED');
});

test('Given a reviewed candidate, when approved again, then it is rejected without another indicator', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-a', 'evil.example')] }); await service(db).processPending();
  await service(db).approve({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-1');
  await assert.rejects(() => service(db).approve({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-1'), /PENDING/);
  assert.equal(db.indicators.length, 1);
});

test('Given indicator creation fails, when candidate is approved, then the transaction rejects before approval audit', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-a', 'evil.example')], indicatorCreateError: true }); await service(db).processPending();
  await assert.rejects(() => service(db).approve({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-1'), /indicator creation failed/);
  assert.equal(db.candidates[0].status, 'PENDING'); assert.equal(db.audits.length, 0);
});

test('Given another tenant candidate, when reviewed, then it cannot be found or changed', async () => {
  const db = fakeDb({ messages: [message('m1', 'tenant-b', 'evil.example')] }); await service(db).processPending();
  await assert.rejects(() => service(db).approve({ sub: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, 'candidate-1'), /tidak ditemukan/);
});

test('Given processing transaction failure, when processed, then message is marked FAILED without leaking secrets', async () => {
  const staged = message('m1', 'tenant-a', 'evil.example'); const db = fakeDb({ messages: [staged], transactionError: true });
  assert.deepEqual(await service(db).processPending(), { processed: 0, failed: 1 }); assert.equal(staged.processingStatus, 'FAILED'); assert.match(staged.processingError, /database unavailable/);
});

test('Given a super admin without tenant selection, when listing, then authorization context is rejected', async () => {
  await assert.rejects(() => service(fakeDb()).listPending({ sub: 'root', role: 'SUPER_ADMIN', tenantId: null }), /Tenant wajib dipilih/);
});

test('Given candidate review routes, when authorization metadata is inspected, then USER is excluded', () => {
  const { IocCandidatesController } = require('../../dist/src/telegram/ioc-candidates.controller.js');
  for (const handler of ['list', 'approve', 'reject']) assert.deepEqual(Reflect.getMetadata('roles', IocCandidatesController.prototype[handler]), ['SUPER_ADMIN', 'ADMIN']);
});
