const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

async function main() {
  if (!/^\/cti_corr_qa_/.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error('QA database required');
  const db = new PrismaClient();
  try {
    const marker = randomUUID().slice(0, 8);
    const module = await db.appModule.findUniqueOrThrow({ where: { slug: 'threat-intelligence' } });
    const pkg = await db.subscriptionPackage.create({ data: { name: `Correlation browser ${marker}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: { moduleId: module.id } } } });
    const tenant = await db.tenant.create({ data: { name: `Correlation browser ${marker}`, slug: `correlation-browser-${marker}` } });
    await db.tenantSubscription.create({ data: { tenantId: tenant.id, packageId: pkg.id, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
    await db.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    const email = `correlation-${marker}@example.test`;
    const password = `QaCorrelation-${marker}!`;
    const user = await db.user.create({ data: { tenantId: tenant.id, role: 'ADMIN', name: 'Correlation QA analyst', email, passwordHash: await bcrypt.hash(password, 10) } });
    await db.userModuleAccess.create({ data: { userId: user.id, tenantId: tenant.id, moduleId: module.id, featureKeys: ['indicator-management'] } });
    const source = await db.intelligenceSource.create({ data: { tenantId: tenant.id, name: `URLhaus ${marker}`, sourceType: 'COMMUNITY', status: 'ACTIVE', provider: 'URLhaus', createdBy: 'qa' } });
    const value = `malicious-${marker}.example`;
    const indicator = await db.indicator.create({ data: { tenantId: tenant.id, type: 'DOMAIN', value, confidence: 90, severity: 'HIGH', status: 'ACTIVE' } });
    await db.indicatorSourceObservation.create({ data: { tenantId: tenant.id, indicatorId: indicator.id, intelligenceSourceId: source.id, sourceKey: source.id, sourceName: 'URLhaus', provider: 'URLhaus', origin: 'FEED' } });
    process.stdout.write(JSON.stringify({ email, password, value, tenantId: tenant.id, indicatorId: indicator.id }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
