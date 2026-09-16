require('reflect-metadata');
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { ValidationPipe } = require('@nestjs/common');
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

function stixActor(suffix, overrides = {}) {
  return {
    type: 'threat-actor', spec_version: '2.1', id: `threat-actor--${runId}-${suffix}`,
    name: `Ingested actor ${runId}-${suffix}`, aliases: ['Example alias'],
    description: 'Original description', primary_motivation: 'financial-gain',
    country_codes: ['ID'], region_codes: ['south-eastern-asia'], goals: ['financial-services'],
    resource_level: 'organization', ...overrides,
  };
}

function stixIntrusionSet(suffix, overrides = {}) {
  return {
    type: 'intrusion-set', spec_version: '2.1', id: `intrusion-set--${runId}-${suffix}`,
    name: `Ingested intrusion-set ${runId}-${suffix}`, aliases: ['MITRE APT', 'Comment Crew'],
    description: 'MITRE ATT&CK intrusion-set', primary_motivation: 'organizational-gain',
    country_codes: ['CN'], region_codes: ['eastern-asia'], goals: ['data-theft'],
    x_mitre_affiliations: ['PLA Unit 61398'], ...overrides,
  };
}

function post(path, body) {
  return fetch(`${baseUrl}/intelligence/threat-actors/${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

before(async () => {
  const threatModule = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'threat-intelligence' } });
  const subscriptionPackage = await prisma.subscriptionPackage.create({
    data: { name: `Threat actor ingestion QA ${runId}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: { moduleId: threatModule.id } } },
  });
  packageId = subscriptionPackage.id;
  const primary = await prisma.tenant.create({ data: { name: `Ingestion primary ${runId}`, slug: `ingestion-primary-${runId}` } });
  const secondary = await prisma.tenant.create({ data: { name: `Ingestion secondary ${runId}`, slug: `ingestion-secondary-${runId}` } });
  primaryTenantId = primary.id;
  secondaryTenantId = secondary.id;
  tenantIds.push(primaryTenantId, secondaryTenantId);
  const user = await prisma.user.create({ data: { email: `ingestion-${runId}@example.test`, name: 'Ingestion QA Admin', passwordHash: 'integration-test-only', role: 'ADMIN', tenantId: primaryTenantId } });
  userId = user.id;
  await prisma.tenantSubscription.create({ data: { tenantId: primaryTenantId, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 60_000) } });
  const tenantModule = await prisma.tenantModule.create({ data: { tenantId: primaryTenantId, moduleId: threatModule.id, isEnabled: true } });
  await prisma.moduleRoleAccess.create({ data: { tenantModuleId: tenantModule.id, role: 'ADMIN', isAllowed: true } });
  await prisma.userModuleAccess.create({ data: { userId, tenantId: primaryTenantId, moduleId: threatModule.id } });
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  accessToken = await new JwtService().signAsync({ sub: userId, tenantId: primaryTenantId, role: 'ADMIN' }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' });
});

after(async () => {
  if (app) await app.close();
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  if (tenantIds.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  if (packageId) await prisma.subscriptionPackage.deleteMany({ where: { id: packageId } });
  await prisma.$disconnect();
});

test('Given a new STIX actor, when upsert is posted, then a mapped actor is created', async () => {
  const input = stixActor('create', { first_seen: '2025-01-01T00:00:00.000Z' });
  const response = await post('upsert', input);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.entity.externalId, input.id);
  assert.equal(body.entity.name, input.name);
  assert.deepEqual(body.aliases, input.aliases);
  assert.equal(body.motivation, input.primary_motivation);
  assert.equal(body.country, input.country_codes[0]);
  assert.equal(body.region, input.region_codes[0]);
  assert.deepEqual(body.targetSectors, input.goals);
  assert.equal(body.entity.metadata.first_seen, input.first_seen);
  assert.ok(await prisma.auditLog.findFirst({ where: { tenantId: primaryTenantId, action: 'THREAT_ACTOR_INGESTED', metadata: { path: ['threatActorId'], equals: body.id } } }));
});

test('Given an existing externalId, when upsert is posted, then that actor is updated', async () => {
  const input = stixActor('update');
  const original = await (await post('upsert', input)).json();
  const response = await post('upsert', { ...input, name: `${input.name} updated`, description: 'Updated description' });
  const updated = await response.json();
  assert.equal(response.status, 201);
  assert.equal(updated.id, original.id);
  assert.equal(updated.entity.name, `${input.name} updated`);
  assert.equal(updated.entity.description, 'Updated description');
});

test('Given duplicate STIX actors, when batch is posted, then only one record exists', async () => {
  const input = stixActor('duplicate');
  const response = await post('batch', { threatActors: [input, input] });
  const body = await response.json();
  const count = await prisma.intelligenceEntity.count({ where: { tenantId: primaryTenantId, type: 'THREAT_ACTOR', externalId: input.id } });
  assert.equal(response.status, 201);
  assert.deepEqual({ created: body.created, updated: body.updated }, { created: 1, updated: 1 });
  assert.equal(count, 1);
});

test('Given the same externalId in another tenant, when upsert is posted, then tenant data remains isolated', async () => {
  const input = stixActor('tenant');
  const foreignEntity = await prisma.intelligenceEntity.create({ data: { tenantId: secondaryTenantId, type: 'THREAT_ACTOR', name: `Foreign ${runId}`, externalId: input.id } });
  await prisma.threatActor.create({ data: { tenantId: secondaryTenantId, entityId: foreignEntity.id, createdBy: userId } });
  const response = await post('upsert', input);
  const ownActor = await response.json();
  const unchangedForeign = await prisma.intelligenceEntity.findUniqueOrThrow({ where: { id: foreignEntity.id } });
  assert.equal(response.status, 201);
  assert.equal(ownActor.tenantId, primaryTenantId);
  assert.equal(unchangedForeign.name, `Foreign ${runId}`);
  assert.equal(await prisma.intelligenceEntity.count({ where: { type: 'THREAT_ACTOR', externalId: input.id } }), 2);
});

test('Given an invalid STIX payload, when upsert is posted, then validation rejects it', async () => {
  const response = await post('upsert', { type: 'malware', id: 'invalid', name: '' });
  assert.equal(response.status, 400);
});

test('Given a MITRE intrusion-set, when upsert is posted, then it is normalized to threat-actor and mapped', async () => {
  const input = stixIntrusionSet('mitre-normalize');
  const response = await post('upsert', input);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.entity.externalId, input.id, 'externalId should preserve original intrusion-set id');
  assert.equal(body.entity.name, input.name);
  assert.deepEqual(body.aliases, input.aliases);
  assert.equal(body.motivation, input.primary_motivation);
  assert.equal(body.country, input.country_codes[0]);
  assert.equal(body.region, input.region_codes[0]);
  assert.deepEqual(body.targetSectors, input.goals);
  assert.deepEqual(body.entity.metadata.x_mitre_affiliations, input.x_mitre_affiliations);
});

test('Given an intrusion-set with batch, when batch is posted, then all are normalized and ingested', async () => {
  const input1 = stixIntrusionSet('batch-1');
  const input2 = stixIntrusionSet('batch-2');
  const response = await post('batch', { threatActors: [input1, input2] });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.created, 2);
  assert.equal(body.updated, 0);
  assert.equal(body.items.length, 2);
  assert.equal(body.items[0].entity.externalId, input1.id);
  assert.equal(body.items[1].entity.externalId, input2.id);
});

test('Given mixed threat-actor and intrusion-set, when batch is posted, then both types are processed', async () => {
  const actor = stixActor('mixed-actor');
  const intrusionSet = stixIntrusionSet('mixed-set');
  const response = await post('batch', { threatActors: [actor, intrusionSet] });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.created, 2);
  assert.equal(body.items.length, 2);
  const byExternalId = {};
  body.items.forEach(item => { byExternalId[item.entity.externalId] = item; });
  assert.ok(byExternalId[actor.id], 'threat-actor should be in results');
  assert.ok(byExternalId[intrusionSet.id], 'intrusion-set should be in results');
  assert.equal(byExternalId[actor.id].entity.name, actor.name);
  assert.equal(byExternalId[intrusionSet.id].entity.name, intrusionSet.name);
});

test('Given an intrusion-set with invalid type, when upsert is posted, then validation rejects it', async () => {
  const response = await post('upsert', { type: 'intrusion-set-invalid', id: 'intrusion-set--fake', name: 'Invalid' });
  assert.equal(response.status, 400);
});

test('Given an intrusion-set with a threat-actor ID, when upsert is posted, then validation rejects it', async () => {
  const response = await post('upsert', { type: 'intrusion-set', id: `threat-actor--${runId}-mismatched`, name: 'Mismatched ID' });
  assert.equal(response.status, 400);
});

test('Given an intrusion-set update, when upsert is posted twice, then the actor is updated with normalized type', async () => {
  const input = stixIntrusionSet('update-test');
  const original = await (await post('upsert', input)).json();
  const updated = await (await post('upsert', { ...input, name: `${input.name} updated`, description: 'Updated from intrusion-set' })).json();
  assert.equal(original.id, updated.id);
  assert.equal(updated.entity.name, `${input.name} updated`);
  assert.equal(updated.entity.description, 'Updated from intrusion-set');
  assert.equal(updated.entity.externalId, input.id);
});

test('Given threat-actor and intrusion-set with the same name, when both are ingested, then the existing uniqueness rule rejects the duplicate', async () => {
  const sameName = `Same name actor-set ${runId}`;
  const actor = stixActor('same-name-actor', { name: sameName });
  const intrusionSet = stixIntrusionSet('same-name-set', { name: sameName });
  const firstResponse = await post('upsert', actor);
  const duplicateResponse = await post('upsert', intrusionSet);
  const count = await prisma.intelligenceEntity.count({ where: { tenantId: primaryTenantId, type: 'THREAT_ACTOR', name: sameName } });
  assert.equal(firstResponse.status, 201);
  assert.equal(duplicateResponse.status, 409);
  assert.equal(count, 1);
});
