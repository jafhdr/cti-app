require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { CorrelationModule } = require('../../dist/src/correlation/correlation.module');
const { createAccessToken } = require('../auth/integration-session.cjs');
const { CorrelationQueueService } = require('../../dist/src/correlation/correlation-queue.service');

test('Given a URLhaus IOC and synthetic telemetry, when ingested, then one tenant-visible alert is recorded', { timeout: 90000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/cti_corr_qa_/);
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, CorrelationModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  try {
    const ti = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'threat-intelligence' } });
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `CORR ${marker}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: { moduleId: ti.id } } } });
    async function tenant(suffix) {
      const row = await prisma.tenant.create({ data: { name: `Correlation ${suffix}`, slug: `correlation-${suffix}-${marker}` } });
      await prisma.tenantSubscription.create({ data: { tenantId: row.id, packageId: pkg.id, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      await prisma.tenantModule.create({ data: { tenantId: row.id, moduleId: ti.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
      return row;
    }
    const own = await tenant('own');
    const foreign = await tenant('foreign');
    async function account(tenantId, role, suffix) {
      const user = await prisma.user.create({ data: { tenantId, role, name: suffix, email: `${suffix}-${marker}@example.test`, passwordHash: 'synthetic' } });
      await prisma.userModuleAccess.create({ data: { userId: user.id, tenantId, moduleId: ti.id, featureKeys: ['indicator-management'] } });
      return createAccessToken(prisma, user.id, process.env.JWT_ACCESS_SECRET);
    }
    const admin = await account(own.id, 'ADMIN', 'admin');
    const reader = await account(own.id, 'USER', 'reader');
    const outsider = await account(foreign.id, 'ADMIN', 'outsider');
    const source = await prisma.intelligenceSource.create({ data: { tenantId: own.id, name: `URLhaus ${marker}`, sourceType: 'COMMUNITY', status: 'ACTIVE', provider: 'URLhaus', createdBy: 'qa' } });
    const value = `evil-${marker}.example`;
    const indicator = await prisma.indicator.create({ data: { tenantId: own.id, type: 'DOMAIN', value, confidence: 90, severity: 'HIGH', status: 'ACTIVE' } });
    await prisma.indicatorSourceObservation.create({ data: { tenantId: own.id, indicatorId: indicator.id, intelligenceSourceId: source.id, sourceKey: source.id, sourceName: 'URLhaus', provider: 'URLhaus', origin: 'FEED' } });
    const submit = (token, body) => fetch(`${api}/threat-correlations/qa-telemetry`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const event = { sourceKey: `event-${marker}`, observedAt: new Date().toISOString(), observableType: 'DOMAIN', observableValue: value.toUpperCase(), ioaKind: 'DNS_QUERY', sourceName: 'Synthetic SOC', confidence: 80, tlp: 'AMBER' };
    assert.equal((await submit('', event)).status, 401);
    assert.equal((await submit(reader, event)).status, 403);
    assert.equal((await submit(outsider, { ...event, tenantId: own.id })).status, 403);
    process.env.THREAT_CORRELATION_PILOT_ENABLED = 'false';
    try { assert.equal((await submit(admin, event)).status, 404); }
    finally { process.env.THREAT_CORRELATION_PILOT_ENABLED = 'true'; }
    const first = await submit(admin, event);
    assert.equal(first.status, 201, await first.clone().text());
    const created = await first.json();
    assert.equal(created.status, 'MATCHED');
    assert.ok(created.processingLatencyMs >= 0);
    const replay = await (await submit(admin, event)).json();
    assert.equal(replay.status, 'DUPLICATE');
    assert.equal(replay.correlationId, created.correlationId);
    assert.equal(await prisma.alert.count({ where: { tenantId: own.id, source: 'CORRELATION' } }), 1);
    assert.equal(await prisma.notification.count({ where: { tenantId: own.id, type: 'THREAT_CORRELATION_DETECTED' } }), 1);
    const rows = await fetch(`${api}/threat-correlations`, { headers: { authorization: `Bearer ${reader}` } });
    assert.equal(rows.status, 200);
    const [row] = await rows.json();
    assert.equal(row.indicator.id, indicator.id);
    assert.equal(row.score, 85);
    assert.ok(row.event.ingestedAt && row.matchedAt && row.correlatedAt && row.alertVisibleAt);
    assert.deepEqual(await (await fetch(`${api}/threat-correlations`, { headers: { authorization: `Bearer ${outsider}` } })).json(), []);
    await prisma.indicator.update({ where: { id: indicator.id }, data: { suppressionKind: 'FALSE_POSITIVE' } });
    assert.equal((await (await submit(admin, { ...event, sourceKey: `suppressed-${marker}` })).json()).status, 'NO_MATCH');
    await prisma.indicator.update({ where: { id: indicator.id }, data: { suppressionKind: null, expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await (await submit(admin, { ...event, sourceKey: `expired-${marker}` })).json()).status, 'NO_MATCH');
    await prisma.indicator.update({ where: { id: indicator.id }, data: { expiresAt: null } });
    assert.equal((await (await submit(admin, { ...event, sourceKey: `delayed-${marker}`, observedAt: new Date(Date.now() - 600000).toISOString() })).json()).status, 'NO_MATCH');

    const connector = (token, body) => fetch(`${api}/threat-correlations/connector/events`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await connector(reader, event)).status, 403);
    assert.equal((await connector(outsider, { ...event, tenantId: own.id })).status, 403);
    assert.equal((await connector(admin, { ...event, observableType: 'URL', observableValue: 'not a url' })).status, 400);
    await prisma.indicatorSourceObservation.create({ data: { tenantId: own.id, indicatorId: indicator.id, intelligenceSourceId: source.id, sourceKey: `${source.id}-second`, sourceName: 'URLhaus second', provider: 'URLhaus', origin: 'FEED' } });
    const connectorEvent = { ...event, sourceKey: `connector-${marker}`, tlp: 'AMBER_STRICT' };
    const queuedResponse = await connector(admin, connectorEvent);
    assert.equal(queuedResponse.status, 201, await queuedResponse.clone().text());
    const queued = await queuedResponse.json();
    assert.equal(queued.status, 'QUEUED');
    assert.equal((await (await connector(admin, connectorEvent)).json()).status, 'DUPLICATE');
    assert.equal((await connector(admin, { ...connectorEvent, confidence: 20 })).status, 409);
    const worker = app.get(CorrelationQueueService);
    assert.ok(await worker.drainOnce() >= 1);
    const state = await (await fetch(`${api}/threat-correlations/connector/events/${queued.eventId}`, { headers: { authorization: `Bearer ${reader}` } })).json();
    assert.equal(state.processingStatus, 'MATCHED');
    assert.equal(state.correlations.length, 2);
    assert.equal(state.attempts, 1);
    assert.ok(state.processingLatencyMs >= 0);
    assert.ok(state.upstreamAcquisitionDelayMs >= 0);
    const foreignState = await fetch(`${api}/threat-correlations/connector/events/${queued.eventId}`, { headers: { authorization: `Bearer ${outsider}` } });
    assert.equal(foreignState.status, 404);
    assert.equal((await prisma.threatCorrelation.count({ where: { eventId: queued.eventId } })), 2);
    const suppressed = await (await connector(admin, { ...event, sourceKey: `connector-suppressed-${marker}` })).json();
    await prisma.indicator.update({ where: { id: indicator.id }, data: { suppressionKind: 'FALSE_POSITIVE' } });
    await worker.drainOnce();
    assert.equal((await prisma.threatEvent.findUniqueOrThrow({ where: { id: suppressed.eventId } })).processingStatus, 'NO_MATCH');
    await prisma.indicator.update({ where: { id: indicator.id }, data: { suppressionKind: null } });
    const delayed = await (await connector(admin, { ...event, sourceKey: `connector-delayed-${marker}`, observedAt: new Date(Date.now() - 600000).toISOString() })).json();
    await worker.drainOnce();
    assert.equal((await prisma.threatEvent.findUniqueOrThrow({ where: { id: delayed.eventId } })).processingStatus, 'NO_MATCH');

    const invalidFeed = await prisma.indicator.create({ data: { tenantId: own.id, type: 'URL', value: 'not a valid URL', confidence: 90, status: 'ACTIVE' } });
    await prisma.indicatorSourceObservation.create({ data: { tenantId: own.id, indicatorId: invalidFeed.id, intelligenceSourceId: source.id,
      sourceKey: `bad-url-${marker}`, sourceName: 'URLhaus malformed QA row', provider: 'URLhaus', origin: 'FEED' } });
    const retryEvent = await (await connector(admin, { ...event, sourceKey: `connector-retry-${marker}`, observableType: 'URL',
      observableValue: 'https://valid.example/path', ioaKind: 'HTTP_REQUEST' })).json();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await worker.drainOnce();
      const state = await prisma.threatEvent.findUniqueOrThrow({ where: { id: retryEvent.eventId } });
      assert.equal(state.attempts, attempt);
      assert.equal(state.processingStatus, attempt === 3 ? 'FAILED' : 'PENDING');
      if (attempt < 3) await prisma.threatEvent.update({ where: { id: retryEvent.eventId }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    }
    const health = await (await fetch(`${api}/threat-correlations/connector/health`, { headers: { authorization: `Bearer ${admin}` } })).json();
    assert.ok(health.counts.FAILED >= 1);
    assert.equal((await fetch(`${api}/threat-correlations/connector/health`, { headers: { authorization: `Bearer ${reader}` } })).status, 403);
  } finally { await app.close(); await prisma.$disconnect(); }
});
