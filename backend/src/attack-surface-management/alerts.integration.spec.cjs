const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { AsmAlertsService } = require('../../dist/src/attack-surface-management/alerts.service');
const { CasesService } = require('../../dist/src/cases/cases.service');

test('ASM alert lifecycle and Case provenance remain tenant scoped', { timeout: 60000 }, async () => {
  const prisma = new PrismaClient();
  const marker = randomUUID();
  let tenantId;
  let userId;
  let caseId;
  try {
    const tenant = await prisma.tenant.create({ data: { name: `ASM Alert QA ${marker}`, slug: `asm-alert-qa-${marker}` } });
    tenantId = tenant.id;
    const other = await prisma.tenant.create({ data: { name: `ASM Other QA ${marker}`, slug: `asm-other-qa-${marker}` } });
    const user = await prisma.user.create({ data: { email: `asm-qa-${marker}@example.invalid`, name: 'ASM QA', passwordHash: 'not-a-login', role: 'ADMIN', tenantId } });
    userId = user.id;
    const actor = { sub: userId, role: 'ADMIN', tenantId };
    const asset = await prisma.asset.create({ data: { tenantId, name: 'QA IP', type: 'IP_ADDRESS', value: '192.0.2.57' } });
    const finding = await prisma.assetFinding.create({ data: { tenantId, assetId: asset.id, title: 'Confirmed exposure', description: 'Observed exposure', type: 'VULNERABILITY', severity: 'HIGH', source: 'QA', sourceKey: marker } });
    const alerts = new AsmAlertsService(prisma);
    const cases = new CasesService(prisma);
    const input = { tenantId, assetId: asset.id, findingId: finding.id, sourceKey: `finding:${finding.id}`, title: finding.title, description: finding.description, severity: 'HIGH' };
    const first = await alerts.observe(input);
    const repeated = await alerts.observe(input);
    assert.equal(repeated.id, first.id);
    assert.equal((await alerts.list(actor, asset.id)).length, 1);
    assert.equal((await alerts.acknowledge(actor, asset.id, first.id)).status, 'ACKNOWLEDGED');
    const acknowledged = await prisma.alert.findUnique({ where: { id: first.id } });
    assert.equal(acknowledged.acknowledgedBy, userId);
    assert.ok(acknowledged.acknowledgedAt);
    const created = await cases.createFromAsmAlert(actor, first.id, {});
    caseId = created.id;
    assert.equal((await cases.createFromAsmAlert(actor, first.id, {})).id, caseId);
    assert.equal((await cases.createFromAsmFinding(actor, finding.id, {})).id, caseId);
    const secondFinding = await prisma.assetFinding.create({ data: { tenantId, assetId: asset.id, title: 'Second exposure', description: 'Another observation', type: 'EXPOSURE', severity: 'MEDIUM', source: 'QA', sourceKey: `second:${marker}` } });
    const secondAlert = await alerts.observe({ tenantId, assetId: asset.id, findingId: secondFinding.id, sourceKey: `finding:${secondFinding.id}`, title: secondFinding.title, description: secondFinding.description, severity: 'MEDIUM' });
    assert.equal((await cases.linkAsmAlert(actor, caseId, secondAlert.id)).id, caseId);
    const detail = await cases.getDetail(actor, caseId);
    assert.equal(detail.alerts.length, 2);
    assert.ok(detail.alerts.some(item => item.asset?.value === '192.0.2.57' && item.finding?.id === finding.id));
    await assert.rejects(() => alerts.detail({ ...actor, tenantId: other.id }, asset.id, first.id), { status: 404 });
    await assert.rejects(() => cases.createFromAsmAlert({ ...actor, tenantId: other.id }, first.id, {}), { status: 404 });
    await alerts.resolve(actor, asset.id, first.id);
    await alerts.observe(input);
    assert.equal((await alerts.detail(actor, asset.id, first.id)).status, 'CLOSED');
    await prisma.tenant.delete({ where: { id: other.id } });
  } finally {
    if (caseId) await prisma.case.delete({ where: { id: caseId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  }
});
