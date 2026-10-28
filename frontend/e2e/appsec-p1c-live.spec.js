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
const evidenceDir = path.resolve(__dirname, '../test-results/appsec-p1c-live');
let app;
let prisma;
let fixture;

test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

test.beforeAll(async () => {
  const qa = process.env.APPSEC_P1C_QA_DB_NAME;
  if (!/^stake47_p1c_[0-9a-f]{10}$/.test(qa ?? '') || new URL(process.env.DATABASE_URL).pathname !== `/${qa}`) throw new Error('Expected isolated P1-C QA database');
  if (process.env.APPSEC_V2_VERIFICATION_ENABLED !== 'true') throw new Error('P1-C QA rollout disabled');
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
  const tenant = await prisma.tenant.create({ data: { name: 'P1C Live', slug: `p1c-live-${suffix}` } });
  const foreignTenant = await prisma.tenant.create({ data: { name: 'P1C Foreign', slug: `p1c-foreign-${suffix}` } });
  const module = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'appsec-posture' }, include: { features: true } });
  expect(module.features.map(item => item.key)).toContain('finding-review');
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, renewalAt: new Date(Date.now() + 86400000), status: 'ACTIVE', customModules: { create: { moduleId: module.id } } } });
  await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
  async function account(name, role, tenantId, features) {
    const user = await prisma.user.create({ data: { name, email: `${name.toLowerCase().replaceAll(' ', '-')}-${suffix}@example.test`, passwordHash, role, tenantId } });
    if (features.length) await prisma.userModuleAccess.create({ data: { userId: user.id, tenantId, moduleId: module.id, featureKeys: features } });
    return user;
  }
  const admin = await account('P1C Admin', 'ADMIN', tenant.id, ['finding-management', 'finding-review']);
  const assignee = await account('P1C Assignee', 'USER', tenant.id, ['finding-management', 'finding-remediation-submit']);
  const reviewer = await account('P1C Reviewer', 'USER', tenant.id, ['finding-management', 'finding-review']);
  const reader = await account('P1C Reader', 'USER', tenant.id, ['finding-management']);
  const foreign = await account('P1C Foreign', 'USER', foreignTenant.id, []);
  const application = await prisma.application.create({ data: { tenantId: tenant.id, name: 'P1C QA Application' } });
  const finding = await prisma.appSecFinding.create({ data: { tenantId: tenant.id, applicationId: application.id, title: 'P1C Live Finding', severity: 'MEDIUM', source: 'MANUAL', status: 'OPEN' } });
  fixture = { tenant, foreignTenant, admin, assignee, reviewer, reader, foreign, finding, password };
});

test.afterAll(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
});

async function login(page, person, openFinding = true) {
  await page.goto(`${frontend}/login`);
  await page.getByLabel('Email address').fill(person.email);
  await page.locator('#password').fill(fixture.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  if (openFinding) {
    await page.goto(`${frontend}/appsec/findings/${fixture.finding.id}`);
    await expect(page.getByRole('heading', { name: fixture.finding.title })).toBeVisible();
  }
}

async function api(page, route, method = 'GET', data) {
  return page.evaluate(async ({ url, method, data }) => {
    const response = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  }, { url: backend + route, method, data });
}

test('authenticated P1-C workflow and independent closure', async ({ page }) => {
  await login(page, fixture.admin);
  await page.getByLabel('Triage reason').fill('P1C QA activation');
  await page.getByRole('button', { name: 'Activate V2 triage' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'PENDING' })).toBeVisible();
  await page.getByLabel('Triage reason').fill('Validated by admin');
  await page.getByRole('button', { name: 'Record validation' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'VALID' })).toBeVisible();
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.getByLabel('Triage reason').fill('High priority QA');
  await page.getByRole('button', { name: 'Set priority' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'HIGH' })).toBeVisible();
  await page.getByLabel('Assignee').selectOption(fixture.assignee.id);
  await page.getByRole('button', { name: 'Save assignment' }).click();
  await expect(page.getByRole('button', { name: 'Approve verification' })).toHaveCount(0);
  await login(page, fixture.assignee);
  await page.getByRole('button', { name: 'Start remediation' }).click();
  await page.getByLabel('Evidence note').fill('P1C first remediation evidence');
  await page.getByRole('button', { name: 'Submit evidence' }).click();
  await expect(page.locator('.appsec-facts dt:has-text("Revision") + dd')).toHaveText('6');
  await page.getByLabel('Verification summary').fill('Ready for independent review');
  await page.getByRole('button', { name: 'Request verification' }).click();
  await expect(page.getByText('Waiting for an independent reviewer.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve verification' })).toHaveCount(0);
  const pending = await prisma.appSecFinding.findUniqueOrThrow({ where: { id: fixture.finding.id } });
  expect((await api(page, `/appsec/findings/${pending.id}/lifecycle/verify`, 'POST', { expectedRevision: pending.revision, decision: 'APPROVE', note: 'Self review' })).status).toBe(403);
  await login(page, fixture.reviewer);
  await expect(page.locator('.appsec-review-context').getByText('P1C first remediation evidence')).toBeVisible();
  await page.getByLabel('Reviewer decision note').fill('Need additional remediation evidence');
  await page.getByRole('button', { name: 'Reject verification' }).click();
  await expect(page.getByText(/Verification rejected/)).toBeVisible();
  await login(page, fixture.assignee);
  await page.getByLabel('Evidence note').fill('P1C fresh remediation evidence');
  await page.getByRole('button', { name: 'Submit evidence' }).click();
  await expect(page.locator('.appsec-facts dt:has-text("Revision") + dd')).toHaveText('9');
  await page.getByLabel('Verification summary').fill('Fresh evidence ready');
  await page.getByRole('button', { name: 'Request verification' }).click();
  await login(page, fixture.reviewer);
  await page.getByLabel('Reviewer decision note').fill('Fresh evidence independently confirmed');
  await page.getByRole('button', { name: 'Approve verification' }).click();
  await page.getByRole('button', { name: 'Approve and resolve' }).click();
  await expect(page.getByText(/Independently verified and resolved/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Independently verified and resolved/)).toBeVisible();
  const record = await prisma.appSecFinding.findUniqueOrThrow({ where: { id: fixture.finding.id } });
  expect(record.status).toBe('RESOLVED');
  expect(record.verificationState).toBe('APPROVED');
  const events = await prisma.appSecFindingActionEvent.findMany({ where: { findingId: record.id }, orderBy: { revision: 'asc' } });
  expect(events.map(event => event.kind)).toEqual(['ACTIVATED', 'VALIDATED', 'PRIORITY_SET', 'ASSIGNED', 'REMEDIATION_STARTED', 'EVIDENCE_SUBMITTED', 'VERIFICATION_REQUESTED', 'VERIFICATION_REJECTED', 'EVIDENCE_SUBMITTED', 'VERIFICATION_REQUESTED', 'VERIFIED_RESOLVED']);
  expect(await prisma.auditLog.count({ where: { tenantId: fixture.tenant.id, action: { in: events.map(event => `APPSEC_FINDING_${event.kind}`) } } })).toBe(events.length);
  await fs.mkdir(evidenceDir, { recursive: true });
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.locator('.appsec-verification')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, `reviewer-${width}.png`), fullPage: true });
  }
});

test('terminal decisions, reopening, read-only grant and tenant isolation', async ({ page }) => {
  await login(page, fixture.admin);
  await page.getByRole('button', { name: 'Reopen Finding' }).click();
  await page.getByLabel('Decision reason').fill('New validation cycle');
  await page.getByRole('button', { name: 'Reopen', exact: true }).last().click();
  await expect(page.locator('.appsec-verification dd').filter({ hasText: /^2$/ })).toBeVisible();
  const reopened = await prisma.appSecFinding.findUniqueOrThrow({ where: { id: fixture.finding.id } });
  expect(reopened.status).toBe('OPEN');
  expect(reopened.lifecycleCycle).toBe(2);
  await page.getByLabel('Triage reason').fill('Second cycle valid');
  await page.getByRole('button', { name: 'Record validation' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'VALID' })).toBeVisible();
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.getByLabel('Triage reason').fill('Second cycle priority');
  await page.getByRole('button', { name: 'Set priority' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'HIGH' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept risk' }).click();
  await page.getByLabel('Decision reason').fill('Documented temporary risk acceptance');
  await page.getByLabel('Review due date').fill('2027-12-01');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByText(/Risk accepted/)).toBeVisible();
  await page.getByRole('button', { name: 'Reopen Finding' }).click();
  await page.getByLabel('Decision reason').fill('Reconsider accepted risk');
  await page.getByRole('button', { name: 'Reopen', exact: true }).last().click();
  await expect(page.locator('.appsec-verification dd').filter({ hasText: /^3$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Approve false positive' }).click();
  await page.getByLabel('Decision reason').fill('Independent analysis shows false alarm');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByText(/False positive approved/)).toBeVisible();
  await login(page, fixture.reader);
  await expect(page.getByRole('button', { name: 'Approve verification' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept risk' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reopen Finding' })).toHaveCount(0);
  expect((await api(page, `/appsec/findings/${reopened.id}/lifecycle/accept-risk`, 'POST', { expectedRevision: reopened.revision, reason: 'Denied', reviewDueAt: '2027-12-01' })).status).toBe(403);
  await login(page, fixture.foreign, false);
  expect((await api(page, `/appsec/findings/${reopened.id}`)).status).toBe(403);
});
