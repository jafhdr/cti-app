require('reflect-metadata');
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { IndicatorFeedsService } = require('../../dist/src/indicators/indicator-feeds.service.js');
const { CasesService } = require('../../dist/src/cases/cases.service.js');

const prisma = new PrismaClient();
const runId = `${Date.now()}-${process.pid}`;
let tenantId;
let userId;

const value = `https://feed-${runId}.example/ioc`;
const feedClient = {
  isConfigured: () => true,
  fetch: async () => [{ type: 'URL', value, severity: 'HIGH', confidence: 90, tags: ['feed'], description: 'Feed observation' }],
};
const config = { get: (key) => key === 'VIRUSTOTAL_API_KEY' ? 'test-key' : undefined };

before(async () => {
  const tenant = await prisma.tenant.create({ data: { name: `Feed provenance ${runId}`, slug: `feed-provenance-${runId}` } });
  tenantId = tenant.id;
  const user = await prisma.user.create({ data: { tenantId, email: `feed-${runId}@example.test`, name: 'Feed QA', passwordHash: 'test', role: 'ADMIN' } });
  userId = user.id;
});

after(async () => {
  if (tenantId) {
    await prisma.case.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  }
  await prisma.$disconnect();
});

test('Given two feeds with one IOC, when ingested repeatedly, then one Indicator retains both sources and one enrichment job', async () => {
  const feeds = new IndicatorFeedsService(prisma, feedClient, config);
  const user = { sub: userId, tenantId, role: 'ADMIN' };
  const first = await feeds.syncProvider(user, tenantId, 'URLHAUS');
  assert.equal(first.status, 'SYNCED');
  const second = await feeds.syncProvider(user, tenantId, 'ABUSEIPDB');
  assert.equal(second.status, 'SYNCED');
  const indicator = await prisma.indicator.findUniqueOrThrow({ where: { tenantId_type_value: { tenantId, type: 'URL', value } } });
  const observations = await prisma.indicatorSourceObservation.findMany({ where: { tenantId, indicatorId: indicator.id }, orderBy: { provider: 'asc' } });
  assert.equal(await prisma.indicator.count({ where: { tenantId, type: 'URL', value } }), 1);
  assert.deepEqual(observations.map(item => item.provider), ['AbuseIPDB', 'URLhaus']);
  assert.equal(await prisma.indicatorEnrichmentJob.count({ where: { tenantId, indicatorId: indicator.id, provider: 'VIRUSTOTAL' } }), 1);
  const firstSeen = observations.map(item => item.firstSeenAt.getTime());
  await prisma.intelligenceSource.updateMany({ where: { tenantId }, data: { lastSyncAt: null } });
  assert.equal((await feeds.syncProvider(user, tenantId, 'URLHAUS')).status, 'SYNCED');
  const repeated = await prisma.indicatorSourceObservation.findMany({ where: { tenantId, indicatorId: indicator.id }, orderBy: { provider: 'asc' } });
  assert.equal(repeated.length, 2);
  assert.deepEqual(repeated.map(item => item.firstSeenAt.getTime()), firstSeen);
  assert.ok(repeated[1].lastSeenAt >= observations[1].lastSeenAt);
  assert.equal(await prisma.indicatorEnrichmentJob.count({ where: { tenantId, indicatorId: indicator.id, provider: 'VIRUSTOTAL' } }), 1);
  const caseRecord = await prisma.case.create({ data: { tenantId, caseNumber: `FEED-${runId}`, title: 'Feed case', createdBy: userId } });
  await prisma.caseIndicator.create({ data: { tenantId, caseId: caseRecord.id, indicatorId: indicator.id, createdBy: userId } });
  const [linked] = await new CasesService(prisma).getIndicators(user, caseRecord.id);
  assert.equal(linked.sourceObservations.length, 2);
  await prisma.intelligenceSource.delete({ where: { id: observations[0].intelligenceSourceId } });
  const retained = await prisma.indicatorSourceObservation.findUniqueOrThrow({ where: { id: observations[0].id } });
  assert.equal(retained.sourceName, observations[0].sourceName);
  assert.equal(retained.intelligenceSourceId, null);
});

test('Given VirusTotal is unconfigured, when a feed syncs, then the Indicator persists without an enrichment job', async () => {
  const noKey = { get: () => undefined };
  const freshValue = `https://unconfigured-${runId}.example/ioc`;
  const client = { isConfigured: () => true, fetch: async () => [{ type: 'URL', value: freshValue, severity: 'HIGH', confidence: 90, tags: [], description: 'Feed' }] };
  const feeds = new IndicatorFeedsService(prisma, client, noKey);
  const result = await feeds.syncProvider({ sub: userId, tenantId, role: 'ADMIN' }, tenantId, 'MALWAREBAZAAR');
  assert.equal(result.status, 'SYNCED');
  const indicator = await prisma.indicator.findUniqueOrThrow({ where: { tenantId_type_value: { tenantId, type: 'URL', value: freshValue } } });
  assert.equal(await prisma.indicatorEnrichmentJob.count({ where: { tenantId, indicatorId: indicator.id } }), 0);
});

test('Given enrichment enqueue fails, when a feed syncs, then the Indicator and provenance remain', async () => {
  await prisma.intelligenceSource.updateMany({ where: { tenantId, provider: 'MalwareBazaar' }, data: { lastSyncAt: null } });
  const freshValue = `https://enqueue-${runId}.example/ioc`;
  const client = { isConfigured: () => true, fetch: async () => [{ type: 'URL', value: freshValue, severity: 'HIGH', confidence: 90, tags: [], description: 'Feed' }] };
  const failingPrisma = prisma.$extends({ query: { indicatorEnrichmentJob: { createMany() { throw new Error('Queue unavailable'); } } } });
  const feeds = new IndicatorFeedsService(failingPrisma, client, config);
  const result = await feeds.syncProvider({ sub: userId, tenantId, role: 'ADMIN' }, tenantId, 'MALWAREBAZAAR');
  assert.equal(result.status, 'SYNCED');
  const indicator = await prisma.indicator.findUniqueOrThrow({ where: { tenantId_type_value: { tenantId, type: 'URL', value: freshValue } }, include: { sourceObservations: true } });
  assert.equal(indicator.sourceObservations.length, 1);
  assert.equal(await prisma.indicatorEnrichmentJob.count({ where: { tenantId, indicatorId: indicator.id } }), 0);
});
