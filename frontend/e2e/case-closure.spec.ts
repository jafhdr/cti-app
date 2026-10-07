import { expect, test } from '@playwright/test';

const app = 'http://localhost:3000';
const feature = [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] }];
const caseFor = (tenantId: string) => ({ id: `case-${tenantId}`, caseNumber: `CASE-${tenantId}`, title: `Case ${tenantId}`, status: 'OPEN', priority: 'MEDIUM', severity: 'MEDIUM', tenant: { id: tenantId, name: tenantId, slug: tenantId }, creator: { id: 'root', name: 'Root' }, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' });

test('SUPER_ADMIN tenant switch replaces Case workspace state', async ({ page }) => {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'root', email: 'root@example.test', role: 'SUPER_ADMIN', moduleAccess: feature } }));
  await page.route('**/users/tenants', route => route.fulfill({ json: [{ id: 'tenant-a', name: 'Tenant A' }, { id: 'tenant-b', name: 'Tenant B' }] }));
  await page.route('**/cases?*', route => {
    const tenantId = new URL(route.request().url()).searchParams.get('tenantId') || '';
    return route.fulfill({ json: { items: [caseFor(tenantId)], total: 1 } });
  });
  await page.route('http://localhost:3001/cases/case-tenant-*', route => {
    const tenantId = new URL(route.request().url()).searchParams.get('tenantId');
    const caseId = route.request().url().split('?')[0].split('/').at(-1);
    return route.fulfill(tenantId && caseId === `case-${tenantId}` ? { json: caseFor(tenantId) } : { status: 404, json: { message: 'Case tidak ditemukan' } });
  });
  await page.goto(`${app}/cases`);
  await page.getByLabel('Tenant Case Management').selectOption('tenant-a');
  await expect(page.getByRole('link', { name: 'CASE-tenant-a' })).toBeVisible();
  await page.getByRole('link', { name: 'CASE-tenant-a' }).click();
  await expect(page.getByRole('heading', { name: 'Case tenant-a' })).toBeVisible();
  await page.getByLabel('Tenant Case Management').selectOption('tenant-b');
  await expect(page.getByRole('heading', { name: 'Case tenant-a' })).toHaveCount(0);
  await page.goto(`${app}/cases`);
  await expect(page.getByRole('link', { name: 'CASE-tenant-b' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'CASE-tenant-a' })).toHaveCount(0);
  await page.getByRole('link', { name: 'CASE-tenant-b' }).click();
  await expect(page.getByRole('heading', { name: 'Case tenant-b' })).toBeVisible();
});

test('Case status editor offers only the next allowed transition', async ({ page }) => {
  let current = caseFor('tenant-a');
  let submitted = '';
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'admin', email: 'admin@example.test', role: 'ADMIN', moduleAccess: feature } }));
  await page.route('http://localhost:3001/cases/case-tenant-a', route => {
    if (route.request().method() === 'PATCH') {
      submitted = route.request().postDataJSON().status;
      current = { ...current, status: submitted };
    }
    return route.fulfill({ json: current });
  });
  for (const suffix of ['notes', 'evidence', 'activity', 'indicators', 'threat-actors', 'campaigns']) {
    await page.route(`http://localhost:3001/cases/case-tenant-a/${suffix}`, route => route.fulfill({ json: [] }));
  }
  await page.goto(`${app}/cases/case-tenant-a`);
  await page.getByRole('button', { name: 'Edit case' }).click();
  const status = page.getByRole('dialog', { name: 'Edit case' }).getByLabel('Status');
  await expect(status.locator('option')).toHaveText(['OPEN', 'IN PROGRESS']);
  await status.selectOption('IN_PROGRESS');
  await page.getByRole('dialog', { name: 'Edit case' }).getByRole('button', { name: 'Save changes' }).click();
  expect(submitted).toBe('IN_PROGRESS');
  await expect(page.getByLabel('Case status').getByText('IN PROGRESS')).toBeVisible();
});
