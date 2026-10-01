const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { DiscoveryRunsService } = require('../../dist/src/attack-surface-management/discovery-runs.service');
const { VulnerabilityCorrelationsService } = require('../../dist/src/attack-surface-management/vulnerability-correlations.service');
const { AsmAlertsService } = require('../../dist/src/attack-surface-management/alerts.service');
const { RiskPostureService } = require('../../dist/src/attack-surface-management/risk-posture.service');

test('domain runs report new IP and DNS change without false loss on provider failure', { timeout: 60000 }, async () => {
  const prisma = new PrismaClient(); const marker = randomUUID(); let tenantId;
  try {
    const tenant = await prisma.tenant.create({ data: { name: `DNS QA ${marker}`, slug: `dns-qa-${marker}` } }); tenantId = tenant.id;
    const user = { sub: 'qa', role: 'ADMIN', tenantId };
    const root = await prisma.asset.create({ data: { tenantId, name: 'example.test', type: 'DOMAIN', value: 'example.test' } });
    let stage = 0;
    const discovery = { runDiscovery: async () => {
      stage++;
      if (stage === 3) return { rootDomain: root.value, discovered: 0, created: 0, updated: 0, skipped: 0, failed: 1, providers: ['DNS'], errors: ['DNS timeout'] };
      const value = stage === 1 ? '192.0.2.1' : '192.0.2.2';
      const ip = await prisma.asset.upsert({ where: { tenantId_type_value: { tenantId, type: 'IP_ADDRESS', value } }, create: { tenantId, name: value, type: 'IP_ADDRESS', value }, update: { lastSeenAt: new Date() } });
      await prisma.assetRelationship.upsert({ where: { tenantId_sourceAssetId_targetAssetId_type_source: { tenantId, sourceAssetId: root.id, targetAssetId: ip.id, type: 'RESOLVES_TO', source: 'DNS_RESOLUTION' } }, create: { tenantId, rootAssetId: root.id, sourceAssetId: root.id, targetAssetId: ip.id, type: 'RESOLVES_TO', source: 'DNS_RESOLUTION' }, update: { lastSeenAt: new Date() } });
      return { rootDomain: root.value, discovered: 1, created: 1, updated: 0, skipped: 0, failed: 0, providers: ['DNS'], errors: [] };
    } };
    const ports = { discover: async () => ({ target: 'ip', scanned: 0, open: 0, closed: 0, timeout: 0, failed: 0, results: [] }) };
    const runner = new DiscoveryRunsService(prisma, discovery, ports, new VulnerabilityCorrelationsService(prisma, new AsmAlertsService(prisma)), new RiskPostureService(prisma));
    const first = await runner.run(user, root.id);
    assert.equal(first.changes.filter(item => item.type === 'IP_DISCOVERED').length, 1);
    const second = await runner.run(user, root.id);
    assert.equal(second.changes.filter(item => item.type === 'IP_DISCOVERED').length, 1);
    assert.equal(second.changes.filter(item => item.type === 'DNS_CHANGED').length, 1);
    assert.equal(second.changes.filter(item => item.type === 'IP_NOT_OBSERVED').length, 1);
    const partial = await runner.run(user, root.id);
    assert.equal(partial.status, 'PARTIAL');
    assert.equal(partial.changes.filter(item => item.type.endsWith('NOT_OBSERVED')).length, 0);
    const userDns = await runner.run({ ...user, role: 'USER' }, root.id, undefined, 'MANUAL', false);
    assert.equal(userDns.status, 'PARTIAL');
    assert.ok(userDns.legacySummary);
  } finally { if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }); await prisma.$disconnect(); }
});
