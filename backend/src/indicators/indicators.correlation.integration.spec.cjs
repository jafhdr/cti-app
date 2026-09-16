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

async function createActor(tenantId, suffix, status = 'ACTIVE') {
  const entity = await prisma.intelligenceEntity.create({
    data: {
      tenantId,
      type: 'THREAT_ACTOR',
      name: `Correlation actor ${runId}-${suffix}`,
    },
  });
  return prisma.threatActor.create({
    data: {
      tenantId,
      entityId: entity.id,
      status,
      createdBy: userId,
    },
  });
}

async function createIndicator(tenantId, suffix) {
  return prisma.indicator.create({
    data: {
      tenantId,
      value: `correlation-${runId}-${suffix}.example`,
      type: 'DOMAIN',
      severity: 'MEDIUM',
    },
  });
}

async function linkThroughCampaign(tenantId, actorId, indicatorId, suffix) {
  const campaign = await prisma.campaign.create({
    data: {
      tenantId,
      name: `Correlation campaign ${runId}-${suffix}`,
      threatActorId: actorId,
      createdBy: userId,
    },
  });
  await prisma.campaignIndicator.create({
    data: { tenantId, campaignId: campaign.id, indicatorId },
  });
}

async function correlate(indicatorId) {
  return fetch(`${baseUrl}/indicators/${indicatorId}/correlate-threat-actor`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

before(async () => {
  const threatModule = await prisma.appModule.findUniqueOrThrow({
    where: { slug: 'threat-intelligence' },
  });
  const subscriptionPackage = await prisma.subscriptionPackage.create({
    data: {
      name: `Correlation QA ${runId}`,
      type: 'PREDEFINED',
      billingCycle: 'MONTHLY',
      priceMonthly: 0,
      modules: { create: { moduleId: threatModule.id } },
    },
  });
  packageId = subscriptionPackage.id;

  const primaryTenant = await prisma.tenant.create({
    data: { name: `Correlation primary ${runId}`, slug: `correlation-primary-${runId}` },
  });
  const secondaryTenant = await prisma.tenant.create({
    data: { name: `Correlation secondary ${runId}`, slug: `correlation-secondary-${runId}` },
  });
  primaryTenantId = primaryTenant.id;
  secondaryTenantId = secondaryTenant.id;
  tenantIds.push(primaryTenantId, secondaryTenantId);

  const user = await prisma.user.create({
    data: {
      email: `correlation-${runId}@example.test`,
      name: 'Correlation QA Admin',
      passwordHash: 'integration-test-only',
      role: 'ADMIN',
      tenantId: primaryTenantId,
    },
  });
  userId = user.id;
  await prisma.tenantSubscription.create({
    data: {
      tenantId: primaryTenantId,
      packageId,
      billingCycle: 'MONTHLY',
      priceMonthly: 0,
      status: 'ACTIVE',
      renewalAt: new Date(Date.now() + 60_000),
    },
  });
  const tenantModule = await prisma.tenantModule.create({ data: { tenantId: primaryTenantId, moduleId: threatModule.id, isEnabled: true } });
  await prisma.moduleRoleAccess.create({ data: { tenantModuleId: tenantModule.id, role: 'ADMIN', isAllowed: true } });
  await prisma.userModuleAccess.create({
    data: { userId, tenantId: primaryTenantId, moduleId: threatModule.id },
  });

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
  if (tenantIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  if (packageId) await prisma.subscriptionPackage.deleteMany({ where: { id: packageId } });
  await prisma.$disconnect();
});

test('Given one active campaign-backed actor, when POST correlates, then the relation is persisted', async () => {
  const indicator = await createIndicator(primaryTenantId, 'matched');
  const actor = await createActor(primaryTenantId, 'matched');
  await linkThroughCampaign(primaryTenantId, actor.id, indicator.id, 'matched');

  const response = await correlate(indicator.id);

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    status: 'matched',
    indicatorId: indicator.id,
    threatActor: { id: actor.id, name: `Correlation actor ${runId}-matched` },
    basis: ['campaign'],
    created: true,
  });
  const persisted = await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } });
  assert.equal(persisted.intelligenceEntityId, actor.entityId);
});

test('Given no candidate, when POST correlates, then it returns no_match without persisting a relation', async () => {
  const indicator = await createIndicator(primaryTenantId, 'none');

  const response = await correlate(indicator.id);

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    status: 'no_match',
    indicatorId: indicator.id,
    reason: 'NO_VALID_CANDIDATE',
  });
  const persisted = await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } });
  assert.equal(persisted.intelligenceEntityId, null);
});

test('Given two active candidates, when POST correlates, then it returns no_match as ambiguous', async () => {
  const indicator = await createIndicator(primaryTenantId, 'ambiguous');
  const firstActor = await createActor(primaryTenantId, 'ambiguous-first');
  const secondActor = await createActor(primaryTenantId, 'ambiguous-second');
  await linkThroughCampaign(primaryTenantId, firstActor.id, indicator.id, 'ambiguous-first');
  await linkThroughCampaign(primaryTenantId, secondActor.id, indicator.id, 'ambiguous-second');

  const response = await correlate(indicator.id);

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    status: 'no_match',
    indicatorId: indicator.id,
    reason: 'AMBIGUOUS_CANDIDATES',
  });
  const persisted = await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } });
  assert.equal(persisted.intelligenceEntityId, null);
});

test('Given an indicator in another tenant, when POST correlates, then access is rejected', async () => {
  const indicator = await createIndicator(secondaryTenantId, 'cross-tenant');

  const response = await correlate(indicator.id);

  assert.equal(response.status, 403);
  const persisted = await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } });
  assert.equal(persisted.intelligenceEntityId, null);
});

test('Given only an inactive actor, when POST correlates, then it returns no_match', async () => {
  const indicator = await createIndicator(primaryTenantId, 'inactive');
  const actor = await createActor(primaryTenantId, 'inactive', 'INACTIVE');
  await linkThroughCampaign(primaryTenantId, actor.id, indicator.id, 'inactive');

  const response = await correlate(indicator.id);

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    status: 'no_match',
    indicatorId: indicator.id,
    reason: 'NO_VALID_CANDIDATE',
  });
  const persisted = await prisma.indicator.findUniqueOrThrow({ where: { id: indicator.id } });
  assert.equal(persisted.intelligenceEntityId, null);
});
