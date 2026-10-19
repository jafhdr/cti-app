import { expect, test } from '@playwright/test';

const app = 'http://localhost:3000';

test('Module Management renders API features and a clear empty state', async ({ page }) => {
  await page.route('**/auth/me', (route) => route.fulfill({ json: { email: 'admin@cti.local', role: 'ADMIN' } }));
  await page.route('**/modules/configuration', (route) => route.fulfill({ json: [
    {
      id: 'asm', slug: 'attack-surface-management', name: 'Attack Surface Management',
      description: 'Kelola aset dan permukaan serangan.', category: 'APPSEC', isActive: true,
      tenantEnabled: true, access: { ADMIN: true, USER: true },
      subscriptionIncluded: true, subscriptionActive: true, subscriptionSource: 'Team',
      roleAccess: { ADMIN: true, USER: true },
      policyAccess: { ADMIN: { accessible: true, reason: null }, USER: { accessible: true, reason: null } },
      features: [
        { id: 'feature-1', key: 'asset-management', name: 'Asset Management', description: 'Kelola aset.' },
        { id: 'feature-2', key: 'asset-discovery', name: 'Asset Discovery', description: 'Temukan aset.' },
      ],
    },
    {
      id: 'empty', slug: 'empty-module', name: 'Empty Module', description: 'Belum memiliki fitur.',
      category: 'PLATFORM', isActive: true, tenantEnabled: false,
      access: { ADMIN: false, USER: false }, features: [],
      subscriptionIncluded: true, subscriptionActive: true, subscriptionSource: 'Team',
      roleAccess: { ADMIN: false, USER: false },
      policyAccess: {
        ADMIN: { accessible: false, reason: 'Modul dinonaktifkan untuk tenant ini' },
        USER: { accessible: false, reason: 'Modul dinonaktifkan untuk tenant ini' },
      },
    },
  ] }));

  await page.goto(`${app}/modules`);
  const asm = page.getByRole('article').filter({ hasText: 'Attack Surface Management' });
  await expect(asm.getByText('Asset Management', { exact: true })).toBeVisible();
  await expect(asm.getByText('Asset Discovery', { exact: true })).toBeVisible();
  const empty = page.getByRole('article').filter({ hasText: 'Empty Module' });
  await expect(empty.getByText('No feature access defined for this module yet.')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/aud4/module-management-desktop.png', fullPage: true });
});

test('AppSec module catalog identifies implemented and legacy capabilities', async ({ page }) => {
  await page.route('**/auth/me', route => route.fulfill({ json: { email: 'admin@cti.local', role: 'ADMIN', moduleAccess: [] } }));
  await page.route('**/modules/configuration', route => route.fulfill({ json: [{
    id: 'appsec', slug: 'appsec-posture', name: 'AppSec Posture', description: 'Application security posture.',
    category: 'APPSEC', isActive: true, tenantEnabled: true, source: 'SYSTEM',
    subscriptionIncluded: true, subscriptionActive: true, subscriptionSource: 'Team',
    roleAccess: { ADMIN: true, USER: true },
    policyAccess: { ADMIN: { accessible: true, reason: null }, USER: { accessible: true, reason: null } },
    features: [
      { id: 'overview', key: 'posture-overview', name: 'Posture Overview' },
      { id: 'applications', key: 'application-inventory', name: 'Application Inventory' },
      { id: 'findings', key: 'finding-management', name: 'Finding Management' },
      { id: 'legacy', key: 'advanced-chart', name: 'Advanced Charts (Legacy)' },
    ],
  }] }));
  await page.goto(`${app}/modules`);
  const card = page.getByRole('article').filter({ hasText: 'AppSec Posture' });
  for (const name of ['Posture Overview', 'Application Inventory', 'Finding Management']) await expect(card.getByText(name, { exact: true })).toBeVisible();
  await expect(card.getByText('Advanced Charts (Legacy) (Catalog only / not assignable)')).toBeVisible();
});
