const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:net');
const { PrismaClient } = require('@prisma/client');
const { AsmAlertsService } = require('../../dist/src/attack-surface-management/alerts.service');
const { AsmV2EvidenceService } = require('../../dist/src/attack-surface-management/asm-v2-evidence.service');
const { VulnerabilityCorrelationsService } = require('../../dist/src/attack-surface-management/vulnerability-correlations.service');
const { DiscoveryRunsService } = require('../../dist/src/attack-surface-management/discovery-runs.service');
const { PortDiscoveryService } = require('../../dist/src/attack-surface-management/port-discovery.service');
const { PortDiscoveryClient } = require('../../dist/src/attack-surface-management/port-discovery.client');
const { RiskPostureService } = require('../../dist/src/attack-surface-management/risk-posture.service');
const { SshFingerprintClient } = require('../../dist/src/attack-surface-management/ssh-fingerprint.client');

test('completed discovery retires only a correlation with a newly observed SSH fingerprint', { timeout: 120000 }, async () => {
  const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/cti').pathname.slice(1);
  assert.match(database, /^cti_asm62_qa_case18_[0-9a-f]{8}$/);
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const oldFlag = process.env.ASM_V2_EVIDENCE_ENABLED;
  let banner = 'SSH-2.0-OpenSSH_8.4\r\n';
  const server = createServer(socket => {
    socket.on('error', () => {});
    socket.end(banner);
  });
  let tenantId;
  let foreignId;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    const tenant = await prisma.tenant.create({ data: { name: 'Fingerprint QA', slug: `fingerprint-${marker}` } });
    tenantId = tenant.id;
    foreignId = (await prisma.tenant.create({ data: { name: 'Foreign fingerprint QA', slug: `foreign-fingerprint-${marker}` } })).id;
    const user = await prisma.user.create({ data: { name: 'Fingerprint analyst', email: `fingerprint-${marker}@example.test`, passwordHash: 'synthetic', role: 'ADMIN', tenantId } });
    const actor = { sub: user.id, role: 'ADMIN', tenantId };
    const asset = await prisma.asset.create({ data: { tenantId, name: 'Local SSH', type: 'IP_ADDRESS', value: '127.0.0.1' } });
    const vulnerability = await prisma.vulnerability.create({ data: { tenantId, cveId: `CVE-2026-${marker.slice(0, 5)}`, name: 'Synthetic OpenSSH 8.4', severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionExact: '8.4', source: 'QA' } });
    const evidence = new AsmV2EvidenceService(prisma);
    const correlations = new VulnerabilityCorrelationsService(prisma, new AsmAlertsService(prisma), evidence);
    const runner = new DiscoveryRunsService(prisma, {}, new PortDiscoveryService(prisma, new PortDiscoveryClient()), correlations, new RiskPostureService(prisma), new SshFingerprintClient());
    const run = () => runner.run(actor, asset.id, undefined, 'QA', true, [port]);

    process.env.ASM_V2_EVIDENCE_ENABLED = 'false';
    const manualService = await prisma.assetPortService.create({ data: { tenantId, assetId: asset.id, port, protocol: 'TCP', product: 'OpenSSH', version: '8.4', source: 'MANUAL', status: 'OPEN' } });
    const [legacy] = await correlations.refresh(actor, asset.id);
    assert.equal(legacy.workflowVersion, 1);
    process.env.ASM_V2_EVIDENCE_ENABLED = 'true';
    await evidence.setEnrollment(actor, true);
    const firstRun = await run();
    assert.equal(firstRun.status, 'COMPLETED');
    const service = await prisma.assetPortService.findFirstOrThrow({ where: { tenantId, assetId: asset.id, port } });
    assert.equal(service.id, manualService.id);
    assert.equal(service.version, '8.4');
    const firstFingerprint = await prisma.asmServiceFingerprintObservation.findFirstOrThrow({ where: { tenantId, serviceId: service.id, discoveryRunId: firstRun.id } });
    assert.equal(firstFingerprint.source, 'SSH_BANNER');
    assert.match(firstFingerprint.bannerHash, /^[0-9a-f]{64}$/);
    const foreignUser = await prisma.user.create({ data: { name: 'Second fingerprint analyst', email: `second-fingerprint-${marker}@example.test`, passwordHash: 'synthetic', role: 'ADMIN', tenantId: foreignId } });
    const foreignActor = { sub: foreignUser.id, role: 'ADMIN', tenantId: foreignId };
    await prisma.vulnerability.create({ data: { tenantId: foreignId, cveId: `CVE-2026-${marker.slice(0, 5)}`, name: 'Second tenant OpenSSH 8.4', severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionExact: '8.4', source: 'QA' } });
    await evidence.setEnrollment(foreignActor, true);
    const newAsset = await prisma.asset.create({ data: { tenantId: foreignId, name: 'New local SSH', type: 'IP_ADDRESS', value: '127.0.0.1' } });
    const newRun = await runner.run(foreignActor, newAsset.id, undefined, 'QA', true, [port]);
    assert.equal(newRun.status, 'COMPLETED');
    const newService = await prisma.assetPortService.findFirstOrThrow({ where: { tenantId: foreignId, assetId: newAsset.id, port } });
    const newCorrelation = await prisma.assetVulnerabilityCorrelation.findFirstOrThrow({ where: { tenantId: foreignId, assetId: newAsset.id, serviceId: newService.id } });
    assert.equal(newCorrelation.workflowVersion, 2);
    assert.equal(newCorrelation.status, 'ACTIVE');
    assert.equal((await prisma.asmServiceFingerprintObservation.findFirstOrThrow({ where: { tenantId: foreignId, serviceId: newService.id, discoveryRunId: newRun.id } })).version, '8.4');
    assert.equal((await prisma.asmCorrelationObservation.findFirstOrThrow({ where: { correlationId: newCorrelation.id, kind: 'MATCHED' } })).discoveryRunId, newRun.id);
    const parent = await prisma.asset.create({ data: { tenantId: foreignId, name: 'Local parent', type: 'DOMAIN', value: 'local.example.test' } });
    const link = await prisma.assetRelationship.create({ data: { tenantId: foreignId, rootAssetId: parent.id, sourceAssetId: parent.id,
      targetAssetId: newAsset.id, type: 'RESOLVES_TO', source: 'DNS_RESOLUTION' } });
    const discovery = { runDiscovery: async () => {
      await prisma.assetRelationship.update({ where: { id: link.id }, data: { lastSeenAt: new Date() } });
      return { discovered: 1, created: 0, updated: 1, failed: 0, errors: [], providers: ['QA_DNS'] };
    } };
    const parentRunner = new DiscoveryRunsService(prisma, discovery, new PortDiscoveryService(prisma, new PortDiscoveryClient()), correlations, new RiskPostureService(prisma), new SshFingerprintClient());
    banner = 'SSH-2.0-OpenSSH_9.9\r\n';
    const parentRun = await parentRunner.run(foreignActor, parent.id, undefined, 'QA_PARENT', true, [port]);
    assert.equal(parentRun.status, 'COMPLETED');
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: newCorrelation.id } })).status, 'STALE');
    assert.equal((await prisma.asmCorrelationObservation.findFirstOrThrow({ where: { correlationId: newCorrelation.id, kind: 'NOT_OBSERVED' } })).discoveryRunId, parentRun.id);
    const correlation = await prisma.assetVulnerabilityCorrelation.findFirstOrThrow({ where: { tenantId, assetId: asset.id, serviceId: service.id, vulnerabilityId: vulnerability.id } });
    assert.equal(correlation.workflowVersion, 1);
    const finding = await prisma.assetFinding.findFirstOrThrow({ where: { tenantId, assetId: asset.id, source: 'VULNERABILITY_CORRELATION', sourceKey: `${service.id}:${vulnerability.id}` } });
    assert.equal(finding.status, 'OPEN');

    await evidence.activate(actor, asset.id, correlation.id);
    const before = await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } });
    const decision = await prisma.asmCorrelationDecision.create({ data: { tenantId, correlationId: correlation.id, actorId: user.id,
      kind: 'APPROVE', previousReviewStatus: 'PENDING', reviewStatus: 'APPROVED', reason: 'QA analyst decision',
      evidenceHash: before.evidenceHash, expectedRevision: before.revision, resultingRevision: before.revision,
      requestKey: `qa-${marker}`, inspectedEvidence: true } });
    await prisma.assetVulnerabilityCorrelation.update({ where: { id: correlation.id }, data: { reviewStatus: 'APPROVED', reviewedEvidenceHash: before.evidenceHash } });
    const caseRecord = await prisma.case.create({ data: { tenantId, caseNumber: `QA-${marker.slice(0, 8)}`, title: 'Preserve analyst case', createdBy: user.id } });
    const indicator = await prisma.indicator.create({ data: { tenantId, type: 'IP_ADDRESS', value: '198.51.100.18', status: 'ACTIVE' } });
    const application = await prisma.application.create({ data: { tenantId, name: `QA app ${marker}` } });
    const appFinding = await prisma.appSecFinding.create({ data: { tenantId, applicationId: application.id, title: 'Preserve AppSec state', severity: 'HIGH', workflowVersion: 2, revision: 3 } });
    const analystFinding = await prisma.assetFinding.create({ data: { tenantId, assetId: asset.id, title: 'Analyst finding', description: 'Manual observation', type: 'MANUAL', severity: 'MEDIUM', source: 'MANUAL', sourceKey: `analyst:${marker}` } });
    const analystAlert = await prisma.alert.create({ data: { tenantId, assetId: asset.id, title: 'Analyst alert', source: 'ASM', sourceKey: `analyst:${marker}`, severity: 'HIGH', vulnerabilityCorrelationId: correlation.id, caseId: caseRecord.id } });
    banner = 'SSH-2.0-OpenSSH_9.9\r\n';
    const partialRun = await prisma.asmDiscoveryRun.create({ data: { tenantId, assetId: asset.id, source: 'QA_PARTIAL' } });
    const partialFingerprint = await new SshFingerprintClient().probe('127.0.0.1', port);
    assert.equal(partialFingerprint.kind, 'VERIFIED');
    await prisma.asmDiscoveryRun.update({ where: { id: partialRun.id }, data: { status: 'PARTIAL', failed: 1, completedAt: new Date() } });
    await prisma.asmServiceFingerprintObservation.create({ data: { tenantId, assetId: asset.id, serviceId: service.id,
      discoveryRunId: partialRun.id, product: partialFingerprint.product, version: partialFingerprint.version,
      source: partialFingerprint.source, bannerHash: partialFingerprint.bannerHash, observedAt: partialFingerprint.observedAt } });
    await prisma.assetPortService.update({ where: { id: service.id }, data: { version: '9.9' } });
    await correlations.refresh(actor, asset.id, undefined, partialRun.id);
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).status, 'ACTIVE');
    banner = 'SSH-2.0-UnknownSSH_9.9\r\n';
    const unknownRun = await run();
    assert.equal(unknownRun.status, 'COMPLETED');
    assert.equal(await prisma.asmServiceFingerprintObservation.count({ where: { tenantId, discoveryRunId: unknownRun.id } }), 0);
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).status, 'ACTIVE');
    banner = 'SSH-2.0-OpenSSH_9.9\r\n';
    const failingRunner = new DiscoveryRunsService(prisma, {}, new PortDiscoveryService(prisma, new PortDiscoveryClient()), correlations,
      { capture: async () => { throw new Error('synthetic publication failure'); } }, new SshFingerprintClient());
    await assert.rejects(() => failingRunner.run(actor, asset.id, undefined, 'QA_FAILURE', true, [port]), /synthetic publication failure/);
    const failedRun = await prisma.asmDiscoveryRun.findFirstOrThrow({ where: { tenantId, assetId: asset.id, source: 'QA_FAILURE' }, orderBy: { startedAt: 'desc' } });
    assert.equal(failedRun.status, 'FAILED');
    assert.equal(await prisma.asmExposureChange.count({ where: { runId: failedRun.id } }), 0);
    assert.equal(await prisma.asmRiskSnapshot.count({ where: { runId: failedRun.id } }), 0);
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { tenantId, correlationId: correlation.id, kind: 'NOT_OBSERVED' } }), 0);
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).status, 'ACTIVE');
    assert.equal((await prisma.assetFinding.findUniqueOrThrow({ where: { id: finding.id } })).status, 'OPEN');
    const secondRun = await run();
    assert.equal(secondRun.status, 'COMPLETED');
    const changed = await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } });
    assert.equal(changed.status, 'STALE');
    assert.equal(changed.revision, before.revision + 1);
    assert.equal((await prisma.assetFinding.findUniqueOrThrow({ where: { id: finding.id } })).status, 'RESOLVED');
    assert.equal((await prisma.assetFinding.findUniqueOrThrow({ where: { id: analystFinding.id } })).status, 'OPEN');
    const preservedAlert = await prisma.alert.findUniqueOrThrow({ where: { id: analystAlert.id } });
    assert.equal(preservedAlert.status, 'OPEN');
    assert.equal(preservedAlert.caseId, caseRecord.id);
    assert.equal((await prisma.case.findUniqueOrThrow({ where: { id: caseRecord.id } })).status, 'OPEN');
    assert.equal((await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } })).status, 'ACTIVE');
    assert.equal((await prisma.appSecFinding.findUniqueOrThrow({ where: { id: appFinding.id } })).revision, 3);
    assert.equal((await prisma.appSecFinding.findUniqueOrThrow({ where: { id: appFinding.id } })).status, 'OPEN');
    assert.equal((await prisma.asmCorrelationDecision.findUniqueOrThrow({ where: { id: decision.id } })).reviewStatus, 'APPROVED');
    const retirements = await prisma.asmCorrelationObservation.findMany({ where: { tenantId, correlationId: correlation.id, kind: 'NOT_OBSERVED' } });
    assert.equal(retirements.length, 1);
    assert.equal(retirements[0].discoveryRunId, secondRun.id);
    assert.equal(retirements[0].fingerprintSource, 'SSH_BANNER');
    assert.equal(await evidence.markNotObserved(foreignId, asset.id, correlation.id, secondRun.id), false);
    const secondFingerprint = await prisma.asmServiceFingerprintObservation.findFirstOrThrow({ where: { tenantId, serviceId: service.id, discoveryRunId: secondRun.id } });
    assert.equal(secondFingerprint.version, '9.9');
    assert.equal((await prisma.assetPortService.findUniqueOrThrow({ where: { id: service.id } })).status, 'OPEN');

    await run();
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { tenantId, correlationId: correlation.id, kind: 'NOT_OBSERVED' } }), 1);
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).revision, changed.revision);
    await Promise.all([correlations.refresh(actor, asset.id, undefined, secondRun.id), correlations.refresh(actor, asset.id, undefined, secondRun.id)]);
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { tenantId, correlationId: correlation.id, kind: 'NOT_OBSERVED' } }), 1);
    await prisma.assetPortService.update({ where: { id: service.id }, data: { status: 'CLOSED' } });
    await correlations.refresh(actor, asset.id, undefined, secondRun.id);
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).status, 'STALE');
    banner = 'SSH-2.0-OpenSSH_8.4\r\n';
    const restoredRun = await run();
    assert.equal(restoredRun.status, 'COMPLETED');
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).status, 'ACTIVE');
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { tenantId, correlationId: correlation.id, kind: 'NOT_OBSERVED' } }), 1);
    assert.equal((await prisma.case.findUniqueOrThrow({ where: { id: caseRecord.id } })).status, 'OPEN');
  } finally {
    if (oldFlag === undefined) delete process.env.ASM_V2_EVIDENCE_ENABLED;
    else process.env.ASM_V2_EVIDENCE_ENABLED = oldFlag;
    await new Promise(resolve => server.close(resolve));
    if (tenantId) {
      await prisma.case.deleteMany({ where: { tenantId } });
      await prisma.asmCorrelationDecision.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    if (foreignId) { await prisma.user.deleteMany({ where: { tenantId: foreignId } }); await prisma.tenant.delete({ where: { id: foreignId } }); }
    await prisma.$disconnect();
  }
});
