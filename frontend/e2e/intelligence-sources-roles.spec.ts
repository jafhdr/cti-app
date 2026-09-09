import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const app = process.env.SOURCES_APP_URL || 'http://localhost:3000';

async function tenantSession(page: Page, role: 'ADMIN' | 'USER'): Promise<void> {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: role.toLowerCase(), email: `${role.toLowerCase()}@example.test`, role, tenantId: 'tenant-a', moduleAccess: [{ moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, featureKeys: [] }] } }));
}

test('super admin scopes sources to the selected tenant', async ({ page }) => {
  let requestedTenant = '';
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'super', email: 'super@example.test', role: 'SUPER_ADMIN', tenantId: null, moduleAccess: [] } }));
  await page.route('**/users/tenants', route => route.fulfill({ json: [{ id: 'tenant-a', name: 'Tenant A' }, { id: 'tenant-b', name: 'Tenant B' }] }));
  await page.route('http://localhost:3001/intelligence/sources?*', route => { requestedTenant = new URL(route.request().url()).searchParams.get('tenantId') ?? ''; return route.fulfill({ json: { items: [], page: 1, limit: 10, total: 0, totalPages: 0 } }); });
  await page.goto(`${app}/intelligence/sources`);
  await expect.poll(() => requestedTenant).toBe('tenant-a');
  await page.getByLabel('Tenant Threat Intelligence').selectOption('tenant-b');
  await expect.poll(() => requestedTenant).toBe('tenant-b');
});

for (const role of ['ADMIN', 'USER'] as const) {
  test(`${role} sources remain scoped by authenticated context`, async ({ page }) => {
    let suppliedTenant: string | null = null;
    await tenantSession(page, role);
    await page.route('http://localhost:3001/intelligence/sources?*', route => { suppliedTenant = new URL(route.request().url()).searchParams.get('tenantId'); return route.fulfill({ json: { items: [], page: 1, limit: 10, total: 0, totalPages: 0 } }); });
    await page.goto(`${app}/intelligence/sources`);
    await expect(page.getByText('No sources found')).toBeVisible();
    expect(suppliedTenant).toBeNull();
  });
}
