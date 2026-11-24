const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { DiscoveryRunsService } = require('../../dist/src/attack-surface-management/discovery-runs.service');
const { VulnerabilityCorrelationsService } = require('../../dist/src/attack-surface-management/vulnerability-correlations.service');
const { AsmV2EvidenceService } = require('../../dist/src/attack-surface-management/asm-v2-evidence.service');
const { FindingsService } = require('../../dist/src/attack-surface-management/findings.service');
const { AsmAlertsService } = require('../../dist/src/attack-surface-management/alerts.service');
const { RiskPostureService } = require('../../dist/src/attack-surface-management/risk-posture.service');
const { DiscoveryScheduler } = require('../../dist/src/attack-surface-management/discovery-scheduler');

test('ASM run snapshots preserve history and suppress negatives after partial scan', { timeout: 60000 }, async () => {
  const prisma = new PrismaClient(); const marker = randomUUID(); let tenantId;
  try {
    const tenant = await prisma.tenant.create({ data: { name: `ASM run ${marker}`, slug: `asm-run-${marker}` } }); tenantId = tenant.id;
    const user = { sub: 'qa', role: 'ADMIN', tenantId };
    const asset = await prisma.asset.create({ data: { tenantId, name: 'QA IP', type: 'IP_ADDRESS', value: '192.0.2.45' } });
    await prisma.vulnerability.create({ data: { tenantId, cveId: 'CVE-2026-88888', name: 'SSH QA', severity: 'HIGH', affectedProduct: 'OpenSSH', affectedVersionExact: '8.4' } });
    let stage = 0;
    const portDiscovery = { discover: async () => {
      stage += 1;
      await prisma.assetPortService.upsert({ where: { tenantId_assetId_protocol_port: { tenantId, assetId: asset.id, protocol: 'TCP', port: 443 } }, create: { tenantId, assetId: asset.id, protocol: 'TCP', port: 443, service: 'https', status: 'OPEN' }, update: { status: 'OPEN', lastSeenAt: new Date() } });
      if (stage === 2) {
        await prisma.assetPortService.create({ data: { tenantId, assetId: asset.id, protocol: 'TCP', port: 22, service: 'ssh', product: 'OpenSSH', version: '8.4', status: 'OPEN' } });
        await prisma.assetFinding.create({ data: { tenantId, assetId: asset.id, title: 'SSH exposed', description: 'Observed open', type: 'EXPOSED_SERVICE', severity: 'MEDIUM', source: 'PORT_DISCOVERY', sourceKey: 'TCP:22' } });
      }
      if (stage === 4) await prisma.assetPortService.update({ where: { tenantId_assetId_protocol_port: { tenantId, assetId: asset.id, protocol: 'TCP', port: 22 } }, data: { status: 'CLOSED', lastSeenAt: new Date() } });
      return { target: asset.value, scanned: 2, open: stage === 2 ? 2 : 1, closed: stage === 4 ? 1 : 0, timeout: stage === 3 ? 1 : 0, failed: 0, results: stage === 4 ? [{ protocol: 'TCP', port: 22, status: 'closed' }] : [] };
    } };
    const alerts = new AsmAlertsService(prisma);
    const correlations = new VulnerabilityCorrelationsService(prisma, alerts, new AsmV2EvidenceService(prisma));
    const runner = new DiscoveryRunsService(prisma, {}, portDiscovery, correlations, new RiskPostureService(prisma));
    const findings = new FindingsService(prisma, alerts);
    const first = await runner.run(user, asset.id);
    assert.equal(first.status, 'COMPLETED');
    assert.equal(first.changes.filter(item => item.type === 'PORT_OPENED').length, 1);
    const event = first.changes[0];
    await prisma.asmExposureChange.createMany({ data: [{ tenantId, assetId: asset.id, runId: first.id, type: event.type, entityKey: event.entityKey }], skipDuplicates: true });
    assert.equal((await prisma.asmExposureChange.count({ where: { runId: first.id } })), first.changes.length);
    const second = await runner.run(user, asset.id);
    assert.equal(second.changes.filter(item => item.type === 'PORT_OPENED').length, 1);
    assert.equal(second.changes.filter(item => item.type === 'VULNERABILITY_CONFIRMED').length, 1);
    const correlatedAlert = await prisma.alert.findFirst({ where: { tenantId, assetId: asset.id, source: 'ASM' } });
    assert.ok(correlatedAlert?.changeEventId);
    assert.equal((await findings.risk(user, asset.id)).high, 1);
    const partial = await runner.run(user, asset.id);
    assert.equal(partial.status, 'PARTIAL');
    assert.equal(partial.changes.filter(item => item.type.endsWith('NOT_OBSERVED') || item.type.endsWith('STALE')).length, 0);
    assert.equal((await findings.risk(user, asset.id)).high, 1);
    const fourth = await runner.run(user, asset.id);
    assert.equal(fourth.changes.filter(item => item.type === 'PORT_NOT_OBSERVED').length, 1);
    assert.equal(fourth.changes.filter(item => item.type === 'VULNERABILITY_STALE').length, 1);
    assert.equal((await findings.risk(user, asset.id)).open, 0);
    assert.equal((await prisma.assetFinding.findFirst({ where: { tenantId, assetId: asset.id, source: 'PORT_DISCOVERY' } })).status, 'RESOLVED');
    assert.equal((await prisma.assetPortService.count({ where: { tenantId, assetId: asset.id } })), 2);
    await assert.rejects(() => runner.detail({ ...user, tenantId: 'foreign' }, asset.id, first.id), { status: 404 });
    let release; let entered;
    const waiting = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    portDiscovery.discover = async () => { entered(); await waiting; return { target: asset.value, scanned: 1, open: 0, closed: 1, timeout: 0, failed: 0, results: [] }; };
    const underway = runner.run(user, asset.id);
    await started;
    await assert.rejects(() => runner.run(user, asset.id), { status: 409 });
    release();
    await underway;
    await prisma.user.create({ data: { name: 'Run QA admin', email: `run-qa-${marker}@example.test`, passwordHash: 'unused', role: 'ADMIN', tenantId } });
    await runner.updateSchedule(user, asset.id, true, 60);
    await prisma.asmDiscoverySchedule.update({ where: { assetId: asset.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    const scheduler = new DiscoveryScheduler(prisma, { evaluate: async () => ({ accessible: true }) }, runner);
    const beforeCount = await prisma.asmDiscoveryRun.count({ where: { assetId: asset.id } });
    await scheduler.tick();
    assert.equal((await prisma.asmDiscoveryRun.count({ where: { assetId: asset.id } })), beforeCount + 1);
    assert.equal((await prisma.asmDiscoveryRun.findFirst({ where: { assetId: asset.id }, orderBy: { startedAt: 'desc' } })).source, 'SCHEDULED');
    await scheduler.tick();
    assert.equal((await prisma.asmDiscoveryRun.count({ where: { assetId: asset.id } })), beforeCount + 1);
  } finally { if (tenantId) { await prisma.user.deleteMany({ where: { tenantId } }); await prisma.tenant.delete({ where: { id: tenantId } }); } await prisma.$disconnect(); }
});
