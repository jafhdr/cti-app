import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const app = 'http://localhost:3000';

async function login(page: import('@playwright/test').Page) {
  const response = await page.request.post(`${api}/auth/login`, { data: { email: 'admin@cti.local', password: 'Admin123!' } });
  expect(response.ok()).toBeTruthy();
}

async function loginSuperAdmin(page: import('@playwright/test').Page) {
  const response = await page.request.post(`${api}/auth/login`, { data: { email: 'superadmin@cti.local', password: 'SuperAdmin123!' } });
  expect(response.ok()).toBeTruthy();
}

test('subscription package and custom states', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/subscription`);
  await expect(page.getByRole('heading', { name: 'Your security platform, your plan.' })).toBeVisible();
  await expect(page.getByRole('article').getByRole('heading', { name: 'Community' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/subscription/desktop-packages.png', fullPage: true });
  await page.getByRole('tab', { name: 'Paket Custom' }).click();
  await page.locator('.custom-module').first().click();
  await expect(page.getByText('Rincian harga')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/subscription/desktop-custom.png', fullPage: true });
  await page.getByRole('button', { name: 'Konfirmasi Pembelian' }).click();
  await expect(page.getByText('Subscription berhasil diperbarui.')).toBeVisible();
  await expect(page.getByLabel('Subscription saat ini').getByRole('heading', { name: 'Custom Package' })).toBeVisible();
  await page.getByRole('tab', { name: 'Paket Subscription' }).click();
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Community' }) }).getByRole('button', { name: 'Pilih Paket' }).click();
  await expect(page.getByLabel('Subscription saat ini').getByRole('heading', { name: 'Community' })).toBeVisible();
  await page.getByRole('tab', { name: 'Paket Subscription' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Paket Custom' })).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../.omo/evidence/subscription/mobile-custom.png', fullPage: true });
});

test('user module assignment panel', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/users`);
  await expect(page.getByRole('heading', { name: /Users/ })).toBeVisible();
  const accessButton = page.locator('button:has-text("Akses Modul"):not([disabled])').first();
  await expect(accessButton).toBeEnabled();
  await accessButton.click();
  await expect(page.getByRole('heading', { name: /Akses Modul:/ })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/subscription/desktop-user-access.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../.omo/evidence/subscription/mobile-user-access.png', fullPage: true });
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
