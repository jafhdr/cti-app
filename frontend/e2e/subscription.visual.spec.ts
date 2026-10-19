import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const app = 'http://localhost:3000';

const tenant = { id: 'subscription-visual-tenant', name: 'Visual QA Tenant' };
const module = { id: 'module-1', slug: 'threat-intelligence', name: 'Threat Intelligence', description: 'Threat intelligence', features: [] };
const community = { id: 'community', name: 'Community', description: 'Community plan', type: 'PREDEFINED', priceMonthly: 0, priceYearly: 0, modules: [{ moduleId: module.id, module }] };
const custom = { id: 'custom', name: 'Custom Package', description: 'Custom plan', type: 'CUSTOM', priceMonthly: 100, priceYearly: 1000, modules: [{ moduleId: module.id, modulePriceMonthly: 100, modulePriceYearly: 1000, module }] };
const current = { id: 'subscription-1', isCustom: false, billingCycle: 'MONTHLY', priceMonthly: 0, priceYearly: 0, status: 'ACTIVE', persistedStatus: 'ACTIVE', subscribedAt: '2026-10-01T00:00:00.000Z', renewalAt: '2026-11-01T00:00:00.000Z', package: community, subscriptionActive: true, includedModules: [{ id: module.id, name: module.name, subscriptionIncluded: true }], customModules: [] };

async function adminFixture(page: import('@playwright/test').Page) {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'admin-1', email: 'admin@example.test', role: 'ADMIN', tenant, moduleAccess: [] } }));
}

async function loginSuperAdmin(page: import('@playwright/test').Page) {
  const response = await page.request.post(`${api}/auth/login`, { data: { email: 'superadmin@cti.local', password: 'SuperAdmin123!' } });
  expect(response.ok()).toBeTruthy();
}

test('subscription package and custom states', async ({ page }) => {
  await adminFixture(page);
  let subscription = current;
  await page.route('**/subscription/packages', route => route.fulfill({ json: [community, custom] }));
  await page.route('**/subscription/my', route => route.fulfill({ json: subscription }));
  await page.route(/localhost:3001\/subscription$/, async route => {
    const body: { isCustom?: boolean } = route.request().postDataJSON();
    subscription = { ...current, isCustom: Boolean(body.isCustom), package: body.isCustom ? custom : community };
    await route.fulfill({ status: 201, json: subscription });
  });
  await page.goto(`${app}/subscription`);
  await expect(page.getByRole('heading', { name: 'Subscription', exact: true })).toBeVisible();
  await expect(page.getByRole('article').getByRole('heading', { name: 'Community' })).toBeVisible();
  await expect(page.getByLabel('Subscription saat ini').getByRole('heading', { name: 'Community' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '../.omo/evidence/subscription/desktop-packages.png', fullPage: true });
  await page.getByRole('tab', { name: 'Custom Packages' }).click();
  await page.locator('.custom-module').first().click();
  await expect(page.getByText('Rincian harga')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/subscription/desktop-custom.png', fullPage: true });
  await page.getByRole('button', { name: 'Aktifkan Subscription' }).click();
  await page.getByRole('dialog', { name: 'Ganti subscription tenant' }).getByRole('button', { name: 'Ganti subscription' }).click();
  await expect(page.getByText('Subscription berhasil diperbarui.')).toBeVisible();
  await expect(page.getByLabel('Subscription saat ini').getByRole('heading', { name: 'Custom Subscription' })).toBeVisible();
  await page.getByRole('tab', { name: 'Subscription Packages' }).click();
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Community' }) }).getByRole('button', { name: 'Choose Plan' }).click();
  await page.getByRole('dialog', { name: 'Ganti subscription tenant' }).getByRole('button', { name: 'Ganti subscription' }).click();
  await expect(page.getByLabel('Subscription saat ini').getByRole('heading', { name: 'Community' })).toBeVisible();
  await page.getByRole('tab', { name: 'Subscription Packages' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Custom Packages' })).toHaveAttribute('aria-selected', 'true');
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../.omo/evidence/subscription/custom-${width}.png`, fullPage: true });
  }
});

test('user module assignment panel', async ({ page }) => {
  await adminFixture(page);
  const user = { id: 'user-1', name: 'Visual QA User', email: 'user@example.test', role: 'USER', isActive: true, tenantId: tenant.id, tenant };
  const access = { ...module, subscriptionActive: true, subscriptionIncluded: true, isActive: true, tenantEnabled: true, roleAllowed: true, assignable: true, assigned: true, accessible: true, reason: null, featureKeys: [], features: [] };
  await page.route('**/users/tenants', route => route.fulfill({ json: [tenant] }));
  await page.route(/\/users\?/, route => route.fulfill({ json: [user] }));
  await page.route('**/users/user-1/module-access', route => route.fulfill({ json: [access] }));
  await page.goto(`${app}/users`);
  await expect(page.getByRole('heading', { name: /Users/ })).toBeVisible();
  const accessButton = page.locator('button:has-text("Akses Modul"):not([disabled])').first();
  await expect(accessButton).toBeEnabled();
  await accessButton.click();
  await expect(page.getByRole('heading', { name: /Akses Modul:/ })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/subscription/desktop-user-access.png', fullPage: true });
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../.omo/evidence/subscription/user-access-${width}.png`, fullPage: true });
  }
  await page.route('**/users/user-1/module-access', route => route.fulfill({ json: [access] }));
  await page.getByRole('button', { name: 'Simpan Akses Modul' }).click();
  await expect(page.getByText(/Akses modul .* berhasil diperbarui/)).toBeVisible();
  await accessButton.click();
  await expect(page.locator('.access-module input[type="checkbox"]').first()).toBeChecked();
});

test('super admin can access modules and switch subscription tenant', async ({ page }) => {
  await loginSuperAdmin(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/indicators`);
  await expect(page.getByRole('heading', { name: 'Track known malicious infrastructure.' })).toBeVisible();
  await expect(page).toHaveURL(`${app}/indicators`);
  await page.goto(`${app}/subscription`);
  await expect(page.getByText('SUPER ADMIN', { exact: true })).toBeVisible();
  const tenantSelector = page.getByLabel('Kelola tenant');
  await expect(tenantSelector).toBeVisible();
  await expect.poll(() => tenantSelector.locator('option').count()).toBeGreaterThan(1);
  const currentPlan = page.getByLabel('Subscription saat ini').getByRole('heading');
  const initialPlan = await currentPlan.textContent();
  const secondTenant = await tenantSelector.locator('option').nth(1).getAttribute('value');
  expect(secondTenant).toBeTruthy();
  await tenantSelector.selectOption(secondTenant ?? '');
  await expect(tenantSelector).toHaveValue(secondTenant ?? '');
  await expect(currentPlan).not.toHaveText(initialPlan ?? '');
  await page.screenshot({ path: '../.omo/evidence/subscription/desktop-super-admin.png', fullPage: true });
});
