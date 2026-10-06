require('reflect-metadata');
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createServer } = require('node:http');
const { JwtService } = require('@nestjs/jwt');
const { NestFactory } = require('@nestjs/core');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require('../../dist/src/app.module.js');

const prisma = new PrismaClient();
const runId = `${Date.now()}-${process.pid}`;
const tenantIds = [];
const userIds = [];
let app;
let baseUrl;
let packageId;
let primaryTenantId;
let secondaryTenantId;
let adminToken;
let userToken;
let mitreServer;
let mitreStatus = 200;
let mitreObjects = [];
let previousMitreUrl;

function intrusionSet(suffix, overrides = {}) {
  return { type: 'intrusion-set', id: `intrusion-set--${runId}-${suffix}`, name: `MITRE actor ${runId}-${suffix}`, aliases: ['APT Test'], ...overrides };
}

function ingest(token = adminToken) {
  return fetch(`${baseUrl}/intelligence/threat-actors/ingest-mitre`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
}

before(async () => {
  mitreServer = createServer((_request, response) => {
    response.writeHead(mitreStatus, { 'content-type': 'application/json' });
    response.end(mitreStatus === 200 ? JSON.stringify({ type: 'bundle', objects: mitreObjects }) : 'unavailable');
  });
  await new Promise(resolve => mitreServer.listen(0, '127.0.0.1', resolve));
  const mitreAddress = mitreServer.address();
  previousMitreUrl = process.env.MITRE_ATTACK_STIX_URL;
  process.env.MITRE_ATTACK_STIX_URL = `http://127.0.0.1:${mitreAddress.port}/enterprise-attack.json`;

  const threatModule = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'threat-intelligence' } });
  const subscriptionPackage = await prisma.subscriptionPackage.create({ data: { name: `MITRE ingestion QA ${runId}`, type: 'PREDEFINED', billingCycle: 'MONTHLY', priceMonthly: 0, modules: { create: { moduleId: threatModule.id } } } });
  packageId = subscriptionPackage.id;
  const primary = await prisma.tenant.create({ data: { name: `MITRE primary ${runId}`, slug: `mitre-primary-${runId}` } });
  const secondary = await prisma.tenant.create({ data: { name: `MITRE secondary ${runId}`, slug: `mitre-secondary-${runId}` } });
  primaryTenantId = primary.id;
  secondaryTenantId = secondary.id;
  tenantIds.push(primaryTenantId, secondaryTenantId);
  const admin = await prisma.user.create({ data: { email: `mitre-admin-${runId}@example.test`, name: 'MITRE Admin', passwordHash: 'integration-test-only', role: 'ADMIN', tenantId: primaryTenantId } });
  const user = await prisma.user.create({ data: { email: `mitre-user-${runId}@example.test`, name: 'MITRE User', passwordHash: 'integration-test-only', role: 'USER', tenantId: primaryTenantId } });
  userIds.push(admin.id, user.id);
  await prisma.tenantSubscription.create({ data: { tenantId: primaryTenantId, packageId, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 60_000) } });
  const tenantModule = await prisma.tenantModule.create({ data: { tenantId: primaryTenantId, moduleId: threatModule.id, isEnabled: true } });
  await prisma.moduleRoleAccess.createMany({ data: [{ tenantModuleId: tenantModule.id, role: 'ADMIN', isAllowed: true }, { tenantModuleId: tenantModule.id, role: 'USER', isAllowed: true }] });
  await prisma.userModuleAccess.createMany({ data: [{ userId: admin.id, tenantId: primaryTenantId, moduleId: threatModule.id, featureKeys: ['intelligence-hub'] }, { userId: user.id, tenantId: primaryTenantId, moduleId: threatModule.id, featureKeys: ['intelligence-hub'] }] });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  const jwt = new JwtService();
  adminToken = await jwt.signAsync({ sub: admin.id, tenantId: primaryTenantId, role: 'ADMIN' }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' });
  userToken = await jwt.signAsync({ sub: user.id, tenantId: primaryTenantId, role: 'USER' }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' });
});

after(async () => {
  if (app) await app.close();
  await new Promise((resolve, reject) => mitreServer.close(error => error ? reject(error) : resolve()));
  if (previousMitreUrl === undefined) delete process.env.MITRE_ATTACK_STIX_URL;
  else process.env.MITRE_ATTACK_STIX_URL = previousMitreUrl;
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (tenantIds.length > 0) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  if (packageId) await prisma.subscriptionPackage.deleteMany({ where: { id: packageId } });
  await prisma.$disconnect();
});

test('Given one MITRE intrusion-set, when manual ingestion runs, then it is created and audited', async () => {
  const input = intrusionSet('success');
  mitreStatus = 200;
  mitreObjects = [input];
  const response = await ingest();
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.deepEqual(body, { total: 1, created: 1, updated: 0, failed: 0 });
  assert.ok(await prisma.auditLog.findFirst({ where: { tenantId: primaryTenantId, action: 'MITRE_THREAT_ACTORS_INGESTED' } }));
});

test('Given mixed STIX objects, when manual ingestion runs, then only intrusion-sets are processed', async () => {
  const input = intrusionSet('filtered');
  mitreObjects = [input, { type: 'intrusion-set', id: 'invalid-id' }, { type: 'malware', id: `malware--${runId}`, name: 'Ignored malware' }, { type: 'threat-actor', id: `threat-actor--${runId}`, name: 'Ignored actor' }];
  const body = await (await ingest()).json();
  assert.deepEqual(body, { total: 2, created: 1, updated: 0, failed: 1 });
  assert.equal(await prisma.intelligenceEntity.count({ where: { tenantId: primaryTenantId, externalId: { in: [input.id, `malware--${runId}`, `threat-actor--${runId}`] } } }), 1);
});

test('Given an existing MITRE externalId, when manual ingestion runs, then it updates without duplication', async () => {
  const input = intrusionSet('duplicate', { description: 'Updated by MITRE' });
  const entity = await prisma.intelligenceEntity.create({ data: { tenantId: primaryTenantId, type: 'THREAT_ACTOR', name: input.name, externalId: input.id, description: 'Old description' } });
  await prisma.threatActor.create({ data: { tenantId: primaryTenantId, entityId: entity.id, createdBy: userIds[0] } });
  mitreObjects = [input];
  const body = await (await ingest()).json();
  assert.deepEqual(body, { total: 1, created: 0, updated: 1, failed: 0 });
  assert.equal(await prisma.intelligenceEntity.count({ where: { tenantId: primaryTenantId, externalId: input.id } }), 1);
  assert.equal((await prisma.intelligenceEntity.findUniqueOrThrow({ where: { id: entity.id } })).description, 'Updated by MITRE');
});

test('Given MITRE returns an HTTP failure, when manual ingestion runs, then the endpoint fails without creating actors', async () => {
  mitreStatus = 503;
  const beforeCount = await prisma.threatActor.count({ where: { tenantId: primaryTenantId } });
  const response = await ingest();
  mitreStatus = 200;
  assert.equal(response.status, 503);
  assert.equal(await prisma.threatActor.count({ where: { tenantId: primaryTenantId } }), beforeCount);
});

test('Given a foreign tenant has the same MITRE externalId, when tenant ingestion runs, then tenant data stays isolated', async () => {
  const input = intrusionSet('tenant');
  const foreignEntity = await prisma.intelligenceEntity.create({ data: { tenantId: secondaryTenantId, type: 'THREAT_ACTOR', name: `Foreign ${runId}`, externalId: input.id } });
  await prisma.threatActor.create({ data: { tenantId: secondaryTenantId, entityId: foreignEntity.id, createdBy: userIds[0] } });
  mitreObjects = [input];
  const body = await (await ingest()).json();
  assert.equal(body.created, 1);
  assert.equal((await prisma.intelligenceEntity.findUniqueOrThrow({ where: { id: foreignEntity.id } })).name, `Foreign ${runId}`);
  assert.equal(await prisma.intelligenceEntity.count({ where: { externalId: input.id } }), 2);
});

test('Given a USER role, when manual MITRE ingestion is requested, then authorization rejects it', async () => {
  mitreObjects = [intrusionSet('forbidden')];
  assert.equal((await ingest(userToken)).status, 403);
});
