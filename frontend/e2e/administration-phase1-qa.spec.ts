import { expect, test, type Page } from '@playwright/test';

const app = process.env.ADMIN_APP_URL || 'http://localhost:3000';
const evidence = '../.omo/evidence/administration/phase1';
const admin = { id: 'root', name: 'Platform Admin', email: 'admin@example.test', role: 'SUPER_ADMIN', tenantId: null, tenant: null, moduleAccess: [] };
const tenant = { id: 'org-a', name: 'Northstar Security', slug: 'northstar', isActive: true, deactivatedAt: null, createdAt: '2026-09-01T00:00:00Z', _count: { users: 2, indicators: 3 } };
const user = { id: 'user-a', name: 'Alya Pratama', email: 'alya@example.test', role: 'USER', tenantId: tenant.id, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }, isActive: true, createdAt: '2026-09-02T00:00:00Z' };
const module = { id: 'asm', slug: 'attack-surface-management', name: 'Attack Surface Management', description: 'Asset inventory and discovery.', category: 'APPSEC', isActive: true, tenantEnabled: true, subscriptionIncluded: true, subscriptionActive: true, subscriptionSource: 'Team', roleAccess: { ADMIN: true, USER: true }, policyAccess: { ADMIN: { accessible: true, reason: null }, USER: { accessible: true, reason: null } }, features: [{ id: 'feature-a', key: 'asset-management', name: 'Asset Management' }] };

async function fixture(page: Page) {
  await page.route('**/auth/me', route => route.fulfill({ json: admin }));
  await page.route(/http:\/\/localhost:3001\/users\/tenants$/, route => route.fulfill({ json: [tenant] }));
  await page.route(/http:\/\/localhost:3001\/users\/user-a\/module-access$/, route => route.fulfill({ json: [{ ...module, assigned: true, accessible: false, assignable: true, roleAllowed: true, reason: 'Tenant entitlement inactive', featureKeys: ['asset-management'] }] }));
  await page.route(/http:\/\/localhost:3001\/users\?(?:.*)$/, route => route.fulfill({ json: [user] }));
  await page.route(/http:\/\/localhost:3001\/users$/, route => route.fulfill({ json: [user] }));
  await page.route(/http:\/\/localhost:3001\/tenants$/, route => route.fulfill({ json: [tenant] }));
  await page.route(/http:\/\/localhost:3001\/modules\/configuration(?:\?.*)?$/, route => route.fulfill({ json: [module] }));
  await page.route(/http:\/\/localhost:3001\/modules$/, route => route.fulfill({ json: [module] }));
}

for (const target of [
  { path: '/administration', file: 'admin', heading: 'Platform administration.' },
  { path: '/users', file: 'users', heading: 'People and permissions' },
  { path: '/tenants', file: 'organizations', heading: 'Organizations in your platform' },
  { path: '/modules', file: 'modules', heading: 'Module Management' },
]) test(`${target.file} themes and responsive`, async ({ page }) => {
  await fixture(page);
  for (const state of [
    { theme: 'dark', width: 1440, suffix: 'dark-1440' },
    { theme: 'light', width: 1440, suffix: 'light-1440' },
    { theme: 'dark', width: 768, suffix: 'tablet-768' },
    { theme: 'dark', width: 375, suffix: 'mobile-375' },
    { theme: 'system-dark', width: 1440, suffix: 'system-dark-1440' },
    { theme: 'system-light', width: 1440, suffix: 'system-light-1440' },
    { theme: 'system-dark', width: 768, suffix: 'system-dark-768' },
    { theme: 'system-light', width: 768, suffix: 'system-light-768' },
    { theme: 'system-dark', width: 375, suffix: 'system-dark-375' },
    { theme: 'system-light', width: 375, suffix: 'system-light-375' },
  ]) {
    await page.setViewportSize({ width: state.width, height: 900 });
    await page.emulateMedia({ colorScheme: state.theme.endsWith('light') ? 'light' : 'dark' });
    await page.addInitScript(theme => localStorage.setItem('cti-theme', theme), state.theme.startsWith('system') ? 'system' : state.theme);
    await page.goto(`${app}${target.path}`);
    await expect(page.getByRole('heading', { name: target.heading })).toBeVisible();
    if (target.file === 'admin') await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/${target.file}-${state.suffix}.png`, fullPage: true });
  }
});

test('user filters and effective access remain distinct', async ({ page }) => {
  await fixture(page);
  await page.goto(`${app}/users`);
  await expect(page.getByText('Alya Pratama')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search' }).fill('missing');
  await expect(page.getByText('No users match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('region', { name: 'User detail Alya Pratama' })).toBeVisible();
  await page.getByRole('button', { name: 'View assigned and accessible modules' }).click();
  await expect(page.getByText('Not Accessible', { exact: true })).toBeVisible();
  await expect(page.getByText('Yes', { exact: true }).first()).toBeVisible();
});

test('organization and module details use returned policy', async ({ page }) => {
  await fixture(page);
  await page.goto(`${app}/tenants`);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Organization detail Northstar Security' })).toBeVisible();
  await expect(page.getByText('Tenant: Enabled')).toBeVisible();
  await page.goto(`${app}/modules`);
  await page.getByRole('button', { name: 'View module detail' }).click();
  await expect(page.getByRole('heading', { name: 'Attack Surface Management' }).last()).toBeVisible();
});

test('system theme and forbidden states', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => localStorage.setItem('cti-theme', 'system'));
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ['/administration', '/users', '/tenants', '/modules']) {
      await page.goto(`${app}${path}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    }
  }
  await page.unroute('**/auth/me');
  await page.route('**/auth/me', route => route.fulfill({ json: { ...admin, role: 'USER' } }));
  for (const path of ['/administration', '/users', '/tenants', '/modules']) {
    await page.goto(`${app}${path}`);
    await expect(page.getByText('You don’t have permission to access this area.')).toBeVisible();
  }
});

test('assigned module obeys effective accessibility in sidebar and route guard', async ({ page }) => {
  const access = { moduleId: 'asm', moduleSlug: 'attack-surface-management', moduleName: 'Attack Surface Management', assigned: true, accessible: false, featureKeys: ['asset-management'] };
  await page.route('**/auth/me', route => route.fulfill({ json: { ...admin, role: 'ADMIN', tenantId: tenant.id, moduleAccess: [access] } }));
  await page.route('**/dashboard/summary', route => route.fulfill({ json: { dashboardMode: 'PERSONAL', tenantName: tenant.name, indicators: 0, highRiskIndicators: 0, activeAlerts: 0, openCases: 0, users: 0, myIndicatorsCreated: 0, sources: 0, campaigns: 0, subscription: { plan: 'QA', status: 'ACTIVE' }, recentActivity: [], tenantOverview: [] } }));
  await page.goto(`${app}/dashboard`);
  await expect(page.getByRole('button', { name: 'Attack Surface Management', exact: true })).toHaveCount(0);
  await page.goto(`${app}/attack-surface/assets`);
  await expect(page.getByText('Access denied')).toBeVisible();
  await page.unroute('**/auth/me');
  await page.route('**/auth/me', route => route.fulfill({ json: { ...admin, role: 'ADMIN', tenantId: tenant.id, moduleAccess: [{ ...access, accessible: true }] } }));
  await page.goto(`${app}/dashboard`);
  await expect(page.getByRole('button', { name: 'Attack Surface Management', exact: true })).toBeVisible();
});

test('create controls submit existing user, organization, and module API shapes', async ({ page }) => {
  await fixture(page);
  let userCreated = false;
  await page.route('http://localhost:3001/users', route => {
    if (route.request().method() === 'POST') {
      const body: unknown = route.request().postDataJSON();
      expect(body).toMatchObject({ name: 'Mira Ananda', email: 'mira@example.test', role: 'USER', tenantId: tenant.id });
      userCreated = true;
      return route.fulfill({ json: { ...user, id: 'user-b', name: 'Mira Ananda', email: 'mira@example.test' } });
    }
    return route.fulfill({ json: [user] });
  });
  await page.goto(`${app}/users`);
  await page.getByRole('button', { name: 'Add user' }).click();
  await page.getByLabel('Nama *').fill('Mira Ananda');
  await page.getByLabel('Email *').fill('mira@example.test');
  await page.getByLabel('Password * (min. 8 karakter)').fill('fixture-password-only');
  await page.getByLabel('Tenant *').selectOption(tenant.id);
  await page.getByRole('button', { name: 'Create User' }).click();
  await expect(page.getByText('User mira@example.test berhasil dibuat.')).toBeVisible();
  expect(userCreated).toBe(true);

  let tenantCreated = false;
  await page.route('http://localhost:3001/tenants', route => {
    if (route.request().method() === 'POST') {
      const body: unknown = route.request().postDataJSON();
      expect(body).toMatchObject({ name: 'Fixture Labs', slug: 'fixture-labs', adminEmail: 'admin@fixture.test' });
      tenantCreated = true;
      return route.fulfill({ json: { tenant: { name: 'Fixture Labs' }, admin: { email: 'admin@fixture.test' } } });
    }
    return route.fulfill({ json: [tenant] });
  });
  await page.goto(`${app}/tenants`);
  await page.getByRole('button', { name: 'Create New Tenant' }).click();
  await page.getByPlaceholder('Contoh: PT Maju Jaya').fill('Fixture Labs');
  await page.getByPlaceholder('Nama lengkap admin').fill('Fixture Admin');
  await page.getByPlaceholder('admin@tenant.com').fill('admin@fixture.test');
  await page.getByPlaceholder('Minimal 8 karakter').fill('fixture-password-only');
  await page.getByRole('button', { name: 'Buat Tenant', exact: true }).click();
  await expect(page.getByText(/Fixture Labs.*berhasil dibuat/)).toBeVisible();
  expect(tenantCreated).toBe(true);

  let moduleCreated = false;
  await page.route('http://localhost:3001/modules', route => {
    if (route.request().method() === 'POST') {
      const body: unknown = route.request().postDataJSON();
      expect(body).toMatchObject({ name: 'Fixture Module', slug: 'fixture-module', category: 'CTI' });
      moduleCreated = true;
      return route.fulfill({ json: { ...module, name: 'Fixture Module', slug: 'fixture-module' } });
    }
    return route.fulfill({ json: [module] });
  });
  await page.goto(`${app}/modules`);
  await page.getByRole('button', { name: 'Tambah modul' }).click();
  await page.getByPlaceholder('Nama modul').fill('Fixture Module');
  await page.getByPlaceholder('slug-modul').fill('fixture-module');
  await page.getByPlaceholder('Deskripsi modul').fill('Fixture description');
  await page.getByRole('button', { name: 'Simpan modul' }).click();
  await expect(page.getByText('Modul baru berhasil dibuat.')).toBeVisible();
  expect(moduleCreated).toBe(true);
});

test('switching organizations never shows a prior organization policy', async ({ page }) => {
  const second = { ...tenant, id: 'org-b', name: 'Southline Labs', slug: 'southline' };
  await fixture(page);
  await page.route('http://localhost:3001/tenants', route => route.fulfill({ json: [tenant, second] }));
  await page.route(/http:\/\/localhost:3001\/modules\/configuration\?.*/, async route => {
    const requested = new URL(route.request().url()).searchParams.get('tenantId');
    if (requested === tenant.id) await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ json: [{ ...module, id: requested === tenant.id ? 'old-policy' : 'new-policy', name: requested === tenant.id ? 'Old Tenant Module' : 'New Tenant Module' }] });
  });
  await page.goto(`${app}/tenants`);
  await page.getByRole('row', { name: /Northstar Security/ }).getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('row', { name: /Southline Labs/ }).getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Organization detail Southline Labs' })).toContainText('New Tenant Module');
  await page.waitForTimeout(400);
  await expect(page.getByRole('region', { name: 'Organization detail Southline Labs' })).not.toContainText('Old Tenant Module');
});
