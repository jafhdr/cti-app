import { expect, test, type Page } from '@playwright/test';

const base = 'http://localhost:3000';
const evidence = '../.omo/evidence/administration-subscription/modal-migration';
const admin = { id: 'root', role: 'SUPER_ADMIN', email: 'root@example.test', tenant: null, moduleAccess: [] };
const tenant = { id: 'tenant-1', name: 'Fixture Labs', slug: 'fixture-labs', isActive: true, createdAt: '2026-09-01T00:00:00Z', _count: { users: 1, indicators: 0 } };
const user = { id: 'user-1', name: 'Alya', email: 'alya@example.test', role: 'USER', isActive: true, tenantId: tenant.id, tenant };
const module = { id: 'module-1', name: 'Threat Intelligence', slug: 'threat-intelligence', description: 'Intel', isActive: true, tenantEnabled: true, subscriptionIncluded: true, roleAccess: { ADMIN: true, USER: true }, policyAccess: { ADMIN: { accessible: true, reason: null }, USER: { accessible: true, reason: null } }, features: [] };

async function fixture(page: Page) {
  await page.route('**/auth/me', route => route.fulfill({ json: admin }));
  await page.route(/localhost:3001\/users\/tenants$/, route => route.fulfill({ json: [tenant] }));
  await page.route(/localhost:3001\/users(?:\?.*)?$/, route => route.fulfill({ json: [user] }));
  await page.route(/localhost:3001\/tenants$/, route => route.fulfill({ json: [tenant] }));
  await page.route(/localhost:3001\/modules\/configuration(?:\?.*)?$/, route => route.fulfill({ json: [module] }));
  await page.route(/localhost:3001\/modules$/, route => route.fulfill({ json: [module] }));
}

test('user create edit and status use shared overlays across sizes and themes', async ({ page }) => {
  await fixture(page);
  await page.goto(`${base}/users`);
  const create = page.getByRole('dialog', { name: 'Tambah User' });
  for (const [name, width, theme] of [['dark', 1440, 'dark'], ['light', 768, 'light'], ['mobile', 375, 'dark'], ['system-dark', 768, 'system'], ['system-light', 768, 'system']] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: name === 'system-light' ? 'light' : 'dark' });
    await page.evaluate(value => localStorage.setItem('cti-theme', value), theme);
    await page.reload();
    await page.getByRole('button', { name: 'Add user' }).click();
    await expect(create).toBeVisible();
    await expect(create).toHaveAttribute('aria-modal', 'true');
    await page.screenshot({ path: `${evidence}/user-create-${name}.png` });
    if (width === 375) await expect.poll(() => create.locator('.cti-overlay-body > div[style*="grid-template-columns"]').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(create.getByRole('button', { name: 'Create User' })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(create).not.toBeVisible();
  }
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit User' });
  await expect(edit.getByLabel('Nama')).toHaveValue('Alya');
  await page.screenshot({ path: `${evidence}/user-edit.png` });
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Nonaktifkan' }).click();
  const confirm = page.getByRole('dialog', { name: 'Nonaktifkan user' });
  await expect(confirm).toContainText('alya@example.test');
  await page.screenshot({ path: `${evidence}/confirmation.png` });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
});

test('organization and module create forms use shared overlays', async ({ page }) => {
  await fixture(page);
  await page.goto(`${base}/tenants`);
  await page.getByRole('button', { name: 'Create New Tenant' }).click();
  await expect(page.getByRole('dialog', { name: 'Buat Tenant Baru' })).toBeVisible();
  await page.screenshot({ path: `${evidence}/organization-create.png` });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: `${evidence}/organization-create-mobile.png` });
  await expect.poll(() => page.getByRole('dialog', { name: 'Buat Tenant Baru' }).locator('.cti-overlay-body > div[style*="grid-template-columns"]').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(`${base}/modules`);
  await page.getByRole('button', { name: 'Tambah modul' }).click();
  await expect(page.getByRole('dialog', { name: 'Tambah modul' })).toBeVisible();
  await page.screenshot({ path: `${evidence}/module-create-mobile.png` });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${evidence}/module-create.png` });
});

test('module policy disable requires explicit confirmation', async ({ page }) => {
  await fixture(page);
  await page.goto(`${base}/modules`);
  await page.getByLabel('Tenant Enabled').click();
  const confirm = page.getByRole('dialog', { name: 'Nonaktifkan akses modul' });
  await expect(confirm).toContainText('Threat Intelligence');
  await page.screenshot({ path: `${evidence}/module-assignment.png` });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: `${evidence}/module-assignment-mobile.png` });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
});

test('subscription replacement confirmation retains current plan', async ({ page }) => {
  const plan = { id: 'plan-1', name: 'Professional', description: 'Fixture plan', type: 'PREDEFINED', priceMonthly: 100000, priceYearly: 1000000, modules: [] };
  const subscription = { id: 'sub-1', isCustom: false, billingCycle: 'MONTHLY', priceMonthly: 100000, priceYearly: 1000000, status: 'ACTIVE', subscribedAt: '2026-09-01T00:00:00Z', renewalAt: '2026-10-01T00:00:00Z', package: plan, subscriptionActive: true, includedModules: [], customModules: [] };
  await page.route('**/auth/me', route => route.fulfill({ json: { ...admin, role: 'ADMIN', tenant: { id: tenant.id, name: tenant.name } } }));
  await page.route('**/subscription/packages', route => route.fulfill({ json: [plan] }));
  await page.route('**/subscription/my', route => route.fulfill({ json: subscription }));
  await page.goto(`${base}/subscription`);
  await expect(page.getByRole('heading', { name: 'Professional' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Choose Plan' }).click();
  const confirm = page.getByRole('dialog', { name: 'Ganti subscription tenant' });
  await expect(confirm).toContainText('kehilangan akses efektif');
  await page.screenshot({ path: `${evidence}/subscription.png` });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: `${evidence}/subscription-mobile.png` });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).not.toBeVisible();
});
