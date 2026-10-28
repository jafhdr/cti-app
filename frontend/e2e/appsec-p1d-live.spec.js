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
const evidenceDir = path.resolve(__dirname, '../test-results/appsec-p1d-live');
let app; let prisma; let fixture;
test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

test.beforeAll(async () => {
  const qa = process.env.APPSEC_P1D_QA_DB_NAME;
  if (!/^stake48_p1d_[0-9a-f]{10}$/.test(qa ?? '') || new URL(process.env.DATABASE_URL).pathname !== `/${qa}`) throw new Error('Expected isolated P1-D QA database');
  prisma = new PrismaClient();
  const nest = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, UsersModule, ModulesModule, AppSecModule] }).compile();
  app = nest.createNestApplication({ logger: false });
  app.use(cookieParser()); app.enableCors({ origin: frontend, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(3101, '127.0.0.1');
  const suffix = randomUUID(); const password = `QA-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(password, 4);
  const tenant = await prisma.tenant.create({ data: { name: 'P1D Live A', slug: `p1d-live-a-${suffix}` } });
  const foreignTenant = await prisma.tenant.create({ data: { name: 'P1D Live B', slug: `p1d-live-b-${suffix}` } });
  const module = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'appsec-posture' } });
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, renewalAt: new Date(Date.now() + 86400000), status: 'ACTIVE', customModules: { create: { moduleId: module.id } } } });
  await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
  async function account(name, role, tenantId, features = []) {
    const person = await prisma.user.create({ data: { name, email: `p1d-${name.toLowerCase()}-${suffix}@example.test`, passwordHash, role, tenantId } });
    if (features.length) await prisma.userModuleAccess.create({ data: { userId: person.id, tenantId, moduleId: module.id, featureKeys: features } });
    return person;
  }
  const admin = await account('Admin', 'ADMIN', tenant.id, ['finding-management']);
  const reader = await account('Reader', 'USER', tenant.id, ['finding-management']);
  const root = await account('Root', 'SUPER_ADMIN', null);
  const foreign = await account('Foreign', 'USER', foreignTenant.id);
  const application = await prisma.application.create({ data: { tenantId: tenant.id, name: 'P1D QA Application' } });
  const now = Date.now();
  async function finding(title, status, options = {}) {
    return prisma.appSecFinding.create({ data: { tenantId: tenant.id, applicationId: application.id, title, severity: 'HIGH', source: 'MANUAL', status,
      workflowVersion: options.workflowVersion ?? 2, assigneeId: options.assigneeId ?? null,
      verificationState: options.verificationState ?? null, dueDate: options.dueDate ?? null,
      createdAt: new Date(now - 86400000), firstSeenAt: new Date(now - 9 * 86400000),
      ...(status === 'RESOLVED' ? { resolution: 'QA close', resolvedAt: new Date(now) } : {}) } });
  }
  const open = await finding('P1D Overdue Open', 'OPEN', { assigneeId: admin.id, dueDate: new Date(now - 86400000) });
  await finding('P1D Awaiting Review', 'IN_PROGRESS', { assigneeId: admin.id, verificationState: 'REQUESTED' });
  await finding('P1D Legacy Closed', 'RESOLVED', { workflowVersion: 1, assigneeId: reader.id });
  fixture = { tenant, foreignTenant, admin, reader, root, foreign, open, password };
});
test.afterAll(async () => { if (app) await app.close(); if (prisma) await prisma.$disconnect(); });
async function login(page, person) {
  await page.goto(`${frontend}/login`);
  await page.getByLabel('Email address').fill(person.email);
  await page.locator('#password').fill(fixture.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto(`${frontend}/appsec/findings/operations`);
}
async function get(page, route) { return page.evaluate(async url => { const response = await fetch(url, { credentials: 'include' }); return { status: response.status, body: await response.json() }; }, backend + route); }

test('ADMIN and USER view reconciled operational queue and responsive report', async ({ page }) => {
  await login(page, fixture.admin);
  await expect(page.getByRole('heading', { name: 'Finding operations' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Operational metrics' }).getByText('Open', { exact: true })).toBeVisible();
  const metric = await get(page, '/appsec/findings/operational-metrics');
  expect(metric.status).toBe(200);
  expect(metric.body.totals.open).toBe(2);
  expect(metric.body.totals.overdue).toBe(1);
  expect(metric.body.totals.awaitingVerification).toBe(1);
  expect(metric.body.totals.resolved).toBe(1);
  expect(metric.body.owners.reduce((sum, owner) => sum + owner.open, 0)).toBe(2);
  await page.getByLabel('Queue overdue').selectOption('true');
  await expect(page.getByText('1 Findings · Page 1 of 1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'P1D Overdue Open' })).toBeVisible();
  await page.getByRole('link', { name: 'P1D Overdue Open' }).click();
  await expect(page.getByRole('heading', { name: 'P1D Overdue Open' })).toBeVisible();
  await page.goto(`${frontend}/appsec/findings/operations`);
  await expect(page.getByText('P1D Legacy Closed')).toBeVisible();
  await expect(page.getByText(/Legacy — verification not recorded/)).toBeVisible();
  await page.getByLabel('Current owner').selectOption(fixture.reader.id);
  await expect(page.getByText('1 Findings · Page 1 of 1')).toBeVisible();
  await expect(page.getByText('P1D Legacy Closed')).toBeVisible();
  await page.getByLabel('Current owner').selectOption('');
  await expect(page.getByText('3 Findings · Page 1 of 1')).toBeVisible();
  await fs.mkdir(evidenceDir, { recursive: true });
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.getByRole('heading', { name: 'Finding operations' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, `admin-${width}.png`), fullPage: true });
  }
  await login(page, fixture.reader);
  await expect(page.getByText('P1D Overdue Open')).toBeVisible();
  expect((await get(page, `/appsec/findings/queue?ownerId=${fixture.foreign.id}`)).body.total).toBe(0);
  const before = await prisma.auditLog.count({ where: { tenantId: fixture.tenant.id } });
  await page.reload();
  await expect(page.getByText('P1D Overdue Open')).toBeVisible();
  expect(await prisma.auditLog.count({ where: { tenantId: fixture.tenant.id } })).toBe(before);
});

test('selected SUPER_ADMIN clears prior tenant data; foreign USER receives no totals', async ({ page }) => {
  await login(page, fixture.root);
  await page.getByLabel('Tenant AppSec').selectOption(fixture.tenant.id);
  await expect(page.getByText('P1D Overdue Open')).toBeVisible();
  await page.getByLabel('Tenant AppSec').selectOption(fixture.foreignTenant.id);
  await expect(page.getByText('P1D Overdue Open')).toHaveCount(0);
  await expect(page.getByText('Akses ke fitur ini ditolak.')).toBeVisible();
  await login(page, fixture.foreign);
  expect((await get(page, '/appsec/findings/operational-metrics')).status).toBe(403);
  await expect(page.getByText('P1D Overdue Open')).toHaveCount(0);
});
