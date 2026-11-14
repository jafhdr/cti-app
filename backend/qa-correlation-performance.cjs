const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const api = process.env.CORRELATION_QA_API || 'http://localhost:33101';
const fixture = JSON.parse(process.env.CORRELATION_QA_FIXTURE);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, fraction) => values[Math.ceil(values.length * fraction) - 1];

async function main() {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/cti_corr_qa_/);
  const login = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: fixture.email, password: fixture.password }) });
  assert.equal(login.status, 201, await login.clone().text());
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'Content-Type': 'application/json' };
  const results = [];
  for (const [count, concurrency] of [[60, 1], [120, 8], [180, 32]]) {
    const eventIds = [];
    let next = 0;
    const runSubmitter = async () => {
      while (next < count) {
        const index = next++;
        const body = { sourceKey: `perf-${concurrency}-${index}-${randomUUID()}`, sourceName: 'Synthetic SIEM QA',
          observedAt: new Date(Date.now() - 2000).toISOString(), observableType: 'DOMAIN', observableValue: fixture.value,
          ioaKind: 'DNS_QUERY', confidence: 90, tlp: 'AMBER' };
        const response = await fetch(`${api}/threat-correlations/connector/events`, { method: 'POST', headers, body: JSON.stringify(body) });
        assert.equal(response.status, 201, await response.clone().text());
        const queued = await response.json();
        assert.equal(queued.status, 'QUEUED');
        eventIds.push({ id: queued.eventId, receivedAt: Date.parse(queued.receivedAt), observedAt: Date.parse(body.observedAt) });
      }
    };
    const wallStart = Date.now();
    await Promise.all(Array.from({ length: concurrency }, runSubmitter));
    const visible = new Map();
    const deadline = Date.now() + 120_000;
    while (visible.size < count && Date.now() < deadline) {
      const pending = eventIds.filter(item => !visible.has(item.id));
      for (let offset = 0; offset < pending.length; offset += 32) {
        await Promise.all(pending.slice(offset, offset + 32).map(async item => {
          const response = await fetch(`${api}/threat-correlations/connector/events/${item.id}`, { headers: { cookie } });
          assert.equal(response.status, 200);
          const state = await response.json();
          if (state.processingStatus === 'FAILED') throw new Error(`Event failed: ${item.id}`);
          if (state.processingStatus === 'MATCHED') {
            assert.ok(state.correlations.length > 0);
            visible.set(item.id, { latencyMs: Date.now() - item.receivedAt,
              processingMs: state.processingLatencyMs, upstreamMs: state.upstreamAcquisitionDelayMs });
          }
        }));
      }
      if (visible.size < count) await delay(50);
    }
    assert.equal(visible.size, count, `Only ${visible.size}/${count} alerts visible`);
    const latencies = [...visible.values()].map(row => row.latencyMs).sort((a, b) => a - b);
    const processing = [...visible.values()].map(row => row.processingMs).sort((a, b) => a - b);
    const upstream = [...visible.values()].map(row => row.upstreamMs).sort((a, b) => a - b);
    results.push({ count, concurrency, completed: visible.size, workloadWallMs: Date.now() - wallStart,
      analystReadLatencyMs: { p50: percentile(latencies, .5), p95: percentile(latencies, .95), p99: percentile(latencies, .99), max: latencies.at(-1) },
      databaseProcessingMs: { p50: percentile(processing, .5), p95: percentile(processing, .95), p99: percentile(processing, .99) },
      upstreamAcquisitionMs: { p50: percentile(upstream, .5), p95: percentile(upstream, .95), p99: percentile(upstream, .99) } });
  }
  console.log(JSON.stringify({ verdict: 'PASS', method: 'HTTP receipt to authenticated status GET reporting alert references; 50ms poll interval; single-host synthetic QA', results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
