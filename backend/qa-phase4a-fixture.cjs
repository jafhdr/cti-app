const { randomBytes, randomUUID } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

async function main() {
  if (new URL(process.env.DATABASE_URL || 'postgresql://invalid@localhost/invalid').pathname !== '/cti_phase4a_qa_20261111') throw new Error('Phase 4A QA database required');
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const password = randomBytes(24).toString('base64url');
  try {
    const ti = await prisma.appModule.upsert({ where: { slug: 'threat-intelligence' }, update: {}, create: { slug: 'threat-intelligence', name: 'Threat Intelligence', description: 'Synthetic Phase 4A QA', category: 'CTI', features: { create: { key: 'intelligence-hub', name: 'Intelligence Hub' } } } });
    const cases = await prisma.appModule.upsert({ where: { slug: 'case-management' }, update: {}, create: { slug: 'case-management', name: 'Case Management', description: 'Synthetic Phase 4A QA', category: 'CTI', features: { create: { key: 'case-workflow', name: 'Case Workflow' } } } });
    const pkg = await prisma.subscriptionPackage.create({ data: { name: `Monitoring QA ${marker}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: [{ moduleId: ti.id }, { moduleId: cases.id }] } } });
    const result = {};
    for (const label of ['own', 'foreign']) {
      const tenant = await prisma.tenant.create({ data: { name: `Monitoring QA ${label}`, slug: `monitoring-${label}-${marker}` } });
      await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId: pkg.id, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86_400_000) } });
      for (const module of [ti, cases]) await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
      const users = {};
      for (const [name, role] of [['admin', 'ADMIN'], ['reader', 'USER']]) {
        const user = await prisma.user.create({ data: { tenantId: tenant.id, role, name: `QA ${label} ${name}`, email: `monitor-${label}-${name}-${marker}@example.test`, passwordHash: await bcrypt.hash(password, 10) } });
        await prisma.userModuleAccess.createMany({ data: [{ userId: user.id, tenantId: tenant.id, moduleId: ti.id, featureKeys: ['intelligence-hub'] }, { userId: user.id, tenantId: tenant.id, moduleId: cases.id, featureKeys: ['case-workflow'] }] });
        users[name] = { id: user.id, email: user.email };
      }
      const source = await prisma.intelligenceSource.create({ data: { tenantId: tenant.id, name: `QA monitoring source ${marker}`, sourceType: 'COMMUNITY', provider: 'QA fixture', tlp: 'AMBER', status: 'ACTIVE', createdBy: users.admin.id } });
      const asset = await prisma.asset.create({ data: { tenantId: tenant.id, name: 'Corporate domain', type: 'DOMAIN', value: `${label}-${marker}.test` } });
      result[label] = { tenantId: tenant.id, users, sourceId: source.id, assetId: asset.id, domain: asset.value };
    }
    const path = '../.omo/evidence/sicti-phase4a-qa-fixture.json';
    mkdirSync('../.omo/evidence', { recursive: true });
    writeFileSync(path, JSON.stringify({ ...result, password }), { mode: 0o600 });
    console.log('Synthetic Phase 4A QA fixture ready');
  } finally { await prisma.$disconnect(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
