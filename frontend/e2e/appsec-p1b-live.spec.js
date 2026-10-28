const { test, expect } = require('@playwright/test');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
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
const evidenceDir = path.resolve(__dirname, '../test-results/appsec-p1b-live');
let app;
let prisma;
let fixture;

test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

test.beforeAll(async () => {
  const qa = process.env.APPSEC_P1B_QA_DB_NAME;
  if (!/^stake46_p1b_[0-9a-f]{10}$/.test(qa ?? '') || new URL(process.env.DATABASE_URL).pathname !== `/${qa}`) throw new Error('Expected isolated P1-B QA database');
  if (process.env.APPSEC_V2_REMEDIATION_ENABLED !== 'true') throw new Error('P1-B QA rollout disabled');
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
  const tenantA = await prisma.tenant.create({ data: { name: 'P1B Live A', slug: `p1b-live-a-${suffix}` } });
  const tenantB = await prisma.tenant.create({ data: { name: 'P1B Live B', slug: `p1b-live-b-${suffix}` } });
  const module = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'appsec-posture' }, include: { features: true } });
  expect(module.features.map(item => item.key)).toContain('finding-remediation-submit');
  await prisma.tenantSubscription.create({ data: { tenantId: tenantA.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, renewalAt: new Date(Date.now() + 86400000), status: 'ACTIVE', customModules: { create: { moduleId: module.id } } } });
  await prisma.tenantModule.create({ data: { tenantId: tenantA.id, moduleId: module.id, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
  async function account(name, role, tenantId, features = []) {
    const person = await prisma.user.create({ data: { name, email: `${name.toLowerCase().replaceAll(' ', '-')}-${suffix}@example.test`, passwordHash, role, tenantId } });
    if (features.length) await prisma.userModuleAccess.create({ data: { userId: person.id, tenantId, moduleId: module.id, featureKeys: features } });
    return person;
  }
  const grant = ['finding-management', 'finding-remediation-submit'];
  const admin = await account('P1B Admin', 'ADMIN', tenantA.id, grant);
  const assigned = await account('P1B Assigned', 'USER', tenantA.id, grant);
  const readOnly = await account('P1B Reader', 'USER', tenantA.id, ['finding-management']);
  const foreign = await account('P1B Foreign', 'USER', tenantB.id);
  const applicationA = await prisma.application.create({ data: { tenantId: tenantA.id, name: 'P1B QA Application A' } });
  const applicationB = await prisma.application.create({ data: { tenantId: tenantB.id, name: 'P1B QA Application B' } });
  const finding = await prisma.appSecFinding.create({ data: { tenantId: tenantA.id, applicationId: applicationA.id, title: 'P1B Live Finding', severity: 'MEDIUM', source: 'MANUAL', status: 'OPEN' } });
  const foreignFinding = await prisma.appSecFinding.create({ data: { tenantId: tenantB.id, applicationId: applicationB.id, title: 'P1B Foreign Finding', severity: 'LOW', source: 'MANUAL', status: 'OPEN' } });
  fixture = { tenantA, admin, assigned, readOnly, foreign, finding, foreignFinding, password };
});

test.afterAll(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
});

async function login(page, person) {
  await page.goto(`${frontend}/login`);
  await page.getByLabel('Email address').fill(person.email);
  await page.locator('#password').fill(fixture.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto(`${frontend}/appsec/findings/${fixture.finding.id}`);
  await expect(page.getByRole('heading', { name: fixture.finding.title })).toBeVisible();
}

async function api(page, route, method = 'GET', data) {
  return page.evaluate(async ({ url, method, data }) => {
    const response = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  }, { url: backend + route, method, data });
}

test('ADMIN prepares and assigns the Finding through P1-A controls', async ({ page }) => {
  await login(page, fixture.admin);
  await page.getByLabel('Triage reason').fill('Open P1B QA work');
  await page.getByRole('button', { name: 'Activate V2 triage' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'PENDING' })).toBeVisible();
  await page.getByLabel('Triage reason').fill('P1B finding confirmed');
  await page.getByRole('button', { name: 'Record validation' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'VALID' })).toBeVisible();
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.getByLabel('Triage reason').fill('High operational impact');
  await page.getByRole('button', { name: 'Set priority' }).click();
  await page.getByLabel('Assignee').selectOption(fixture.assigned.id);
  await page.getByRole('button', { name: 'Save assignment' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: fixture.assigned.name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start remediation' })).toHaveCount(0);
  expect((await api(page, `/appsec/findings/${fixture.finding.id}/lifecycle/start`, 'POST', { expectedRevision: 4 })).status).toBe(403);
});

test('assigned USER starts work and submits immutable evidence through real UI', async ({ page }) => {
  await login(page, fixture.assigned);
  await expect(page.getByRole('button', { name: 'Start remediation' })).toBeVisible();
  await page.getByRole('button', { name: 'Start remediation' }).click();
  await expect(page.locator('.appsec-remediation-work dd').filter({ hasText: 'IN PROGRESS' })).toBeVisible();
  await page.getByLabel('Evidence note').fill('Patch deployed and reviewed in QA');
  await page.getByLabel('Evidence reference').fill('https://example.test/p1b/evidence');
  await page.getByRole('button', { name: 'Submit evidence' }).click();
  await expect(page.locator('.appsec-evidence-history li').filter({ hasText: 'Patch deployed and reviewed in QA' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.appsec-evidence-history li').filter({ hasText: fixture.assigned.name })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Evidence reference' })).toHaveAttribute('href', 'https://example.test/p1b/evidence');
  await expect(page.locator('.appsec-remediation-work dd').filter({ hasText: 'IN PROGRESS' })).toBeVisible();
  await expect(page.locator('.appsec-facts dt:has-text("Revision") + dd')).toHaveText('6');
  const record = await prisma.appSecFinding.findUniqueOrThrow({ where: { id: fixture.finding.id } });
  expect(record.status).toBe('IN_PROGRESS');
  expect(record.revision).toBe(6);
  const events = await prisma.appSecFindingActionEvent.findMany({ where: { findingId: record.id }, orderBy: { revision: 'asc' } });
  expect(events.map(event => event.kind)).toEqual(['ACTIVATED', 'VALIDATED', 'PRIORITY_SET', 'ASSIGNED', 'REMEDIATION_STARTED', 'EVIDENCE_SUBMITTED']);
  expect(events[5].after).toMatchObject({ note: 'Patch deployed and reviewed in QA', reference: 'https://example.test/p1b/evidence', status: 'IN_PROGRESS' });
  expect(events[5].actorId).toBe(fixture.assigned.id);
  expect(events.every(event => event.tenantId === fixture.tenantA.id)).toBe(true);
  expect(await prisma.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: { in: events.map(event => `APPSEC_FINDING_${event.kind}`) } } })).toBe(6);
  await fs.mkdir(evidenceDir, { recursive: true });
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.locator('.appsec-evidence-history')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, `assigned-${width}.png`), fullPage: true });
  }
});

test('unassigned ADMIN and USER without grant remain read-only', async ({ page }) => {
  await login(page, fixture.readOnly);
  await expect(page.getByRole('button', { name: 'Submit evidence' })).toHaveCount(0);
  await expect(page.locator('.appsec-evidence-history li')).toHaveCount(1);
  expect((await api(page, `/appsec/findings/${fixture.finding.id}/lifecycle/evidence`, 'POST', { expectedRevision: 6, note: 'Denied' })).status).toBe(403);
  expect((await api(page, `/appsec/findings/${fixture.foreignFinding.id}`)).status).toBe(404);
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, `reader-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, fixture.admin);
  await expect(page.getByRole('button', { name: 'Submit evidence' })).toHaveCount(0);
  expect((await api(page, `/appsec/findings/${fixture.finding.id}/lifecycle/evidence`, 'POST', { expectedRevision: 6, note: 'Denied admin' })).status).toBe(403);
  expect((await api(page, `/appsec/findings/${fixture.finding.id}`, 'PATCH', { status: 'RESOLVED', resolution: 'Bypass' })).status).toBe(409);
});
