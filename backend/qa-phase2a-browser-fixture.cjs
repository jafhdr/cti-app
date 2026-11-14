const { randomBytes } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

async function main() {
  if (!process.env.DATABASE_URL || !/^\/cti_phase2[ab]_qa_/.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error('Disposable Phase 2 QA database required');
  const prisma = new PrismaClient();
  const marker = Date.now().toString();
  const password = randomBytes(18).toString('base64url');
  try {
    const module = await prisma.appModule.upsert({ where: { slug: 'threat-intelligence' }, update: {}, create: { slug: 'threat-intelligence', name: 'QA Threat Intelligence', description: 'Phase 2A browser QA', category: 'CTI', features: { create: [{ key: 'intelligence-hub', name: 'Intelligence Hub' }, { key: 'indicator-management', name: 'Indicator Management' }] } } });
    const subscription = await prisma.subscriptionPackage.create({ data: { name: `Phase 2A QA ${marker}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: { moduleId: module.id } } } });
    const primary = await prisma.tenant.create({ data: { name: `Phase 2A primary ${marker}`, slug: `phase2a-primary-${marker}` } });
    const secondary = await prisma.tenant.create({ data: { name: `Phase 2A secondary ${marker}`, slug: `phase2a-secondary-${marker}` } });
    const users = {};
    for (const [key, tenant, role] of [['admin', primary, 'ADMIN'], ['user', primary, 'USER'], ['otherAdmin', secondary, 'ADMIN']]) {
      const email = `phase2a-${key.toLowerCase()}-${marker}@example.test`;
      const row = await prisma.user.create({ data: { email, name: `Phase 2A ${key}`, passwordHash: await bcrypt.hash(password, 10), role, tenantId: tenant.id } });
      users[key] = { id: row.id, email };
    }
    for (const tenant of [primary, secondary]) {
      await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId: subscription.id, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000) } });
      const tm = await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, isEnabled: true } });
      await prisma.moduleRoleAccess.createMany({ data: ['ADMIN', 'USER'].map(role => ({ tenantModuleId: tm.id, role, isAllowed: true })) });
    }
    for (const user of Object.values(users)) {
      await prisma.userModuleAccess.create({ data: { userId: user.id, tenantId: user === users.otherAdmin ? secondary.id : primary.id, moduleId: module.id, featureKeys: ['intelligence-hub', 'indicator-management'] } });
    }
    const entity = await prisma.intelligenceEntity.create({ data: { tenantId: primary.id, type: 'THREAT_ACTOR', name: `QA Blue Finch ${marker}`, description: 'Synthetic actor for Phase 2A browser verification.' } });
    const actor = await prisma.threatActor.create({ data: { tenantId: primary.id, entityId: entity.id, aliases: ['Blue Finch'], createdBy: users.admin.id } });
    const campaign = await prisma.campaign.create({ data: { tenantId: primary.id, name: `QA Campaign ${marker}`, threatActorId: actor.id, status: 'ACTIVE', createdBy: users.admin.id } });
    const technique = await prisma.mitreTechnique.create({ data: { tenantId: primary.id, externalId: `T-QA-${marker}`, name: 'Synthetic discovery', tactic: 'Discovery', platform: 'Windows' } });
    const stakeholder = await prisma.stakeholder.create({ data: { tenantId: primary.id, name: `QA Stakeholder ${marker}`, scope: 'INTERNAL', category: 'OPERATIONAL', type: 'TEAM', createdById: users.admin.id, updatedById: users.admin.id } });
    const pir = await prisma.pir.create({ data: { tenantId: primary.id, stakeholderId: stakeholder.id, reference: `PIR-${marker}`, title: 'QA behavior evidence', question: 'Which technique was observed?', createdById: users.admin.id, updatedById: users.admin.id } });
    const sir = await prisma.sir.create({ data: { tenantId: primary.id, pirId: pir.id, reference: `SIR-${marker}`, title: 'QA source report', question: 'Was the behavior observed?', createdById: users.admin.id, updatedById: users.admin.id } });
    const evidence = await prisma.sirEvidence.create({ data: { tenantId: primary.id, sirId: sir.id, threatActorId: actor.id, relevanceNote: 'Synthetic source-backed technique evidence.', createdById: users.admin.id } });
    writeFileSync('../.omo/evidence/sicti-phase2a-browser-fixture.json', JSON.stringify({ baseUrl: 'http://localhost:33010', email: users.admin.email, userEmail: users.user.email, otherEmail: users.otherAdmin.email, password, actorId: actor.id, campaignId: campaign.id, techniqueId: technique.id, evidenceId: evidence.id, tenantId: primary.id, otherTenantId: secondary.id }, null, 2), { mode: 0o600 });
    process.stdout.write(JSON.stringify({ fixture: 'created', actorId: actor.id, campaignId: campaign.id, tenantCount: 2, userCount: 3 }));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : 'Fixture failed'}\n`); process.exitCode = 1; });
