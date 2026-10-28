const { test, expect } = require('@playwright/test');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const backendRequire = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const { Test } = backendRequire('@nestjs/testing');
const { ConfigModule } = backendRequire('@nestjs/config');
const { ValidationPipe } = backendRequire('@nestjs/common');
const cookieParser = backendRequire('cookie-parser');
const bcrypt = backendRequire('bcrypt');
const { PrismaClient } = backendRequire('@prisma/client');
const { AuthModule } = backendRequire('./dist/src/auth/auth.module');
const { AppSecModule } = backendRequire('./dist/src/appsec/appsec.module');
const { UsersModule } = backendRequire('./dist/src/users/users.module');
const { ModulesModule } = backendRequire('./dist/src/modules/modules.module');

const frontend = 'http://localhost:3100';
const backend = 'http://localhost:3101';
const evidence = path.resolve(__dirname, '../test-results/appsec-p1a-live');
let app;
let prisma;
let fixture;

test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

test.beforeAll(async () => {
  const qaDatabase = process.env.APPSEC_P1A_QA_DB_NAME;
  if (!/^stake45_p1a_[0-9a-f]{10}$/.test(qaDatabase ?? '') || new URL(process.env.DATABASE_URL).pathname !== `/${qaDatabase}`) throw new Error('Expected isolated QA database');
  if (process.env.APPSEC_V2_TRIAGE_ENABLED !== 'true') throw new Error('Backend QA rollout disabled');
  prisma = new PrismaClient();
  const nest = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, UsersModule, ModulesModule, AppSecModule] }).compile();
  app = nest.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.enableCors({ origin: frontend, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(3101, '127.0.0.1');

  const suffix = randomUUID();
  const password = `QA-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(password, 4);
  const tenantA = await prisma.tenant.create({ data: { name: 'P1A Live A', slug: `p1a-live-a-${suffix}` } });
  const tenantB = await prisma.tenant.create({ data: { name: 'P1A Live B', slug: `p1a-live-b-${suffix}` } });
  const module = await prisma.appModule.upsert({ where: { slug: 'appsec-posture' }, update: {}, create: { slug: 'appsec-posture', name: 'AppSec', description: 'QA', category: 'APPSEC', features: { create: [{ key: 'finding-management', name: 'Finding Management' }] } } });
  await prisma.tenantSubscription.create({ data: { tenantId: tenantA.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, renewalAt: new Date(Date.now() + 86400000), status: 'ACTIVE', customModules: { create: { moduleId: module.id } } } });
  await prisma.tenantModule.create({ data: { tenantId: tenantA.id, moduleId: module.id, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
  async function account(name, role, tenantId, isActive = true) {
    return prisma.user.create({ data: { name, email: `${name.toLowerCase().replaceAll(' ', '-')}-${suffix}@example.test`, passwordHash, role, tenantId, isActive } });
  }
  const admin = await account('Live Admin', 'ADMIN', tenantA.id);
  const user = await account('Live User', 'USER', tenantA.id);
  const ownerA = await account('Live Owner A', 'USER', tenantA.id);
  const ownerB = await account('Live Owner B', 'USER', tenantA.id);
  const inactive = await account('Live Inactive', 'USER', tenantA.id, false);
  const foreign = await account('Live Foreign', 'USER', tenantB.id);
  const root = await account('Live Root', 'SUPER_ADMIN', null);
  for (const person of [admin, user]) await prisma.userModuleAccess.create({ data: { userId: person.id, tenantId: tenantA.id, moduleId: module.id, featureKeys: ['finding-management'] } });
  const applicationA = await prisma.application.create({ data: { tenantId: tenantA.id, name: 'Live QA Application A' } });
  const applicationB = await prisma.application.create({ data: { tenantId: tenantB.id, name: 'Live QA Application B' } });
  const finding = await prisma.appSecFinding.create({ data: { tenantId: tenantA.id, applicationId: applicationA.id, title: 'Live QA P1-A Finding', severity: 'HIGH', source: 'MANUAL', status: 'OPEN' } });
  const foreignFinding = await prisma.appSecFinding.create({ data: { tenantId: tenantB.id, applicationId: applicationB.id, title: 'Foreign QA Finding', severity: 'LOW', source: 'MANUAL', status: 'OPEN' } });
  fixture = { tenantA, tenantB, admin, user, ownerA, ownerB, inactive, foreign, root, finding, foreignFinding, password };
});

test.afterAll(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
});

async function login(page, account) {
  await page.goto(`${frontend}/login`);
  await page.getByLabel('Email address').fill(account.email);
  await page.locator('#password').fill(fixture.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto(`${frontend}/appsec/findings/${fixture.finding.id}`);
  await expect(page.getByRole('heading', { name: fixture.finding.title })).toBeVisible();
}

async function api(page, route, method = 'GET', data) {
  const response = await page.evaluate(async ({ url, method, data }) => {
    const result = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: result.status, body: await result.json() };
  }, { url: backend + route, method, data });
  return response;
}

test('ADMIN completes real login, lifecycle, assignment and persistence', async ({ page }) => {
  await login(page, fixture.admin);
  await expect(page.getByText('Legacy finding')).toBeVisible();
  await page.getByLabel('Triage reason').fill('Open reviewed QA triage');
  await page.getByRole('button', { name: 'Activate V2 triage' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'PENDING' })).toBeVisible();
  await expect(page.locator('.appsec-facts dt:has-text("Revision") + dd')).toHaveText('1');
  await page.getByLabel('Validation').selectOption('REJECTED');
  await page.getByLabel('Triage reason').fill('Needs additional context');
  await page.getByRole('button', { name: 'Record validation' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'REJECTED' })).toBeVisible();
  await page.getByLabel('Validation').selectOption('VALID');
  await page.getByLabel('Triage reason').fill('Context confirmed');
  await page.getByRole('button', { name: 'Record validation' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'VALID' })).toBeVisible();
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.getByLabel('Triage reason').fill('High application impact');
  await page.getByRole('button', { name: 'Set priority' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'HIGH' })).toBeVisible();
  await page.getByLabel('Assignee').selectOption(fixture.ownerA.id);
  await page.getByRole('button', { name: 'Save assignment' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: fixture.ownerA.name })).toBeVisible();
  await page.getByLabel('Assignee').selectOption(fixture.ownerB.id);
  await page.getByLabel('Triage reason').fill('Rotate ownership for QA');
  await page.getByRole('button', { name: 'Save assignment' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: fixture.ownerB.name })).toBeVisible();
  await expect(page.locator('.appsec-facts dt:has-text("Revision") + dd')).toHaveText('6');
  await page.reload();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: fixture.ownerB.name })).toBeVisible();
  await expect(page.locator('.appsec-facts dt:has-text("Revision") + dd')).toHaveText('6');
  await expect(page.getByText('High application impact')).toBeVisible();
  await expect(page.getByText('Rotate ownership for QA')).toBeVisible();
  await expect(page.locator('.appsec-triage-history li')).toHaveCount(6);
  await expect(page.locator('.appsec-triage-history li').filter({ hasText: `By ${fixture.admin.name}` })).toHaveCount(6);
  const record = await prisma.appSecFinding.findUniqueOrThrow({ where: { id: fixture.finding.id } });
  expect({ version: record.workflowVersion, revision: record.revision, state: record.validationState, priority: record.priority, owner: record.assigneeId }).toEqual({ version: 2, revision: 6, state: 'VALID', priority: 'HIGH', owner: fixture.ownerB.id });
  const events = await prisma.appSecFindingActionEvent.findMany({ where: { findingId: record.id }, orderBy: { revision: 'asc' } });
  expect(events.map(item => item.kind)).toEqual(['ACTIVATED', 'VALIDATION_REJECTED', 'VALIDATED', 'PRIORITY_SET', 'ASSIGNED', 'REASSIGNED']);
  expect(events.every(item => item.actorId === fixture.admin.id && item.tenantId === fixture.tenantA.id)).toBe(true);
  expect(await prisma.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: { in: events.map(item => `APPSEC_FINDING_${item.kind}`) } } })).toBe(6);
  const stale = await api(page, `/appsec/findings/${record.id}/lifecycle/priority`, 'POST', { expectedRevision: 5, priority: 'LOW', rationale: 'Stale' });
  expect(stale.status).toBe(409);
  const bypass = await api(page, `/appsec/findings/${record.id}`, 'PATCH', { status: 'RESOLVED', resolution: 'Bypass' });
  expect(bypass.status).toBe(409);
  await require('node:fs/promises').mkdir(evidence, { recursive: true });
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.locator('.appsec-triage-history')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `admin-${width}.png`), fullPage: true });
  }
});

test('USER sees real read-only state and 403 direct mutation', async ({ page }) => {
  await login(page, fixture.user);
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'VALID' })).toBeVisible();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: fixture.ownerB.name })).toBeVisible();
  await expect(page.getByText(fixture.ownerB.id)).toHaveCount(0);
  await expect(page.locator('.appsec-facts dt:has-text("Revision") + dd')).toHaveText('6');
  await expect(page.getByRole('button', { name: 'Set priority' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save assignment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record validation' })).toHaveCount(0);
  await expect(page.locator('.appsec-triage-history li')).toHaveCount(6);
  await expect(page.locator('.appsec-triage-history li').filter({ hasText: `By ${fixture.admin.name}` })).toHaveCount(6);
  expect((await api(page, `/appsec/findings/${fixture.finding.id}`)).body.assigneeName).toBe(fixture.ownerB.name);
  expect((await api(page, `/appsec/findings/${fixture.finding.id}`)).body.assignee).toBeUndefined();
  expect((await api(page, `/appsec/findings/${fixture.finding.id}/lifecycle/events`)).body.items.every(event => event.actorName === fixture.admin.name && event.email === undefined)).toBe(true);
  expect((await api(page, '/appsec/findings/assignees')).status).toBe(403);
  expect((await api(page, `/appsec/findings/${fixture.finding.id}/lifecycle/priority`, 'POST', { expectedRevision: 6, priority: 'LOW', rationale: 'Denied' })).status).toBe(403);
  expect((await api(page, `/appsec/findings/${fixture.finding.id}`, 'PATCH', { title: 'Denied' })).status).toBe(403);
  expect((await api(page, `/appsec/findings/${fixture.foreignFinding.id}`)).status).toBe(404);
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `user-${width}.png`), fullPage: true });
  }
});

test('tenant and assignee boundaries use real authenticated requests', async ({ page }) => {
  await login(page, fixture.admin);
  const route = `/appsec/findings/${fixture.finding.id}/lifecycle/assign`;
  for (const id of [fixture.foreign.id, fixture.inactive.id]) {
    expect((await api(page, route, 'POST', { expectedRevision: 6, assigneeId: id, reason: 'Denied QA' })).status).toBe(404);
    await expect(page.getByLabel('Assignee').locator(`option[value="${id}"]`)).toHaveCount(0);
  }
  expect((await api(page, `/appsec/findings/${fixture.finding.id}?tenantId=${fixture.tenantB.id}`)).status).toBe(403);
  expect((await api(page, `/appsec/findings/${fixture.foreignFinding.id}`)).status).toBe(404);
  await page.goto(`${frontend}/appsec/findings/${fixture.foreignFinding.id}`);
  await expect(page.getByText('Finding tidak ditemukan dalam tenant ini.')).toBeVisible();
  await page.goto(`${frontend}/appsec/findings/${fixture.finding.id}`);
  await expect(page.getByRole('heading', { name: fixture.finding.title })).toBeVisible();

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email address').fill(fixture.root.email);
  await page.locator('#password').fill(fixture.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto(`${frontend}/appsec/findings/${fixture.finding.id}`);
  await expect(page.getByText('Pilih tenant untuk membuka AppSec.')).toBeVisible();
  await page.getByLabel('Tenant AppSec').selectOption(fixture.tenantA.id);
  await expect(page.getByRole('heading', { name: fixture.finding.title })).toBeVisible();
  await expect(page.locator('.appsec-triage-history li').filter({ hasText: `By ${fixture.admin.name}` })).toHaveCount(6);
  await page.getByLabel('Tenant AppSec').selectOption(fixture.tenantB.id);
  await expect(page.getByRole('heading', { name: fixture.finding.title })).toHaveCount(0);
  await expect(page.getByText('Finding tidak ditemukan dalam tenant ini.')).toBeVisible();
  await expect(page.getByText(fixture.ownerB.name)).toHaveCount(0);
  await expect(page.getByText(`By ${fixture.admin.name}`)).toHaveCount(0);
  expect((await api(page, `/appsec/findings/${fixture.finding.id}/lifecycle/events?tenantId=${fixture.tenantB.id}`)).status).toBe(403);
});
