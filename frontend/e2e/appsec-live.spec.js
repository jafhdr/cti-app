const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const bcrypt = require('../../backend/node_modules/bcrypt');
require('../../backend/node_modules/dotenv').config({ path: '../backend/.env' });
const api = 'http://localhost:3001';
const web = 'http://localhost:3000';

test('live AppSec browser uses Nest and PostgreSQL without interception', async ({ page }) => {
  test.setTimeout(120000);
  const prisma = new PrismaClient();
  const marker = randomUUID();
  const appName = `Live Portal ${marker.slice(0, 8)}`;
  const findingTitle = `Live Finding ${marker.slice(0, 8)}`;
  let tenant, foreignTenant;
  const accounts = [];
  try {
    tenant = await prisma.tenant.create({ data: { name: `AppSec Live ${marker}`, slug: `appsec-live-${marker}` } });
    foreignTenant = await prisma.tenant.create({ data: { name: `AppSec Foreign ${marker}`, slug: `appsec-foreign-${marker}` } });
    const modules = await prisma.appModule.findMany({ where: { slug: { in: ['appsec-posture', 'attack-surface-management', 'threat-intelligence', 'case-management'] } } });
    expect(modules).toHaveLength(4);
    await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, isCustom: true, billingCycle: 'MONTHLY', priceMonthly: 0, status: 'ACTIVE', renewalAt: new Date(Date.now() + 86400000), customModules: { create: modules.map(item => ({ moduleId: item.id })) } } });
    for (const item of modules) await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: item.id, isEnabled: true, access: { create: [{ role: 'ADMIN', isAllowed: true }, { role: 'USER', isAllowed: true }] } } });
    const password = `Qa-${marker}`;
    const hash = await bcrypt.hash(password, 4);
    for (const role of ['ADMIN', 'USER']) accounts.push(await prisma.user.create({ data: { name: `Live ${role}`, email: `live-${role.toLowerCase()}-${marker}@example.test`, passwordHash: hash, role, tenantId: tenant.id } }));
    const denied = await prisma.user.create({ data: { name: 'Denied', email: `live-denied-${marker}@example.test`, passwordHash: hash, role: 'USER', tenantId: tenant.id } }); accounts.push(denied);
    for (const account of accounts.slice(0, 2)) for (const item of modules) await prisma.userModuleAccess.create({ data: { userId: account.id, tenantId: tenant.id, moduleId: item.id, featureKeys: item.slug === 'appsec-posture' ? ['posture-overview', 'application-inventory', 'finding-management'] : item.slug === 'attack-surface-management' ? ['asset-management'] : item.slug === 'threat-intelligence' ? ['intelligence-hub'] : ['case-workflow'] } });
    const asset = await prisma.asset.create({ data: { tenantId: tenant.id, name: 'Live Asset', type: 'DOMAIN', value: `live-${marker.slice(0, 8)}.example.test` } });
    const vulnerability = await prisma.vulnerability.create({ data: { tenantId: tenant.id, cveId: `CVE-2026-${marker.slice(0, 8)}`, name: 'Live CVE', severity: 'HIGH' } });
    await page.goto(`${web}/login`);
    await page.getByLabel('Email address').fill('superadmin@cti.local');
    await page.locator('#password').fill('SuperAdmin123!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 800, downloadThroughput: 1000000, uploadThroughput: 1000000 });
    await page.goto(`${web}/appsec`);
    await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Memuat AppSec...' })).toBeVisible();
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.getByLabel('Tenant AppSec').selectOption(tenant.id);
    await expect(page.getByRole('heading', { name: 'Application posture' })).toBeVisible();
    await expect(page.getByText('No applications yet')).toBeVisible();
    await page.goto(`${web}/appsec/applications`);
    await page.getByRole('button', { name: 'Create application' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create application' }).click();
    expect(await page.getByRole('dialog').getByLabel('Name *').evaluate(input => input.validity.valueMissing)).toBeTruthy();
    await page.getByRole('dialog').getByLabel('Name *').fill(appName);
    await page.getByRole('dialog').getByRole('button', { name: 'Create application' }).click();
    await expect(page.getByRole('link', { name: appName })).toBeVisible();
    const application = await prisma.application.findFirstOrThrow({ where: { tenantId: tenant.id, name: appName } });
    await page.getByRole('link', { name: appName }).click();
    await page.getByRole('button', { name: 'Edit application' }).click();
    await page.getByRole('dialog').getByLabel('Owner').fill('Live QA');
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Live QA')).toBeVisible();
    await page.getByRole('button', { name: 'Link Asset' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.getByText(asset.value)).toBeVisible();
    await page.goto(`${web}/appsec/findings`);
    await page.getByRole('button', { name: 'Create finding' }).click();
    await page.getByRole('dialog').getByLabel('Application *').selectOption(application.id);
    await page.getByRole('dialog').getByLabel('Title *').fill(findingTitle);
    await page.getByRole('dialog').getByRole('button', { name: 'Create finding' }).click();
    await expect(page.getByRole('link', { name: findingTitle })).toBeVisible();
    const finding = await prisma.appSecFinding.findFirstOrThrow({ where: { tenantId: tenant.id, title: findingTitle } });
    await page.getByRole('link', { name: findingTitle }).click();
    await page.getByRole('button', { name: 'Edit finding' }).click();
    await page.getByRole('dialog').getByLabel('Remediation note').fill('Live review');
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Live review')).toBeVisible();
    await page.getByLabel('Vulnerability').selectOption(vulnerability.id);
    await page.getByRole('button', { name: 'Link vulnerability' }).click();
    await expect(page.getByText(vulnerability.cveId)).toBeVisible();
    await page.getByRole('button', { name: 'Create Case' }).click();
    await expect(page.getByRole('link', { name: /Open Case:/ })).toBeVisible();
    const caseCount = await prisma.case.count({ where: { tenantId: tenant.id } });
    expect((await page.request.post(`${api}/appsec/findings/${finding.id}/case?tenantId=${tenant.id}`)).status()).toBe(201);
    expect(await prisma.case.count({ where: { tenantId: tenant.id } })).toBe(caseCount);
    await page.getByLabel('Change status').selectOption('RESOLVED');
    await page.getByLabel('Resolution', { exact: true }).fill('Fixed');
    await page.getByRole('button', { name: 'Update status' }).click();
    await page.getByLabel('Change status').selectOption('OPEN');
    await page.getByRole('button', { name: 'Update status' }).click();
    await page.goto(`${web}/appsec`);
    await expect(page.getByRole('link', { name: appName })).toBeVisible();
    const posture = await (await page.request.get(`${api}/appsec/posture?tenantId=${tenant.id}`)).json();
    expect(posture.applications.total).toBe(1);
    expect(posture.findings.total).toBe(1);
    mkdirSync('../.omo/evidence/appsec-v1-live', { recursive: true });
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${web}/appsec/findings/${finding.id}`);
      await expect(page.getByRole('heading', { name: findingTitle })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBeTruthy();
      await page.screenshot({ path: `../.omo/evidence/appsec-v1-live/finding-${width}.png`, fullPage: true });
    }
    expect((await page.request.get(`${api}/appsec/posture?tenantId=${tenant.id}`)).status()).toBe(200);
    const anonymous = await page.context().browser().newContext();
    expect((await anonymous.request.get(`${api}/appsec/findings/${finding.id}`)).status()).toBe(401);
    await anonymous.close();
    const [admin, user] = accounts;
    for (const [account, canEdit] of [[admin, true], [user, false], [denied, false]]) {
      const context = await page.context().browser().newContext();
      const actorPage = await context.newPage();
      expect((await actorPage.request.post(`${api}/auth/login`, { data: { email: account.email, password } })).status()).toBe(201);
      await actorPage.goto(`${web}/appsec/findings/${finding.id}`);
      if (account === denied) await expect(actorPage.locator('main[role=alert]')).toContainText('Akses AppSec');
      else {
        await expect(actorPage.getByRole('heading', { name: findingTitle })).toBeVisible();
        await expect(actorPage.getByRole('button', { name: 'Edit finding' })).toHaveCount(canEdit ? 1 : 0);
        expect((await actorPage.request.patch(`${api}/appsec/findings/${finding.id}`, { data: { title: findingTitle } })).status()).toBe(canEdit ? 200 : 403);
        expect((await actorPage.request.get(`${api}/appsec/findings?tenantId=${foreignTenant.id}`)).status()).toBe(403);
      }
      await context.close();
    }
    expect((await page.request.get(`${api}/appsec/applications/${application.id}?tenantId=${foreignTenant.id}`)).status()).toBe(404);
  } finally {
    if (tenant) {
      await prisma.case.deleteMany({ where: { tenantId: tenant.id } });
      for (const account of accounts) await prisma.user.delete({ where: { id: account.id } });
      await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
      if (foreignTenant) await prisma.tenant.delete({ where: { id: foreignTenant.id } });
    }
    await prisma.$disconnect();
  }
});
