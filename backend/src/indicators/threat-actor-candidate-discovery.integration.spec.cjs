require('reflect-metadata');

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { JwtService } = require('@nestjs/jwt');
const { NestFactory } = require('@nestjs/core');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require('../../dist/src/app.module.js');

const prisma = new PrismaClient();
const runId = `${Date.now()}-${process.pid}`;
const tenantIds = [];
let app;
let baseUrl;
let accessToken;
let packageId;
let primaryTenantId;
let secondaryTenantId;
let userId;

async function createActor(tenantId, suffix, status = 'ACTIVE', aliases = []) {
  const entity = await prisma.intelligenceEntity.create({
    data: { tenantId, type: 'THREAT_ACTOR', name: `Discovery actor ${runId}-${suffix}` },
  });
  return prisma.threatActor.create({
    data: { tenantId, entityId: entity.id, status, aliases, createdBy: userId },
  });
}

async function createIndicator(tenantId, suffix, data = {}) {
  return prisma.indicator.create({
    data: { tenantId, value: `discovery-${runId}-${suffix}.example`, type: 'DOMAIN', severity: 'MEDIUM', ...data },
  });
}

async function linkCampaign(actor, indicator, suffix) {
  const campaign = await prisma.campaign.create({
    data: { tenantId: indicator.tenantId, name: `Discovery campaign ${runId}-${suffix}`, threatActorId: actor.id, createdBy: userId },
  });
  await prisma.campaignIndicator.create({ data: { tenantId: indicator.tenantId, campaignId: campaign.id, indicatorId: indicator.id } });
  return campaign;
}

async function linkReport(actor, indicator, suffix) {
  const report = await prisma.intelligenceReport.create({
    data: {
      tenantId: indicator.tenantId, title: `Discovery report ${runId}-${suffix}`, summary: 'Structured discovery test',
      content: 'Structured discovery test', reportType: 'TECHNICAL', status: 'PUBLISHED',
    },
  });
  await prisma.intelligenceReportThreatActor.create({ data: { tenantId: indicator.tenantId, reportId: report.id, threatActorId: actor.id } });
  await prisma.intelligenceReportIndicator.create({ data: { tenantId: indicator.tenantId, reportId: report.id, indicatorId: indicator.id } });
  return report;
}

function discover(indicatorId) {
  return fetch(`${baseUrl}/indicators/${indicatorId}/discover-threat-actors`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}` },
  });
}

function confirmAttribution(indicatorId, threatActorId) {
  return fetch(`${baseUrl}/indicators/${indicatorId}/attribute-threat-actor`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ threatActorId }),
  });
}

before(async () => {
  const threatModule = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'threat-intelligence' } });
  const subscriptionPackage = await prisma.subscriptionPackage.create({
    data: {
      name: `Discovery QA ${runId}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0,
      modules: { create: { moduleId: threatModule.id } },
    },
  });
  packageId = subscriptionPackage.id;
  const primary = await prisma.tenant.create({ data: { name: `Discovery primary ${runId}`, slug: `discovery-primary-${runId}` } });
  const secondary = await prisma.tenant.create({ data: { name: `Discovery secondary ${runId}`, slug: `discovery-secondary-${runId}` } });
  primaryTenantId = primary.id;
  secondaryTenantId = secondary.id;
  tenantIds.push(primaryTenantId, secondaryTenantId);
  const user = await prisma.user.create({
    data: { email: `discovery-${runId}@example.test`, name: 'Discovery QA Admin', passwordHash: 'integration-test-only', role: 'ADMIN', tenantId: primaryTenantId },
  });
  userId = user.id;
  await prisma.tenantSubscription.create({
    data: { tenantId: primaryTenantId, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 60_000) },
  });
  const tenantModule = await prisma.tenantModule.create({ data: { tenantId: primaryTenantId, moduleId: threatModule.id, isEnabled: true } });
  await prisma.moduleRoleAccess.create({ data: { tenantModuleId: tenantModule.id, role: 'ADMIN', isAllowed: true } });
  await prisma.userModuleAccess.create({ data: { userId, tenantId: primaryTenantId, moduleId: threatModule.id } });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  accessToken = await new JwtService().signAsync(
    { sub: userId, tenantId: primaryTenantId, role: 'ADMIN' },
    { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' },
  );
});

after(async () => {
  if (app) await app.close();
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  if (tenantIds.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  if (packageId) await prisma.subscriptionPackage.deleteMany({ where: { id: packageId } });
  await prisma.$disconnect();
});

test('Given an exact linked indicator, when discovery is posted, then it returns the actor without changing attribution', async () => {
  const actor = await createActor(primaryTenantId, 'exact');
  const indicator = await createIndicator(primaryTenantId, 'exact', { intelligenceEntityId: actor.entityId });
  const response = await discover(indicator.id);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.status, 'CANDIDATES');
  assert.deepEqual(body.candidates[0].evidence, [{ type: 'EXACT_INDICATOR', value: indicator.value }]);
  assert.equal((await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } })).intelligenceEntityId, actor.entityId);
});

test('Given campaign and report relations, when discovery is posted, then candidates are score-ordered', async () => {
  const indicator = await createIndicator(primaryTenantId, 'relations');
  const campaignActor = await createActor(primaryTenantId, 'campaign');
  const reportActor = await createActor(primaryTenantId, 'report');
  const campaign = await linkCampaign(campaignActor, indicator, 'relations');
  const report = await linkReport(reportActor, indicator, 'relations');
  const body = await (await discover(indicator.id)).json();
  assert.deepEqual(body.candidates.map(candidate => candidate.threatActorId), [campaignActor.id, reportActor.id]);
  assert.deepEqual(body.candidates.map(candidate => candidate.evidence[0]), [
    { type: 'CAMPAIGN', value: campaign.id }, { type: 'INTELLIGENCE_REPORT', value: report.id },
  ]);
  assert.equal((await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } })).intelligenceEntityId, null);
});

test('Given no structured relation, when discovery is posted, then it returns NO_MATCH', async () => {
  const indicator = await createIndicator(primaryTenantId, 'none');
  assert.deepEqual(await (await discover(indicator.id)).json(), { status: 'NO_MATCH', indicatorId: indicator.id, candidates: [], overflow: false });
});

test('Given cross-tenant and inactive actors, when discovery is posted, then neither appears', async () => {
  const indicator = await createIndicator(primaryTenantId, 'filtered');
  const inactive = await createActor(primaryTenantId, 'inactive', 'INACTIVE');
  await linkCampaign(inactive, indicator, 'inactive');
  const foreignIndicator = await createIndicator(secondaryTenantId, 'foreign');
  const foreignActor = await createActor(secondaryTenantId, 'foreign');
  await linkCampaign(foreignActor, foreignIndicator, 'foreign');
  assert.deepEqual(await (await discover(indicator.id)).json(), { status: 'NO_MATCH', indicatorId: indicator.id, candidates: [], overflow: false });
});

test('Given duplicate exact support and a substring collision, when discovery is posted, then exact scores once and substring does not match', async () => {
  const exactActor = await createActor(primaryTenantId, 'dedup', 'ACTIVE', ['DUPLICATE.EXAMPLE']);
  const exactIndicator = await createIndicator(primaryTenantId, 'dedup', { value: 'duplicate.example', tags: ['duplicate.example'], intelligenceEntityId: exactActor.entityId });
  const substringActor = await createActor(primaryTenantId, 'substring', 'ACTIVE', ['duplicate']);
  await createIndicator(primaryTenantId, 'substring-related', { value: 'not-duplicate.example', intelligenceEntityId: substringActor.entityId });
  const body = await (await discover(exactIndicator.id)).json();
  assert.equal(body.candidates.length, 1);
  assert.equal(body.candidates[0].threatActorId, exactActor.id);
  assert.equal(body.candidates[0].score, 70);
  assert.equal(body.candidates[0].evidence.length, 1);
});

test('Given another tenant indicator, when discovery is posted, then the endpoint rejects access', async () => {
  const indicator = await createIndicator(secondaryTenantId, 'forbidden');
  assert.equal((await discover(indicator.id)).status, 403);
});

test('Given Actor A is selected from multiple valid candidates, when attribution is confirmed, then Actor A and its audit are persisted', async () => {
  const indicator = await createIndicator(primaryTenantId, 'confirm-selected');
  const actorA = await createActor(primaryTenantId, 'confirm-a');
  const actorB = await createActor(primaryTenantId, 'confirm-b');
  await linkCampaign(actorA, indicator, 'confirm-a');
  await linkReport(actorB, indicator, 'confirm-b');

  const response = await confirmAttribution(indicator.id, actorA.id);
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.status, 'MATCH');
  assert.equal(body.candidate.id, actorA.id);
  assert.equal((await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } })).intelligenceEntityId, actorA.entityId);
  assert.ok(await prisma.auditLog.findFirst({ where: { tenantId: primaryTenantId, action: 'INDICATOR_THREAT_ACTOR_ATTRIBUTED', metadata: { path: ['threatActorId'], equals: actorA.id } } }));
});

test('Given a discovered candidate becomes inactive, when attribution is confirmed, then no relation is written', async () => {
  const indicator = await createIndicator(primaryTenantId, 'confirm-inactive');
  const actor = await createActor(primaryTenantId, 'confirm-inactive');
  await linkCampaign(actor, indicator, 'confirm-inactive');
  await prisma.threatActor.update({ where: { id: actor.id }, data: { status: 'INACTIVE' } });

  const body = await (await confirmAttribution(indicator.id, actor.id)).json();

  assert.equal(body.status, 'NO_MATCH');
  assert.equal((await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } })).intelligenceEntityId, null);
});

test('Given a candidate belongs to another tenant, when attribution is confirmed, then no relation is written', async () => {
  const indicator = await createIndicator(primaryTenantId, 'confirm-foreign');
  const foreignActor = await createActor(secondaryTenantId, 'confirm-foreign');

  const body = await (await confirmAttribution(indicator.id, foreignActor.id)).json();

  assert.equal(body.status, 'NO_MATCH');
  assert.equal((await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } })).intelligenceEntityId, null);
});
