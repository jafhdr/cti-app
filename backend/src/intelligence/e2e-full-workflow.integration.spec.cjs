require('reflect-metadata');
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const runId = `${Date.now()}-${process.pid}`;
let primaryTenantId, secondaryTenantId, userId;

before(async () => {
  console.log(`\n[E2E] E2E workflow test ${runId}...\n`);
  const pTenant = await prisma.tenant.create({
    data: { name: `E2E Primary ${runId}`, slug: `e2e-primary-${runId}` },
  });
  const sTenant = await prisma.tenant.create({
    data: { name: `E2E Secondary ${runId}`, slug: `e2e-secondary-${runId}` },
  });
  primaryTenantId = pTenant.id;
  secondaryTenantId = sTenant.id;
  const user = await prisma.user.create({
    data: {
      email: `e2e-${runId}@test`,
      name: 'E2E User',
      passwordHash: 'test',
      role: 'ADMIN',
      tenantId: primaryTenantId,
    },
  });
  userId = user.id;
});

after(async () => {
  console.log(`\n[E2E] Cleanup\n`);
  await prisma.tenant.delete({ where: { id: primaryTenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: secondaryTenantId } }).catch(() => {});
  await prisma.$disconnect();
});

test('[E2E] Source → Indicator → Threat Actor → Campaign → Report', async (t) => {
  let sourceId, indicatorId, threatActorId, campaignId, reportId;

  await t.test('Stage 1: Create Intelligence Source', async () => {
    const src = await prisma.intelligenceSource.create({
      data: {
        tenantId: primaryTenantId,
        name: `Source ${runId}`,
        sourceType: 'OPEN_SOURCE',
        reliability: 'A',
        confidence: 90,
        tlp: 'GREEN',
        status: 'ACTIVE',
        createdBy: userId,
      },
    });
    sourceId = src.id;
    assert.equal(src.tenantId, primaryTenantId);
    console.log(`[E2E]   ✓ Source created`);
  });

  await t.test('Stage 2: Create Indicator', async () => {
    const ind = await prisma.indicator.create({
      data: {
        tenantId: primaryTenantId,
        value: `e2e-${runId}.com`,
        type: 'DOMAIN',
        severity: 'HIGH',
        status: 'ACTIVE',
        confidence: 85,
        intelligenceSourceId: sourceId,
      },
    });
    indicatorId = ind.id;
    assert.equal(ind.tenantId, primaryTenantId);
    console.log(`[E2E]   ✓ Indicator created`);
  });

  await t.test('Stage 3: Create Threat Actor', async () => {
    const ent = await prisma.intelligenceEntity.create({
      data: { tenantId: primaryTenantId, type: 'THREAT_ACTOR', name: `Actor ${runId}` },
    });
    const act = await prisma.threatActor.create({
      data: { tenantId: primaryTenantId, entityId: ent.id, status: 'ACTIVE', createdBy: userId },
    });
    threatActorId = act.id;
    assert.equal(act.tenantId, primaryTenantId);
    console.log(`[E2E]   ✓ Threat actor created`);
  });

  await t.test('Stage 4: Create Campaign', async () => {
    const camp = await prisma.campaign.create({
      data: {
        tenantId: primaryTenantId,
        name: `Campaign ${runId}`,
        threatActorId,
        status: 'ACTIVE',
        createdBy: userId,
      },
    });
    campaignId = camp.id;
    await prisma.campaignIndicator.create({
      data: { tenantId: primaryTenantId, campaignId, indicatorId },
    });
    console.log(`[E2E]   ✓ Campaign created and linked`);
  });

  await t.test('Stage 5: Create Report', async () => {
    const rep = await prisma.intelligenceReport.create({
      data: {
        tenantId: primaryTenantId,
        title: `Report ${runId}`,
        summary: `Summary for report ${runId}`,
        content: `Content for report ${runId}`,
        reportType: 'TACTICAL',
        status: 'PUBLISHED',
        tlp: 'GREEN',
      },
    });
    reportId = rep.id;
    await Promise.all([
      prisma.intelligenceReportThreatActor.create({
        data: { reportId, threatActorId, tenantId: primaryTenantId },
      }),
      prisma.intelligenceReportCampaign.create({
        data: { reportId, campaignId, tenantId: primaryTenantId },
      }),
      prisma.intelligenceReportIndicator.create({
        data: { reportId, indicatorId, tenantId: primaryTenantId },
      }),
    ]);
    console.log(`[E2E]   ✓ Report created`);
  });

  await t.test('Verify: Tenant isolation', async () => {
    const entities = await Promise.all([
      prisma.intelligenceSource.findUniqueOrThrow({ where: { id: sourceId } }),
      prisma.indicator.findUniqueOrThrow({ where: { id: indicatorId } }),
      prisma.threatActor.findUniqueOrThrow({ where: { id: threatActorId } }),
      prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
      prisma.intelligenceReport.findFirst({ where: { id: reportId } }),
    ]);
    entities.slice(0, 4).forEach(e => assert.equal(e.tenantId, primaryTenantId));
    assert.equal(entities[4].tenantId, primaryTenantId);
    console.log(`[E2E]   ✓ All entities in primary tenant`);
  });

  await t.test('Verify: Workflow complete', async () => {
    const rept = await prisma.intelligenceReport.findFirst({
      where: { id: reportId },
      include: {
        threatActors: true,
        campaigns: true,
        indicators: true,
      },
    });
    assert.ok(rept);
    assert.equal(rept.threatActors.length, 1);
    assert.equal(rept.campaigns.length, 1);
    assert.equal(rept.indicators.length, 1);
    console.log(`[E2E]   ✓ End-to-end workflow verified`);
  });
});
