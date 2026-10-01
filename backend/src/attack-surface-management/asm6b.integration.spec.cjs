const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { AlertBackfillService } = require('../../dist/src/attack-surface-management/alert-backfill.service');
const { RiskPostureService } = require('../../dist/src/attack-surface-management/risk-posture.service');

const finding = (tenantId, assetId, sourceKey, severity, status = 'OPEN') => ({ tenantId, assetId, title: sourceKey, description: sourceKey, type: 'QA', source: 'MANUAL', sourceKey, severity, status });

test('historical backfill is eligible, idempotent, tenant-scoped and preserves existing alert state', { timeout: 60000 }, async () => {
  const prisma = new PrismaClient(); const marker = randomUUID(); const tenants = [];
  try {
    for (const suffix of ['a', 'b']) tenants.push(await prisma.tenant.create({ data: { name: `ASM6b ${suffix} ${marker}`, slug: `asm6b-${suffix}-${marker}` } }));
    const [a, b] = tenants;
    const assetA = await prisma.asset.create({ data: { tenantId: a.id, name: 'A', type: 'IP_ADDRESS', value: '192.0.2.10' } });
    const assetB = await prisma.asset.create({ data: { tenantId: b.id, name: 'B', type: 'IP_ADDRESS', value: '192.0.2.11' } });
    const high = await prisma.assetFinding.create({ data: finding(a.id, assetA.id, 'high', 'HIGH') });
    const existing = await prisma.assetFinding.create({ data: finding(a.id, assetA.id, 'existing', 'CRITICAL') });
    await prisma.alert.create({ data: { tenantId: a.id, assetId: assetA.id, source: 'ASM', sourceKey: `finding:${existing.id}`, title: 'Existing', description: 'Existing', severity: 'CRITICAL', status: 'ACKNOWLEDGED' } });
    await prisma.assetFinding.create({ data: finding(a.id, assetA.id, 'low', 'LOW') });
    await prisma.assetFinding.create({ data: finding(a.id, assetA.id, 'resolved', 'HIGH', 'RESOLVED') });
    await prisma.assetFinding.create({ data: finding(b.id, assetB.id, 'foreign', 'HIGH') });
    const service = new AlertBackfillService(prisma); const user = { sub: 'qa', role: 'ADMIN', tenantId: a.id };
    const first = await service.run(user); assert.equal(first.created, 1); assert.equal(first.reused, 1); assert.equal(first.skipped, 1);
    const second = await service.run(user); assert.equal(second.created, 0); assert.equal(second.reused, 2);
    const alerts = await prisma.alert.findMany({ where: { tenantId: a.id, source: 'ASM' } }); assert.equal(alerts.length, 2);
    assert.equal(alerts.find(item => item.sourceKey === `finding:${high.id}`).findingId, high.id);
    assert.equal(alerts.find(item => item.sourceKey === `finding:${existing.id}`).status, 'ACKNOWLEDGED');
    assert.equal(await prisma.alert.count({ where: { tenantId: b.id } }), 0);
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: a.id, action: 'ASM_ALERT_CREATED' } }); assert.equal(audit.metadata.origin, 'HISTORICAL_BACKFILL');
    await assert.rejects(() => service.run({ ...user, role: 'SUPER_ADMIN' }), { status: 400 });
  } finally { for (const tenant of tenants) await prisma.tenant.delete({ where: { id: tenant.id } }); await prisma.$disconnect(); }
});

test('risk snapshots persist baseline, trends, significant increase and run idempotency', { timeout: 60000 }, async () => {
  const prisma = new PrismaClient(); const marker = randomUUID(); let tenant;
  try {
    tenant = await prisma.tenant.create({ data: { name: `ASM6b risk ${marker}`, slug: `asm6b-risk-${marker}` } });
    const asset = await prisma.asset.create({ data: { tenantId: tenant.id, name: 'Risk', type: 'IP_ADDRESS', value: '192.0.2.12' } });
    const service = new RiskPostureService(prisma);
    const low = await prisma.assetFinding.create({ data: finding(tenant.id, asset.id, 'low', 'LOW') });
    await prisma.assetFinding.create({ data: finding(tenant.id, asset.id, 'medium', 'MEDIUM') });
    async function capture() {
      const run = await prisma.asmDiscoveryRun.create({ data: { tenantId: tenant.id, assetId: asset.id, source: 'QA', status: 'COMPLETED' } });
      return prisma.$transaction(tx => service.capture(tx, tenant.id, asset.id, run.id, new Date()));
    }
    const first = await capture(); assert.equal(first.score, 3); assert.equal(first.trend, 'BASELINE');
    const second = await capture(); assert.equal(second.score, 3); assert.equal(second.trend, 'UNCHANGED');
    const high = await prisma.assetFinding.create({ data: finding(tenant.id, asset.id, 'high', 'HIGH') });
    const third = await capture(); assert.equal(third.score, 7); assert.equal(third.trend, 'INCREASED');
    await prisma.assetFinding.update({ where: { id: high.id }, data: { status: 'RESOLVED' } });
    const fourth = await capture(); assert.equal(fourth.score, 3); assert.equal(fourth.trend, 'DECREASED');
    await prisma.assetFinding.create({ data: finding(tenant.id, asset.id, 'critical', 'CRITICAL') });
    const fifth = await capture(); assert.equal(fifth.score, 11); assert.equal(fifth.trend, 'INCREASED');
    assert.equal(await prisma.alert.count({ where: { tenantId: tenant.id, riskSnapshotId: { not: null } } }), 0);
    await prisma.assetFinding.create({ data: finding(tenant.id, asset.id, 'high-2', 'HIGH') });
    await prisma.assetFinding.create({ data: finding(tenant.id, asset.id, 'high-3', 'HIGH') });
    const sixth = await capture(); assert.equal(sixth.score, 19); assert.equal(sixth.trend, 'INCREASED');
    await prisma.$transaction(tx => service.capture(tx, tenant.id, asset.id, sixth.runId, new Date()));
    assert.equal(await prisma.asmRiskSnapshot.count({ where: { tenantId: tenant.id } }), 6);
    const alerts = await prisma.alert.findMany({ where: { tenantId: tenant.id, riskSnapshotId: sixth.id } }); assert.equal(alerts.length, 1);
    assert.match(alerts[0].description, /11 to 19/);
    const history = await service.history({ sub: 'qa', role: 'ADMIN', tenantId: tenant.id }, asset.id);
    assert.equal(history.current.id, sixth.id); assert.equal(history.previous.id, fifth.id);
    await assert.rejects(() => service.history({ sub: 'qa', role: 'ADMIN', tenantId: 'other' }, asset.id), { status: 404 });
    assert.ok(low.id);
  } finally { if (tenant) await prisma.tenant.delete({ where: { id: tenant.id } }); await prisma.$disconnect(); }
});
