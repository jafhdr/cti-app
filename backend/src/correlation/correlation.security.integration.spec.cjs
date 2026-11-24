require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { CorrelationModule } = require('../../dist/src/correlation/correlation.module');
const { CorrelationQueueService } = require('../../dist/src/correlation/correlation-queue.service');
const { PrismaService } = require('../../dist/src/prisma.service');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('Machine credentials are tenant-scoped and correlation survives restart and stale lease', { timeout: 90000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/cti_corr_qa_/);
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, CorrelationModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(33109, '127.0.0.1');
  const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const send = (path, method, token, body) => fetch(`${api}${path}`, { method, headers: {
    authorization: token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const ti = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'threat-intelligence' } });
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `MACHINE ${marker}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: { moduleId: ti.id } } } });
    async function tenant(label) {
      const row = await prisma.tenant.create({ data: { name: `Machine ${label}`, slug: `machine-${label}-${marker}` } });
      await prisma.tenantSubscription.create({ data: { tenantId: row.id, packageId: pkg.id, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      await prisma.tenantModule.create({ data: { tenantId: row.id, moduleId: ti.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
      return row;
    }
    const own = await tenant('own');
    const foreign = await tenant('foreign');
    async function account(tenantId, role, label) {
      const user = await prisma.user.create({ data: { tenantId, role, name: label, email: `${label}-${marker}@example.test`, passwordHash: 'synthetic' } });
      await prisma.userModuleAccess.create({ data: { userId: user.id, tenantId, moduleId: ti.id, featureKeys: ['indicator-management'] } });
      return { id: user.id, token: await createAccessToken(prisma, user.id, process.env.JWT_ACCESS_SECRET) };
    }
    const admin = await account(own.id, 'ADMIN', 'machine-admin');
    const reader = await account(own.id, 'USER', 'machine-reader');
    const outsider = await account(foreign.id, 'ADMIN', 'machine-outsider');
    const source = await prisma.intelligenceSource.create({ data: { tenantId: own.id, name: `URLhaus ${marker}`, sourceType: 'COMMUNITY', status: 'ACTIVE', provider: 'URLhaus', createdBy: 'qa' } });
    const value = `machine-${marker}.example`;
    const indicator = await prisma.indicator.create({ data: { tenantId: own.id, type: 'DOMAIN', value, confidence: 92, severity: 'HIGH', status: 'ACTIVE' } });
    const observation = await prisma.indicatorSourceObservation.create({ data: { tenantId: own.id, indicatorId: indicator.id, intelligenceSourceId: source.id,
      sourceKey: `urlhaus-${marker}`, sourceName: 'URLhaus', provider: 'URLhaus', origin: 'FEED' } });
    const credentialBody = { name: 'sandbox SIEM', expiresInDays: 30 };
    assert.equal((await send('/threat-correlations/connector-credentials', 'POST', `Bearer ${reader.token}`, credentialBody)).status, 403);
    assert.equal((await send('/threat-correlations/connector-credentials', 'POST', `Bearer ${outsider.token}`, { ...credentialBody, tenantId: own.id })).status, 403);
    const issuedResponse = await send('/threat-correlations/connector-credentials', 'POST', `Bearer ${admin.token}`, credentialBody);
    assert.equal(issuedResponse.status, 201, await issuedResponse.clone().text());
    const issued = await issuedResponse.json();
    assert.match(issued.token, /^sicti_c_[a-z0-9]+\.[A-Za-z0-9_-]{43}$/);
    const stored = await prisma.correlationConnectorCredential.findUniqueOrThrow({ where: { id: issued.id } });
    assert.equal(stored.tenantId, own.id);
    assert.notEqual(stored.secretHash, issued.token.split('.')[1]);
    const listed = await (await send('/threat-correlations/connector-credentials', 'GET', `Bearer ${admin.token}`)).json();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].token, undefined);
    assert.equal(listed[0].secretHash, undefined);
    const telemetry = { sourceKey: `machine-event-${marker}`, observedAt: new Date().toISOString(), observableType: 'DOMAIN',
      observableValue: value.toUpperCase(), ioaKind: 'DNS_QUERY', sourceName: 'Sandbox SIEM', confidence: 88, tlp: 'AMBER' };
    const machinePath = '/threat-correlations/machine/events';
    process.env.THREAT_CORRELATION_PILOT_ENABLED = 'false';
    try { assert.equal((await send(machinePath, 'POST', `SICTIConnector ${issued.token}`, telemetry)).status, 404); }
    finally { process.env.THREAT_CORRELATION_PILOT_ENABLED = 'true'; }
    assert.equal((await send(machinePath, 'POST', '', telemetry)).status, 401);
    assert.equal((await send(machinePath, 'POST', `Bearer ${issued.token}`, telemetry)).status, 401);
    assert.equal((await send(machinePath, 'POST', `SICTIConnector ${issued.token}wrong`, telemetry)).status, 401);
    assert.equal((await send(machinePath, 'POST', `SICTIConnector ${issued.token}`, { ...telemetry, tenantId: foreign.id })).status, 403);
    assert.equal((await send('/threat-correlations/connector-credentials', 'GET', `SICTIConnector ${issued.token}`)).status, 401);
    const accepted = await send(machinePath, 'POST', `SICTIConnector ${issued.token}`, telemetry);
    assert.equal(accepted.status, 201, await accepted.clone().text());
    const receipt = await accepted.json();
    assert.equal(receipt.status, 'QUEUED');
    assert.equal((await (await send(machinePath, 'POST', `SICTIConnector ${issued.token}`, telemetry)).json()).status, 'DUPLICATE');
    assert.equal((await send(machinePath, 'POST', `SICTIConnector ${issued.token}`, { ...telemetry, confidence: 10 })).status, 409);
    const token = await prisma.correlationConnectorCredential.findUniqueOrThrow({ where: { id: issued.id } });
    assert.ok(token.lastUsedAt);
    await prisma.threatEvent.update({ where: { id: receipt.eventId }, data: { processingStatus: 'PROCESSING', attempts: 1,
      processingStartedAt: new Date(Date.now() - 40000) } });
    const workerA = app.get(CorrelationQueueService);
    const workerB = new CorrelationQueueService(app.get(PrismaService));
    const claims = await Promise.all([workerA.drainOnce(), workerB.drainOnce()]);
    assert.ok(claims.reduce((a, b) => a + b, 0) >= 1);
    const processed = await prisma.threatEvent.findUniqueOrThrow({ where: { id: receipt.eventId }, include: { correlations: true } });
    assert.equal(processed.processingStatus, 'MATCHED');
    assert.equal(processed.attempts, 2);
    assert.equal(processed.correlations.length, 1);
    const correlation = processed.correlations[0];
    assert.equal(correlation.feedObservationId, observation.id);
    assert.equal(correlation.score, 90);
    assert.equal((correlation.evidence).tlp, 'AMBER');
    assert.equal(await prisma.alert.count({ where: { tenantId: own.id, source: 'CORRELATION', sourceKey: `EVENT:${receipt.eventId}:${observation.id}` } }), 1);
    const notice = await prisma.notification.findFirstOrThrow({ where: { tenantId: own.id, dedupeKey: `THREAT_CORRELATION:${receipt.eventId}:${observation.id}` } });
    assert.equal(await prisma.notificationRecipient.count({ where: { notificationId: notice.id } }), 2);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: own.id, action: 'THREAT_CORRELATION_DETECTED', metadata: { path: ['eventId'], equals: receipt.eventId } } }), 1);
    assert.equal((await send(`/threat-correlations/connector/events/${receipt.eventId}`, 'GET', `Bearer ${outsider.token}`)).status, 404);

    const badUrl = await prisma.indicator.create({ data: { tenantId: own.id, type: 'URL', value: 'invalid URL', confidence: 90, status: 'ACTIVE' } });
    await prisma.indicatorSourceObservation.create({ data: { tenantId: own.id, indicatorId: badUrl.id, intelligenceSourceId: source.id,
      sourceKey: `temporary-error-${marker}`, sourceName: 'URLhaus QA recovery', provider: 'URLhaus', origin: 'FEED' } });
    const recoveryResponse = await send(machinePath, 'POST', `SICTIConnector ${issued.token}`, { ...telemetry,
      sourceKey: `recovery-${marker}`, observableType: 'URL', observableValue: 'https://recovery.example/', ioaKind: 'HTTP_REQUEST' });
    assert.equal(recoveryResponse.status, 201);
    const recoveryId = (await recoveryResponse.json()).eventId;
    await workerB.drainOnce();
    assert.equal((await prisma.threatEvent.findUniqueOrThrow({ where: { id: recoveryId } })).processingStatus, 'PENDING');
    await prisma.indicator.update({ where: { id: badUrl.id }, data: { value: 'https://recovery.example/' } });
    await prisma.threatEvent.update({ where: { id: recoveryId }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await workerB.drainOnce();
    const recovered = await prisma.threatEvent.findUniqueOrThrow({ where: { id: recoveryId }, include: { correlations: true } });
    assert.equal(recovered.processingStatus, 'MATCHED');
    assert.equal(recovered.attempts, 2);
    assert.equal(recovered.correlations.length, 1);

    const redResponse = await send(machinePath, 'POST', `SICTIConnector ${issued.token}`, { ...telemetry,
      sourceKey: `red-${marker}`, tlp: 'RED' });
    assert.equal(redResponse.status, 201);
    const redId = (await redResponse.json()).eventId;
    await workerB.drainOnce();
    assert.equal((await prisma.threatEvent.findUniqueOrThrow({ where: { id: redId } })).processingStatus, 'MATCHED');
    assert.equal((await send(`/threat-correlations/connector/events/${redId}`, 'GET', `Bearer ${reader.token}`)).status, 404);
    const readerRows = await (await send('/threat-correlations', 'GET', `Bearer ${reader.token}`)).json();
    assert.ok(!readerRows.some(row => row.eventId === redId));
    const redNotice = await prisma.notification.findFirstOrThrow({ where: { tenantId: own.id,
      dedupeKey: `THREAT_CORRELATION:${redId}:${observation.id}` } });
    assert.equal(await prisma.notificationRecipient.count({ where: { notificationId: redNotice.id } }), 1);

    const rotatedResponse = await send(`/threat-correlations/connector-credentials/${issued.id}/rotate`, 'POST', `Bearer ${admin.token}`, { expiresInDays: 30 });
    assert.equal(rotatedResponse.status, 201, await rotatedResponse.clone().text());
    const rotated = await rotatedResponse.json();
    assert.equal((await send(machinePath, 'POST', `SICTIConnector ${issued.token}`, { ...telemetry, sourceKey: `old-${marker}` })).status, 401);
    assert.equal((await send(machinePath, 'POST', `SICTIConnector ${rotated.token}`, { ...telemetry, sourceKey: `new-${marker}` })).status, 201);
    await prisma.correlationConnectorCredential.update({ where: { id: rotated.id }, data: {
      createdAt: new Date(Date.now() - 2 * 86400000), expiresAt: new Date(Date.now() - 86400000) } });
    assert.equal((await send(machinePath, 'POST', `SICTIConnector ${rotated.token}`, { ...telemetry, sourceKey: `expired-${marker}` })).status, 401);
    await prisma.correlationConnectorCredential.update({ where: { id: rotated.id }, data: { expiresAt: new Date(Date.now() + 86400000) } });
    assert.equal((await send(`/threat-correlations/connector-credentials/${rotated.id}`, 'DELETE', `Bearer ${admin.token}`)).status, 200);
    assert.equal((await send(machinePath, 'POST', `SICTIConnector ${rotated.token}`, { ...telemetry, sourceKey: `revoked-${marker}` })).status, 401);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: own.id, action: { in: ['CORRELATION_CONNECTOR_CREDENTIAL_CREATED', 'CORRELATION_CONNECTOR_CREDENTIAL_ROTATED', 'CORRELATION_CONNECTOR_CREDENTIAL_REVOKED'] } } }), 3);
  } finally { await app.close(); await prisma.$disconnect(); }
});
