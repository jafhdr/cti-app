require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ScheduleModule } = require('@nestjs/schedule');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('./dist/src/auth/auth.module');
const { CorrelationModule } = require('./dist/src/correlation/correlation.module');
const { createAccessToken } = require('./src/auth/integration-session.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pct = (rows, quantile) => rows[Math.ceil(rows.length * quantile) - 1];
const summary = values => {
  const rows = values.toSorted((a, b) => a - b);
  return { p50: pct(rows, .5), p95: pct(rows, .95), p99: pct(rows, .99), max: rows.at(-1) };
};

async function main() {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/cti_corr_qa_/);
  const qaDatabaseUrl = new URL(process.env.DATABASE_URL);
  qaDatabaseUrl.searchParams.set('connection_limit', '2');
  process.env.DATABASE_URL = qaDatabaseUrl.toString();
  const fixture = JSON.parse(process.env.CORRELATION_QA_FIXTURE);
  const db = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot(), AuthModule, CorrelationModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  await app.listen(33111, '127.0.0.1');
  const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const receipts = new Map();
  const visible = new Map();
  const submitErrors = [];
  const depths = [];
  let submitting = true;
  const workloadId = randomUUID();
  const user = await db.user.findUniqueOrThrow({ where: { email: fixture.email } });
  const admin = await createAccessToken(db, user.id, process.env.JWT_ACCESS_SECRET);
  try {
    await db.indicatorSourceObservation.updateMany({ where: { tenantId: fixture.tenantId, provider: 'URLhaus',
      indicator: { type: 'DOMAIN', value: fixture.value } }, data: { lastSeenAt: new Date() } });
    const created = await fetch(`${api}/threat-correlations/connector-credentials`, { method: 'POST',
      headers: { authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sustained QA connector', expiresInDays: 1 }) });
    assert.equal(created.status, 201, await created.clone().text());
    const { token } = await created.json();
    const pendingReads = new Set();
    const monitor = (async () => {
      let lastDepthAt = 0;
      const deadline = Date.now() + 180000;
      while ((submitting || visible.size + submitErrors.length < 1440) && Date.now() < deadline) {
        const now = Date.now();
        if (now - lastDepthAt >= 1000) {
          const queued = await db.threatEvent.count({ where: { tenantId: fixture.tenantId, sourceKind: 'MACHINE_QA',
            processingStatus: { in: ['PENDING', 'PROCESSING'] }, sourceKey: { startsWith: workloadId } } });
          depths.push({ atMs: now, queued });
          lastDepthAt = now;
        }
        const outstanding = [...receipts.keys()].filter(id => !visible.has(id) && !pendingReads.has(id));
        if (outstanding.length) {
          const complete = await db.threatEvent.findMany({ where: { id: { in: outstanding }, processedAt: { not: null } },
            select: { id: true } });
          for (const item of complete) pendingReads.add(item.id);
          for (let offset = 0; offset < complete.length; offset += 32) {
            await Promise.all(complete.slice(offset, offset + 32).map(async item => {
              const response = await fetch(`${api}/threat-correlations/connector/events/${item.id}`, { headers: { authorization: `Bearer ${admin}` } });
              if (response.status !== 200) throw new Error(JSON.stringify({ id: item.id, code: response.status,
                body: await response.text(), receipt: receipts.get(item.id) }));
              const state = await response.json();
              const receipt = receipts.get(item.id);
              visible.set(item.id, { status: state.processingStatus, latencyMs: Date.now() - receipt.receivedAt,
                upstreamMs: state.upstreamAcquisitionDelayMs, processingMs: state.processingLatencyMs,
                alertCount: state.correlations.length, phase: receipt.phase });
              pendingReads.delete(item.id);
            }));
          }
        }
        await wait(100);
      }
    })();

    async function phase(label, rate, seconds, pauseFrom = -1, pauseTo = -1) {
      const count = rate * seconds;
      const started = Date.now();
      const sends = [];
      for (let index = 0; index < count; index++) {
        const due = started + Math.round(index * 1000 / rate);
        await wait(Math.max(0, due - Date.now()));
        const elapsed = Date.now() - started;
        process.env.THREAT_CORRELATION_WORKER_ENABLED = pauseFrom >= 0 && elapsed >= pauseFrom * 1000 && elapsed < pauseTo * 1000 ? 'false' : 'true';
        const observedAt = new Date(Date.now() - 2000).toISOString();
        const sourceKey = `${workloadId}-${label}-${index}`;
        sends.push((async () => {
          try {
            const response = await fetch(`${api}/threat-correlations/machine/events`, { method: 'POST',
              headers: { authorization: `SICTIConnector ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ sourceKey, sourceName: 'Sustained synthetic SIEM', observedAt,
                observableType: 'DOMAIN', observableValue: fixture.value, ioaKind: 'DNS_QUERY', confidence: 90, tlp: 'AMBER' }) });
            if (response.status !== 201) { submitErrors.push({ sourceKey, code: response.status }); return; }
            const receipt = await response.json();
            if (receipt.status !== 'QUEUED') { submitErrors.push({ sourceKey, code: receipt.status }); return; }
            receipts.set(receipt.eventId, { receivedAt: Date.parse(receipt.receivedAt), phase: label });
          } catch (error) { submitErrors.push({ sourceKey, code: error instanceof Error ? error.name : 'unknown' }); }
        })());
      }
      await Promise.all(sends);
      process.env.THREAT_CORRELATION_WORKER_ENABLED = 'true';
      return { label, requestedRatePerSecond: rate, durationSeconds: seconds, sent: count,
        submissionWallMs: Date.now() - started, pausedWorkerSeconds: pauseTo > pauseFrom ? pauseTo - pauseFrom : 0 };
    }
    const phases = [await phase('steady', 12, 60, 20, 30), await phase('high', 24, 30)];
    submitting = false;
    await monitor;
    const rows = [...visible.values()];
    const matched = rows.filter(row => row.status === 'MATCHED' && row.alertCount > 0);
    assert.equal(submitErrors.length, 0, JSON.stringify(submitErrors.slice(0, 5)));
    assert.equal(matched.length, 1440, `${matched.length}/1440 matched`);
    const byPhase = phases.map(phase => {
      const subset = matched.filter(row => row.phase === phase.label);
      return { ...phase, completed: subset.length, receiptToReadableAlertMs: summary(subset.map(row => row.latencyMs)),
        databaseProcessingMs: summary(subset.map(row => row.processingMs)), upstreamAcquisitionMs: summary(subset.map(row => row.upstreamMs)) };
    });
    const queueDepth = depths.map(row => row.queued);
    const finalQueueDepth = await db.threatEvent.count({ where: { tenantId: fixture.tenantId, sourceKind: 'MACHINE_QA',
      processingStatus: { in: ['PENDING', 'PROCESSING'] }, sourceKey: { startsWith: workloadId } } });
    console.log(JSON.stringify({ verdict: 'PASS', events: 1440, failed: 0, failureRate: 0,
      method: 'Machine HTTP ingestion, database completion detection, authenticated HTTP status read; 100ms monitor interval; single-host QA',
      phases: byPhase, maxQueueDepth: Math.max(...queueDepth), lastSampledQueueDepth: queueDepth.at(-1), finalQueueDepth,
      queueDepthSamples: depths.map(row => ({ elapsedSeconds: Math.round((row.atMs - depths[0].atMs) / 1000), queued: row.queued })) }, null, 2));
  } finally { process.env.THREAT_CORRELATION_WORKER_ENABLED = 'false'; await wait(300); await app.close(); await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
