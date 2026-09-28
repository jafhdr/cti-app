import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
const app = 'http://localhost:3000';
const feature = { id: 'assets', key: 'assets', name: 'Assets' };
const access = { id: 'asm', slug: 'attack-surface-management', name: 'Attack Surface Management', description: 'Assets', category: 'CTI', isActive: true, features: [feature], subscriptionIncluded: false, subscriptionActive: true, subscriptionSource: 'Professional Package', tenantEnabled: true, roleAllowed: true, assigned: true, assignable: false, accessible: false, reason: 'Module tidak termasuk subscription tenant.', featureKeys: [] };
async function fixture(page: Page) {
  await page.route('**/auth/me', route => route.fulfill({ json: { role: 'ADMIN', tenant: { id: 'tenant', name: 'Tenant' }, moduleAccess: [{ moduleId: 'asm', moduleName: access.name, moduleSlug: access.slug, assigned: true, accessible: true, featureKeys: [] }] } }));
  await page.route('**/users/tenant/tenant/module-access', route => route.fulfill({ json: { tenant: { id: 'tenant', name: 'Tenant' }, modules: [{ ...access, roleAccess: { ADMIN: true, USER: true }, policyAccess: { ADMIN: { accessible: false, reason: access.reason }, USER: { accessible: false, reason: access.reason } } }], users: [{ id: 'user', name: 'Analyst', email: 'analyst@example.test', role: 'USER', isActive: true, moduleAccess: [{ moduleId: 'asm', featureKeys: [] }], moduleAccessDetails: [access] }] } }));
  await page.route('**/users/user/module-access', route => route.fulfill({ json: [access] }));
}
test('assignment panel preserves empty features and explains ineffective assignment', async ({ page }) => {
  await fixture(page); await page.goto(`${app}/module-access`); await page.getByRole('button', { name: 'Atur akses' }).click();
  const panel = page.getByRole('region', { name: 'Akses modul Analyst' });
  await expect(panel.getByLabel('Assets', { exact: true })).not.toBeChecked();
  await expect(panel.getByText(access.reason, { exact: true })).toBeVisible();
  await expect(panel.getByText('Not Accessible', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Assets', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: access.name, exact: true })).toBeVisible();
});
test('unavailable modules cannot receive a new grant', async ({ page }) => {
  await fixture(page); await page.route('**/users/user/module-access', route => route.fulfill({ json: [{ ...access, assigned: false }] }));
  await page.goto(`${app}/module-access`); await page.getByRole('button', { name: 'Atur akses' }).click();
  await expect(page.getByRole('region', { name: 'Akses modul Analyst' }).getByLabel(access.name)).toBeDisabled();
});
