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
const { latestFingerprint } = require('../../dist/src/attack-surface-management/fingerprint-order');

function barrierProbe(real) {
  let arrived;
  let release;
  const reached = new Promise(resolve => { arrived = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  return { probe: async (...args) => {
    const result = await real.probe(...args);
    arrived(result);
    await gate;
    return result;
  }, reached, release: () => release() };
}

test('real SSH probes preserve newest observation across overlapping discovery runs', { timeout: 120000 }, async () => {
  const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/cti').pathname.slice(1);
  assert.match(database, /^cti_asm62_qa_case20_[0-9a-f]{8}$/);
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const oldFlag = process.env.ASM_V2_EVIDENCE_ENABLED;
  process.env.ASM_V2_EVIDENCE_ENABLED = 'true';
  let banner = 'SSH-2.0-OpenSSH_8.4p1\r\n';
  const server = createServer(socket => { socket.on('error', () => {}); socket.end(banner); });
  let tenantId;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    tenantId = (await prisma.tenant.create({ data: { name: 'Order QA', slug: `order-${marker}` } })).id;
    const user = await prisma.user.create({ data: { tenantId, name: 'Order QA', email: `order-${marker}@example.test`, passwordHash: 'synthetic', role: 'ADMIN' } });
    const actor = { sub: user.id, role: 'ADMIN', tenantId };
    const ip = await prisma.asset.create({ data: { tenantId, name: 'SSH target', type: 'IP_ADDRESS', value: '127.0.0.1' } });
    const parent = await prisma.asset.create({ data: { tenantId, name: 'SSH parent', type: 'DOMAIN', value: 'order.example.test' } });
    const link = await prisma.assetRelationship.create({ data: { tenantId, rootAssetId: parent.id, sourceAssetId: parent.id, targetAssetId: ip.id, type: 'RESOLVES_TO', source: 'DNS_RESOLUTION' } });
    const vulnerability = await prisma.vulnerability.create({ data: { tenantId, cveId: `CVE-2026-${marker.slice(0, 5)}`, name: 'Synthetic portable patch', severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionExact: '8.4p1', source: 'QA' } });
    const ambiguousVulnerability = await prisma.vulnerability.create({ data: { tenantId, cveId: `CVE-2026-${marker.slice(5, 10)}`, name: 'Synthetic ambiguous patch boundary', severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionEnd: '8.4', source: 'QA' } });
    const evidence = new AsmV2EvidenceService(prisma);
    const correlations = new VulnerabilityCorrelationsService(prisma, new AsmAlertsService(prisma), evidence);
    const ports = new PortDiscoveryService(prisma, new PortDiscoveryClient());
    const risk = new RiskPostureService(prisma);
    const discovery = { runDiscovery: async () => {
      await prisma.assetRelationship.update({ where: { id: link.id }, data: { lastSeenAt: new Date() } });
      return { discovered: 1, created: 0, updated: 1, failed: 0, errors: [], providers: ['QA_DNS'] };
    } };
    const runner = (probe) => new DiscoveryRunsService(prisma, discovery, ports, correlations, risk, probe);
    const real = new SshFingerprintClient();
    const runIp = (probe = real) => runner(probe).run(actor, ip.id, undefined, 'QA_IP', true, [port]);
    const runParent = (probe = real) => runner(probe).run(actor, parent.id, undefined, 'QA_PARENT', true, [port]);
    await evidence.setEnrollment(actor, true);

    const initial = await runIp();
    assert.equal(initial.status, 'COMPLETED');
    const service = await prisma.assetPortService.findFirstOrThrow({ where: { tenantId, assetId: ip.id, port } });
    assert.equal(service.version, '8.4p1');
    const correlation = await prisma.assetVulnerabilityCorrelation.findFirstOrThrow({ where: { tenantId, serviceId: service.id, vulnerabilityId: vulnerability.id } });
    assert.equal(correlation.status, 'ACTIVE');
    const ambiguousCorrelation = await prisma.assetVulnerabilityCorrelation.findFirstOrThrow({ where: { tenantId, serviceId: service.id, vulnerabilityId: ambiguousVulnerability.id } });
    assert.equal(ambiguousCorrelation.confidence, 'MEDIUM');
    assert.equal(ambiguousCorrelation.status, 'ACTIVE');
    const finding = await prisma.assetFinding.create({ data: { tenantId, assetId: ip.id, title: 'Synthetic OpenSSH finding', description: 'QA verified correlation', type: 'VULNERABILITY', severity: 'HIGH', source: 'VULNERABILITY_CORRELATION', sourceKey: `${service.id}:${vulnerability.id}` } });
    const originalRevision = correlation.revision;
    const samePatchRun = await runIp();
    assert.equal(samePatchRun.status, 'COMPLETED');
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: ambiguousCorrelation.id } })).status, 'ACTIVE');
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { correlationId: ambiguousCorrelation.id, kind: 'NOT_OBSERVED' } }), 0);

    const older = barrierProbe(real);
    const olderRunPromise = runIp(older);
    assert.equal((await older.reached).version, '8.4p1');
    banner = 'SSH-2.0-OpenSSH_9.9p1\r\n';
    const newerRun = await runParent();
    assert.equal(newerRun.status, 'COMPLETED');
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).status, 'STALE');
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: ambiguousCorrelation.id } })).status, 'STALE');
    assert.equal((await prisma.assetFinding.findUniqueOrThrow({ where: { id: finding.id } })).status, 'RESOLVED');
    older.release();
    const olderRun = await olderRunPromise;
    assert.equal(olderRun.status, 'COMPLETED');
    const staleObservation = await prisma.asmServiceFingerprintObservation.findFirstOrThrow({ where: { discoveryRunId: olderRun.id, serviceId: service.id } });
    assert.equal(staleObservation.version, '8.4p1');
    assert.equal((await prisma.assetPortService.findUniqueOrThrow({ where: { id: service.id } })).version, '9.9p1');
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).status, 'STALE');
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { correlationId: correlation.id, discoveryRunId: olderRun.id } }), 0);
    const newerObservation = await prisma.asmServiceFingerprintObservation.findFirstOrThrow({ where: { discoveryRunId: newerRun.id, serviceId: service.id } });
    await prisma.asmServiceFingerprintObservation.update({ where: { id: staleObservation.id }, data: { observedAt: newerObservation.observedAt } });
    assert.equal((await latestFingerprint(prisma, tenantId, service.id)).id, newerObservation.id);

    const first = barrierProbe(real);
    const firstRunPromise = runParent(first);
    assert.equal((await first.reached).version, '9.9p1');
    banner = 'SSH-2.0-OpenSSH_8.4p1\r\n';
    const secondRun = await runIp();
    assert.equal(secondRun.status, 'COMPLETED');
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).status, 'ACTIVE');
    first.release();
    const firstRun = await firstRunPromise;
    assert.equal(firstRun.status, 'COMPLETED');
    assert.equal((await prisma.assetPortService.findUniqueOrThrow({ where: { id: service.id } })).version, '8.4p1');
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).status, 'ACTIVE');
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { correlationId: correlation.id, discoveryRunId: firstRun.id } }), 0);
    const history = await prisma.asmCorrelationObservation.findMany({ where: { correlationId: correlation.id }, orderBy: { observedAt: 'asc' } });
    assert.deepEqual(history.map(item => item.kind), ['MATCHED', 'NOT_OBSERVED', 'MATCHED']);
    assert.equal(history[1].discoveryRunId, newerRun.id);
    assert.equal(history[2].discoveryRunId, secondRun.id);
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).revision, originalRevision + 2);
    const [matchingIp, matchingParent] = await Promise.all([runIp(), runParent()]);
    assert.equal(matchingIp.status, 'COMPLETED');
    assert.equal(matchingParent.status, 'COMPLETED');
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: correlation.id } })).revision, originalRevision + 2);
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { correlationId: correlation.id } }), 3);
  } finally {
    if (oldFlag === undefined) delete process.env.ASM_V2_EVIDENCE_ENABLED;
    else process.env.ASM_V2_EVIDENCE_ENABLED = oldFlag;
    await new Promise(resolve => server.close(resolve));
    if (tenantId) { await prisma.user.deleteMany({ where: { tenantId } }); await prisma.tenant.delete({ where: { id: tenantId } }); }
    await prisma.$disconnect();
  }
});
