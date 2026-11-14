const { randomBytes, randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

async function main() {
  if (!/^\/cti_soar_qa_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL || '').pathname)) throw new Error('Disposable SOAR QA database required');
  const prisma = new PrismaClient();
  const marker = randomUUID();
  try {
    const module = await prisma.appModule.upsert({ where: { slug: 'threat-intelligence' }, update: {}, create: { slug: 'threat-intelligence', name: 'Threat Intelligence', description: 'Synthetic SOAR QA', category: 'CTI', features: { create: { key: 'indicator-management', name: 'Indicator Management' } } } });
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `SOAR QA ${marker}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: { moduleId: module.id } } } });
    async function tenant(label) {
      const row = await prisma.tenant.create({ data: { name: `SOAR QA ${label}`, slug: `soar-${label}-${marker}` } });
      await prisma.tenantSubscription.create({ data: { tenantId: row.id, packageId: pkg.id, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      await prisma.tenantModule.create({ data: { tenantId: row.id, moduleId: module.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
      return row;
    }
    const own = await tenant('own');
    const foreign = await tenant('foreign');
    const password = randomBytes(18).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 10);
    async function account(tenantId, role, label) {
      const email = `${label}-${marker}@example.test`;
      const user = await prisma.user.create({ data: { tenantId, role, name: label, email, passwordHash } });
      await prisma.userModuleAccess.create({ data: { userId: user.id, tenantId, moduleId: module.id, featureKeys: ['indicator-management'] } });
      return { id: user.id, email };
    }
    const initiator = await account(own.id, 'ADMIN', 'initiator');
    const approver = await account(own.id, 'ADMIN', 'approver');
    const reader = await account(own.id, 'USER', 'reader');
    const outsider = await account(foreign.id, 'ADMIN', 'outsider');
    const domain = `malicious-${marker}.example.test`;
    const indicator = await prisma.indicator.create({ data: { tenantId: own.id, type: 'DOMAIN', value: domain, confidence: 90, severity: 'HIGH', status: 'ACTIVE' } });
    const source = await prisma.intelligenceSource.create({ data: { tenantId: own.id, name: 'Synthetic URLhaus QA', sourceType: 'COMMUNITY', status: 'ACTIVE', provider: 'URLhaus', createdBy: initiator.id } });
    const feed = await prisma.indicatorSourceObservation.create({ data: { tenantId: own.id, indicatorId: indicator.id, intelligenceSourceId: source.id, sourceKey: `feed-${marker}`, sourceName: 'Synthetic URLhaus QA', provider: 'URLhaus', origin: 'FEED' } });
    const event = await prisma.threatEvent.create({ data: { tenantId: own.id, sourceKind: 'SYNTHETIC_INTERNAL', sourceKey: `event-${marker}`, sourceName: 'Synthetic SOC', observableType: 'DOMAIN', observableValue: domain, ioaKind: 'DNS_QUERY', provenance: { channel: 'SYNTHETIC_QA' }, confidence: 90, tlp: 'AMBER', observedAt: new Date(), processingStatus: 'MATCHED' } });
    const caseRow = await prisma.case.create({ data: { tenantId: own.id, caseNumber: `SOAR-QA-${marker.slice(0, 8)}`, title: 'Synthetic malicious domain investigation', createdBy: initiator.id } });
    const alert = await prisma.alert.create({ data: { tenantId: own.id, source: 'CORRELATION', sourceKey: `EVENT:${event.id}`, title: `Threat correlation: ${domain}`, severity: 'HIGH', caseId: caseRow.id } });
    await prisma.threatCorrelation.create({ data: { tenantId: own.id, eventId: event.id, indicatorId: indicator.id, feedObservationId: feed.id, alertId: alert.id, score: 85, reason: 'EXACT_DOMAIN_MATCH', evidence: { provider: 'URLhaus', ioaKind: 'DNS_QUERY', feedObservedAt: new Date().toISOString() }, matchedAt: new Date(), alertVisibleAt: new Date() } });
    const fixture = { tenantId: own.id, otherTenantId: foreign.id, initiator, approver, reader, outsider, password, alertId: alert.id, caseId: caseRow.id, domain };
    writeFileSync('../.omo/evidence/sicti-phase3b-qa-fixture.json', JSON.stringify(fixture), { mode: 0o600 });
    process.stdout.write('Synthetic Phase 3B QA fixture ready\n');
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'QA fixture failed'}\n`); process.exitCode = 1; });
