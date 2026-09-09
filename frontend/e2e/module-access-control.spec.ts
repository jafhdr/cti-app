import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const app = 'http://localhost:3000';

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  const response = await page.request.post(`${api}/auth/login`, { data: { email, password } });
  expect(response.ok()).toBeTruthy();
}

function tenantIdFrom(value: unknown) {
  if (typeof value !== 'object' || value === null || !('tenant' in value)) throw new Error('Tenant login tidak tersedia');
  const tenant = value.tenant;
  if (typeof tenant !== 'object' || tenant === null || !('id' in tenant) || typeof tenant.id !== 'string') throw new Error('Tenant ID tidak valid');
  return tenant.id;
}

function arrayFrom(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} bukan array`);
  return value;
}

function recordId(value: unknown, label: string) {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') throw new Error(`${label} tidak memiliki ID`);
  return value.id;
}

test('tenant admin sees only own tenant module access', async ({ page }) => {
  await login(page, 'admin@cti.local', 'Admin123!');
  const me = await page.request.get(`${api}/auth/me`);
  const currentUser: unknown = await me.json();
  expect(currentUser).toMatchObject({ role: 'ADMIN', tenant: { slug: 'demo-tenant' } });
  const tenantId = tenantIdFrom(currentUser);
  const response = await page.request.get(`${api}/users/tenant/${tenantId}/module-access`);
  expect(response.ok()).toBeTruthy();
  await page.goto(`${app}/module-access`);
  await expect(page.getByRole('heading', { name: 'Akses Modul User' })).toBeVisible();
  await expect(page.getByText('Memuat data akses…')).toBeHidden();
  await expect(page.getByText('Assignment per user')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/module-access/admin-desktop.png', fullPage: true });
  await page.locator('input[type="checkbox"]:not([disabled])').first().check();
  await expect(page.getByText(/Bulk assignment/)).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/module-access/admin-bulk-desktop.png', fullPage: true });
  await page.locator('button:has-text("Atur akses"):not([disabled])').first().click();
  await expect(page.getByRole('heading', { name: /Akses Modul:/ })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/module-access/admin-detail-desktop.png', fullPage: true });
  await page.locator('.access-panel').screenshot({ path: '../.omo/evidence/module-access/admin-detail-panel.png' });
  await page.getByRole('button', { name: 'Simpan Akses Modul' }).click();
  await expect(page.getByRole('status')).toContainText('berhasil diperbarui');
});

test('tenant admin is denied access to another tenant', async ({ page }) => {
  await login(page, 'admin@cti.local', 'Admin123!');
  const initialAdminMe = await page.request.get(`${api}/auth/me`);
  const ownTenantId = tenantIdFrom(await initialAdminMe.json());
  await page.request.post(`${api}/auth/logout`);
  await login(page, 'superadmin@cti.local', 'SuperAdmin123!');
  const tenantsResponse = await page.request.get(`${api}/users/tenants`);
  const tenants = arrayFrom(await tenantsResponse.json(), 'Tenant');
  expect(tenants.length).toBeGreaterThan(1);
  const foreignTenant = tenants.find((tenant) => recordId(tenant, 'Tenant') !== ownTenantId);
  if (!foreignTenant) throw new Error('Tenant asing tidak tersedia');
  const foreignTenantId = recordId(foreignTenant, 'Tenant asing');
  await page.request.post(`${api}/auth/logout`);
  await login(page, 'admin@cti.local', 'Admin123!');
  const adminMe = await page.request.get(`${api}/auth/me`);
  expect(await adminMe.json()).toMatchObject({ role: 'ADMIN' });
  const response = await page.request.get(`${api}/users/tenant/${foreignTenantId}/module-access`);
  expect(response.status()).toBe(403);
});

test('super admin can switch tenants and inspect module users', async ({ page }) => {
  await login(page, 'superadmin@cti.local', 'SuperAdmin123!');
  await page.goto(`${app}/module-access`);
  const tenantSelect = page.getByLabel('Pilih tenant');
  await expect(tenantSelect).toBeVisible();
  await expect(page.getByText('Memuat data akses…')).toBeHidden();
  const tenantOptions = tenantSelect.locator('option');
  expect(await tenantOptions.count()).toBeGreaterThan(1);
  await tenantSelect.selectOption({ index: 1 });
  await expect(page.getByText('Memuat data akses…')).toBeHidden();
  await expect(page.getByText('Assignment per user')).toBeVisible();
  const moduleSelect = page.getByLabel('Lihat akses modul');
  const moduleOptions = moduleSelect.locator('option');
  if (await moduleOptions.count() > 1) {
    await moduleSelect.selectOption({ index: 1 });
    await expect(page.locator('.module-user-grid')).toBeVisible();
  }
  await page.screenshot({ path: '../.omo/evidence/module-access/superadmin-desktop.png', fullPage: true });
});

test('module access page remains usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'admin@cti.local', 'Admin123!');
  await page.goto(`${app}/module-access`);
  await expect(page.getByRole('heading', { name: 'Akses Modul User' })).toBeVisible();
  await expect(page.getByText('Memuat data akses…')).toBeHidden();
  await expect(page.getByText('Assignment per user')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/module-access/admin-mobile.png', fullPage: true });
  await page.locator('input[type="checkbox"]:not([disabled])').first().check();
  await page.locator('tbody tr').filter({ hasText: 'jawa@gmail.com' }).screenshot({ path: '../.omo/evidence/module-access/admin-mobile-checked-row.png' });
  await page.getByText('Lihat dari sisi modul').scrollIntoViewIfNeeded();
  await page.locator('.module-view').screenshot({ path: '../.omo/evidence/module-access/admin-mobile-lower.png' });
});

test('bulk endpoint preserves a user assignment payload', async ({ page }) => {
  await login(page, 'admin@cti.local', 'Admin123!');
  const meResponse = await page.request.get(`${api}/auth/me`);
  const tenantId = tenantIdFrom(await meResponse.json());
  const overviewResponse = await page.request.get(`${api}/users/tenant/${tenantId}/module-access`);
  const overview: unknown = await overviewResponse.json();
  if (typeof overview !== 'object' || overview === null || !('users' in overview)) throw new Error('Overview user tidak valid');
  const users = arrayFrom(overview.users, 'User overview');
  const target = users.find((user) => typeof user === 'object' && user !== null && 'role' in user && user.role === 'USER');
  if (typeof target !== 'object' || target === null || !('moduleAccess' in target)) throw new Error('User tenant untuk bulk test tidak tersedia');
  const userId = recordId(target, 'User target');
  const access = arrayFrom(target.moduleAccess, 'Assignment user');
  const update = await page.request.patch(`${api}/users/tenant/${tenantId}/module-access`, { data: { assignments: [{ userId, access }] } });
  expect(update.ok()).toBeTruthy();
  const refreshed: unknown = await update.json();
  if (typeof refreshed !== 'object' || refreshed === null || !('users' in refreshed)) throw new Error('Hasil bulk tidak valid');
  const refreshedTarget = arrayFrom(refreshed.users, 'User hasil bulk').find((user) => typeof user === 'object' && user !== null && 'id' in user && user.id === userId);
  expect(refreshedTarget).toMatchObject({ id: userId, moduleAccess: access });
});
