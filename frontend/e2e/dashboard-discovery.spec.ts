import { expect, test, type Page } from '@playwright/test';

const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3000';
const out = '../docs/audits';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
const summary = { dashboardMode: 'GLOBAL', tenantName: 'Platform Overview', totalTenants: 2, indicators: 1, highRiskIndicators: 1, activeAlerts: 1, openCases: 1, users: 3, myIndicatorsCreated: 0, sources: 0, campaigns: 0, subscription: { plan: null, status: 'GLOBAL', persistedStatus: null }, activityAvailable: true, recentActivity: [], tenantOverview: [] };

async function fixture(page: Page, role: Role, calls: { search: number; notices: number }) {
  const reads = new Set<string>();
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(app).origin) { await route.continue(); return; }
    const send = (body: object, status = 200) => route.fulfill({ status, json: body, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } });
    if (url.pathname === '/auth/me') return send({ id: 'qa-user', name: 'Super Admin', email: 'qa@example.test', role, tenant: role === 'SUPER_ADMIN' ? null : { id: 'tenant-a', name: 'Tenant A' }, moduleAccess: [] });
    if (url.pathname === '/dashboard/summary') return send({ ...summary, dashboardMode: role === 'SUPER_ADMIN' ? 'GLOBAL' : role === 'ADMIN' ? 'TENANT_ADMIN' : 'PERSONAL', tenantName: role === 'SUPER_ADMIN' ? 'Platform Overview' : 'Tenant A' });
    if (url.pathname === '/users/tenants') return send([{ id: 'tenant-a', name: 'Tenant A' }, { id: 'tenant-b', name: 'Tenant B' }]);
    if (url.pathname === '/dashboard/search') {
      calls.search += 1;
      const tenant = role === 'SUPER_ADMIN' ? url.searchParams.get('tenantId') : 'tenant-a';
      if (!tenant) return send({ message: 'Tenant wajib' }, 400);
      if (url.searchParams.get('q') === 'error') return send({ message: 'Unavailable' }, 503);
      if (url.searchParams.get('q') === 'empty') return send({ query: 'empty', tenantId: tenant, groups: [], partialFailures: [] });
      if (url.searchParams.get('q') === 'partial') return send({ query: 'partial', tenantId: tenant, groups: [], partialFailures: ['CASE'] });
      return send({ query: url.searchParams.get('q'), tenantId: tenant, groups: [{ source: 'CASE', items: [{ id: `case-${tenant}`, title: `Portal ${tenant}`, subtitle: 'CASE-1', route: `/cases/case-${tenant}?tenantId=${tenant}` }], hasMore: false }], partialFailures: [] });
    }
    if (url.pathname === '/dashboard/notifications') {
      calls.notices += 1;
      const tenant = role === 'SUPER_ADMIN' ? url.searchParams.get('tenantId') : 'tenant-a';
      if (!tenant) return send({ message: 'Tenant wajib' }, 400);
      return send({ items: [{ id: `notice-${tenant}`, title: `ASM alert ${tenant}`, severity: 'HIGH', createdAt: '2026-10-01T00:00:00.000Z', readAt: reads.has(tenant) ? '2026-10-01T01:00:00.000Z' : null, route: `/attack-surface/assets?assetId=asset-${tenant}&tenantId=${tenant}` }], unreadCount: reads.has(tenant) ? 0 : 1, page: 1, limit: 10, hasMore: false });
    }
    if (url.pathname.endsWith('/read') && route.request().method() === 'PATCH') { reads.add(url.pathname.includes('tenant-b') ? 'tenant-b' : 'tenant-a'); return send({ id: 'notice', readAt: '2026-10-01T01:00:00.000Z' }); }
    return send({ message: 'Not found' }, 404);
  });
}

test('Dashboard search and ASM bell follow selected tenant and keyboard controls', async ({ page }) => {
  const calls = { search: 0, notices: 0 };
  await fixture(page, 'SUPER_ADMIN', calls);
  await page.goto(`${app}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: /Cari indikator/ })).toBeDisabled();
  expect(calls.search).toBe(0); expect(calls.notices).toBe(0);
  await page.getByRole('combobox', { name: 'Tenant Search dan Notifications' }).selectOption('tenant-a');
  await expect(page.getByRole('button', { name: /Notifications, 1/ })).toBeVisible();
  await page.getByRole('searchbox', { name: /Cari indikator/ }).fill('Portal');
  await page.getByRole('searchbox', { name: /Cari indikator/ }).press('Enter');
  await expect(page.getByRole('link', { name: /Portal tenant-a/ })).toHaveAttribute('href', '/cases/case-tenant-a?tenantId=tenant-a');
  await page.getByRole('button', { name: /Notifications, 1/ }).click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toContainText('ASM alert tenant-a');
  await page.getByRole('button', { name: 'Mark as read' }).click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toContainText('Dibaca');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Tenant Search dan Notifications' }).selectOption('tenant-b');
  await expect(page.getByRole('link', { name: /Portal tenant-a/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Notifications, 1/ })).toBeVisible();
  await page.getByRole('searchbox', { name: /Cari indikator/ }).fill('Portal');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('link', { name: /Portal tenant-b/ })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('cti-theme', value), theme);
    await page.reload();
    await page.getByRole('combobox', { name: 'Tenant Search dan Notifications' }).selectOption('tenant-b');
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `${out}/dashboard-db11-reference-${width}-${theme}.png`, fullPage: true });
    }
    await page.getByRole('searchbox', { name: /Cari indikator/ }).fill('Portal');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await page.screenshot({ path: `${out}/dashboard-db11-${width}-${theme}.png`, fullPage: true });
    }
  }
  expect(calls.search).toBeGreaterThanOrEqual(2);
  expect(calls.notices).toBeGreaterThanOrEqual(2);
});

test('ADMIN and USER can search without tenant picker and see search states', async ({ page }) => {
  for (const role of ['ADMIN', 'USER'] as const) {
    const calls = { search: 0, notices: 0 };
    await fixture(page, role, calls);
    await page.goto(`${app}/dashboard`);
    await expect(page.getByRole('combobox', { name: 'Tenant Search dan Notifications' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Notifications, 1/ })).toBeVisible();
    const input = page.getByRole('searchbox', { name: /Cari indikator/ });
    await input.fill('Portal'); await input.press('Enter');
    await expect(page.getByRole('link', { name: /Portal tenant-a/ })).toBeVisible();
    await input.fill('empty'); await input.press('Enter');
    await expect(page.getByText('Tidak ada hasil.')).toBeVisible();
    await input.fill('partial'); await input.press('Enter');
    await expect(page.getByText(/Sebagian sumber belum tersedia/)).toBeVisible();
    await input.fill('error'); await input.press('Enter');
    await expect(page.locator('.dashboard-discovery-message[role=alert]')).toContainText('Pencarian tidak tersedia');
    await page.unrouteAll();
  }
});