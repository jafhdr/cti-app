import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const app = 'http://localhost:3000';

type AuditItem = { readonly tenantId: string | null };

function auditItems(value: unknown): readonly AuditItem[] {
  if (typeof value !== 'object' || value === null || !('items' in value) || !Array.isArray(value.items)) {
    throw new Error('Respons audit log tidak valid');
  }
  return value.items.filter((item): item is AuditItem =>
    typeof item === 'object' && item !== null && 'tenantId' in item,
  );
}

function tenantId(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('tenant' in value)) throw new Error('Tenant tidak tersedia');
  const tenant = value.tenant;
  if (typeof tenant !== 'object' || tenant === null || !('id' in tenant) || typeof tenant.id !== 'string') {
    throw new Error('Tenant ID tidak valid');
  }
  return tenant.id;
}

async function login(page: import('@playwright/test').Page, email: string, password: string): Promise<void> {
  const response = await page.request.post(`${api}/auth/login`, { data: { email, password } });
  expect(response.ok()).toBeTruthy();
}

test('tenant admin audit logs remain constrained to the authenticated tenant', async ({ page }) => {
  await login(page, 'admin@cti.local', 'Admin123!');
  const me = await page.request.get(`${api}/auth/me`);
  const ownTenantId = tenantId(await me.json());

  const response = await page.request.get(`${api}/audit-logs?tenantId=foreign-tenant`);
  expect(response.ok()).toBeTruthy();
  const items = auditItems(await response.json());
  expect(items.length).toBeGreaterThan(0);
  expect(items.every((item) => item.tenantId === ownTenantId)).toBeTruthy();
});

test('super admin can view and filter audit logs from the page', async ({ page }) => {
  page.on('console', (message) => console.log(`[browser ${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => console.log(`[browser error] ${error.message}`));
  page.on('response', (response) => {
    if (!response.ok()) console.log(`[browser response] ${response.status()} ${response.url()}`);
  });
  await login(page, 'superadmin@cti.local', 'SuperAdmin123!');
  await page.goto(`${app}/audit-logs`);

  await expect(page.getByRole('heading', { name: 'Platform audit log' })).toBeVisible();
  const tenantFilter = page.getByLabel('TENANT');
  await expect(tenantFilter).toBeVisible();
  expect(await tenantFilter.locator('option').count()).toBeGreaterThan(1);

  const selectedTenantId = await tenantFilter.locator('option').nth(1).getAttribute('value');
  if (!selectedTenantId) throw new Error('Tenant filter tidak memiliki ID');
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes(`/audit-logs?`) && response.url().includes(`tenantId=${selectedTenantId}`),
  );
  await tenantFilter.selectOption(selectedTenantId);
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  expect(auditItems(await response.json()).every((item) => item.tenantId === selectedTenantId)).toBeTruthy();
});
