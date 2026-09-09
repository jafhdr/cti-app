import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3000';
const modules = [
  { moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Intel dari katalog', assigned: true, featureKeys: ['read'] },
  { moduleId: 'custom', moduleSlug: 'custom-module', moduleName: 'Modul katalog tambahan', assigned: true, featureKeys: [] },
  { moduleId: 'appsec', moduleSlug: 'appsec-posture', moduleName: 'AppSec Posture', assigned: false, featureKeys: [] },
];

async function session(page: Page, role: 'USER' | 'ADMIN' | 'SUPER_ADMIN', access = modules) {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'sidebar-test', name: 'Sidebar QA', email: 'qa@example.test', role, tenant: { id: 'tenant', name: 'QA', slug: 'qa' }, moduleAccess: access } }));
  await page.route('**/indicators?*', route => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route('**/dashboard/summary', route => route.fulfill({ json: { dashboardMode: 'PERSONAL', tenantName: 'QA', indicators: 0, highRiskIndicators: 0, activeAlerts: 0, openCases: 0, users: 0, myIndicatorsCreated: 0, sources: 0, campaigns: 0, subscription: { plan: 'QA', status: 'ACTIVE' }, recentActivity: [], tenantOverview: [] } }));
}

for (const role of ['USER', 'ADMIN', 'SUPER_ADMIN'] as const) {
  test(`${role} sees catalog names and only assigned modules`, async ({ page }) => {
    await session(page, role);
    await page.goto(`${app}/dashboard`);
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Threat Intelligence' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Modul katalog tambahan' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'AppSec Posture' })).toHaveCount(role === 'SUPER_ADMIN' ? 1 : 0);
    await expect(nav.getByRole('button', { name: 'Administration' })).toHaveCount(role === 'USER' ? 0 : 1);
    await nav.getByRole('button', { name: 'Threat Intelligence' }).click();
    await expect(nav.getByRole('link', { name: 'Indicators', exact: true })).toBeVisible();
    await nav.getByRole('link', { name: 'Indicators', exact: true }).click();
    await expect(nav.getByRole('button', { name: 'Threat Intelligence' })).toHaveAttribute('aria-expanded', 'true');
  });
}

test('unassigned user cannot open intelligence directly', async ({ page }) => {
  await session(page, 'USER', modules.map(module => ({ ...module, assigned: false })));
  await page.goto(`${app}/intelligence`);
  await expect(page.getByRole('heading', { name: 'Akses modul dibatasi' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kembali ke Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Entities', exact: true })).toHaveCount(0);
});

test('user with no assignment keeps only core navigation', async ({ page }) => {
  await session(page, 'USER', modules.map(module => ({ ...module, assigned: false })));
  await page.goto(`${app}/dashboard`);
  const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
  await expect(nav.getByRole('link')).toHaveText(['Dashboard']);
  await expect(nav.getByText('Modul katalog tambahan')).toHaveCount(0);
});

test('user with all assignments sees every catalog module', async ({ page }) => {
  await session(page, 'USER', modules.map(module => ({ ...module, assigned: true })));
  await page.goto(`${app}/dashboard`);
  const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
  await expect(nav.getByText('AppSec Posture', { exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'AppSec Posture' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Threat Intelligence' })).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(1);
});

test('API subscription denial blocks assigned user without rendering workspace', async ({ page }) => {
  await session(page, 'USER');
  await page.route('**/intelligence/overview', route => route.fulfill({ status: 403, json: { message: 'Subscription tenant tidak aktif' } }));
  await page.goto(`${app}/intelligence`);
  await expect(page.getByRole('heading', { name: 'Akses modul dibatasi' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('subscription');
  await expect(page.getByRole('heading', { name: 'Entities', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Kembali ke Dashboard', exact: true }).click();
  await expect(page).toHaveURL(`${app}/dashboard`);
});

test('failed access response does not expose module navigation', async ({ page }) => {
  await session(page, 'USER');
  await page.route('**/auth/me', route => route.fulfill({ status: 500, json: { message: 'Unavailable' } }));
  await page.goto(`${app}/intelligence`);
  const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
  await expect(nav.getByRole('link')).toHaveText(['Dashboard']);
  await expect(nav.getByRole('status')).toContainText('Gagal memuat akses modul.');
});
