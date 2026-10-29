const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { AsmAlertsService } = require('../../dist/src/attack-surface-management/alerts.service');
const { AsmV2EvidenceService } = require('../../dist/src/attack-surface-management/asm-v2-evidence.service');
const { VulnerabilityCorrelationsService } = require('../../dist/src/attack-surface-management/vulnerability-correlations.service');

test('ASM V2 P1-A evidence, V1 preservation and disabled fallback', { timeout: 90000 }, async () => {
  const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/cti').pathname.slice(1);
  assert.match(database, /^cti_asm(59|60|61|62)_qa_/);
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const previousFlag = process.env.ASM_V2_EVIDENCE_ENABLED;
  let ownId;
  let foreignId;
  try {
    process.env.ASM_V2_EVIDENCE_ENABLED = 'true';
    const own = await prisma.tenant.create({ data: { name: 'ASM V2 QA', slug: `asm-v2-${marker}` } });
    const foreign = await prisma.tenant.create({ data: { name: 'ASM V2 foreign', slug: `asm-v2-foreign-${marker}` } });
    ownId = own.id; foreignId = foreign.id;
    const user = await prisma.user.create({ data: { name: 'ASM V2 analyst', email: `asm-v2-${marker}@example.test`, passwordHash: 'synthetic', role: 'ADMIN', tenantId: ownId } });
    const actor = { sub: user.id, role: 'ADMIN', tenantId: ownId };
    const v2 = new AsmV2EvidenceService(prisma);
    const correlations = new VulnerabilityCorrelationsService(prisma, new AsmAlertsService(prisma), v2);
    const vulnerability = await prisma.vulnerability.create({ data: { tenantId: ownId, cveId: `CVE-2026-${marker.slice(0, 5)}`, name: 'QA OpenSSH', severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionExact: '8.4', source: 'QA' } });
    const legacyAsset = await prisma.asset.create({ data: { tenantId: ownId, name: 'Legacy', type: 'IP_ADDRESS', value: '192.0.2.60' } });
    await prisma.assetPortService.create({ data: { tenantId: ownId, assetId: legacyAsset.id, port: 22, protocol: 'TCP', product: 'OpenSSH', version: '8.4', status: 'OPEN', source: 'MANUAL' } });
    const legacy = (await correlations.refresh(actor, legacyAsset.id))[0];
    assert.equal(legacy.workflowVersion, 1);
    const legacyFinding = await prisma.assetFinding.findFirstOrThrow({ where: { tenantId: ownId, assetId: legacyAsset.id, source: 'VULNERABILITY_CORRELATION' } });
    assert.equal(legacyFinding.status, 'OPEN');

    assert.deepEqual(await v2.setEnrollment(actor, true), { enrolled: true });
    const candidateAsset = await prisma.asset.create({ data: { tenantId: ownId, name: 'Candidate', type: 'IP_ADDRESS', value: '192.0.2.61' } });
    const service = await prisma.assetPortService.create({ data: { tenantId: ownId, assetId: candidateAsset.id, port: 22, protocol: 'TCP', product: 'OpenSSH', version: '8.4', status: 'OPEN', source: 'PROBE' } });
    const [candidate] = await correlations.refresh(actor, candidateAsset.id);
    assert.equal(candidate.workflowVersion, 2);
    assert.equal(candidate.reviewStatus, 'PENDING');
    assert.equal(candidate.confidence, 'HIGH');
    assert.equal(await prisma.assetFinding.count({ where: { tenantId: ownId, assetId: candidateAsset.id, source: 'VULNERABILITY_CORRELATION' } }), 0);
    assert.equal(await prisma.alert.count({ where: { tenantId: ownId, assetId: candidateAsset.id } }), 0);
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { tenantId: ownId, correlationId: candidate.id } }), 1);
    await Promise.all([correlations.refresh(actor, candidateAsset.id), correlations.refresh(actor, candidateAsset.id)]);
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { tenantId: ownId, correlationId: candidate.id } }), 1);
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: candidate.id } })).revision, 1);
    await prisma.assetPortService.update({ where: { id: service.id }, data: { version: null } });
    await correlations.refresh(actor, candidateAsset.id);
    const changed = await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(changed.confidence, 'LOW');
    assert.equal(changed.revision, 2);
    assert.equal(await prisma.asmCorrelationObservation.count({ where: { tenantId: ownId, correlationId: candidate.id } }), 2);
    assert.equal(await prisma.assetFinding.count({ where: { tenantId: ownId, assetId: candidateAsset.id } }), 0);

    const activated = await v2.activate(actor, legacyAsset.id, legacy.id);
    assert.equal(activated.workflowVersion, 2);
    assert.equal((await prisma.assetFinding.findUniqueOrThrow({ where: { id: legacyFinding.id } })).status, 'OPEN');
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: ownId, action: 'ASM_V2_CORRELATION_ACTIVATED' } });
    assert.equal(audit?.userId, user.id);
    const run = await prisma.asmDiscoveryRun.create({ data: { tenantId: ownId, assetId: candidateAsset.id, source: 'QA_COMPLETE', status: 'COMPLETED' } });
    await prisma.assetPortService.update({ where: { id: service.id }, data: { status: 'CLOSED', lastSeenAt: new Date() } });
    await correlations.refresh(actor, candidateAsset.id);
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: candidate.id } })).status, 'ACTIVE');
    await correlations.refresh(actor, candidateAsset.id, undefined, run.id);
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: candidate.id } })).status, 'STALE');
    assert.equal((await prisma.asmCorrelationObservation.findFirstOrThrow({ where: { correlationId: candidate.id }, orderBy: { observedAt: 'desc' } })).kind, 'NOT_OBSERVED');

    process.env.ASM_V2_EVIDENCE_ENABLED = 'false';
    await prisma.assetPortService.update({ where: { id: service.id }, data: { status: 'OPEN', version: '8.4' } });
    await correlations.refresh(actor, candidateAsset.id);
    assert.equal((await prisma.assetVulnerabilityCorrelation.findUniqueOrThrow({ where: { id: candidate.id } })).status, 'STALE');
    assert.equal(await prisma.assetFinding.count({ where: { tenantId: ownId, assetId: candidateAsset.id } }), 0);
    await assert.rejects(() => v2.setEnrollment(actor, false), { status: 403 });
    await assert.rejects(() => v2.list({ ...actor, tenantId: foreignId }, candidateAsset.id), { status: 404 });
    assert.equal(vulnerability.tenantId, ownId);
  } finally {
    if (previousFlag === undefined) delete process.env.ASM_V2_EVIDENCE_ENABLED;
    else process.env.ASM_V2_EVIDENCE_ENABLED = previousFlag;
    if (ownId) await prisma.user.deleteMany({ where: { tenantId: ownId } });
    if (ownId) await prisma.tenant.delete({ where: { id: ownId } });
    if (foreignId) await prisma.tenant.delete({ where: { id: foreignId } });
    await prisma.$disconnect();
  }
});
