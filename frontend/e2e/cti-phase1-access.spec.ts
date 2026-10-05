import { expect, test } from '@playwright/test';

const app = 'http://localhost:3000';

test('SUPER_ADMIN selects a tenant before Case list and creation', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/auth/me', route => route.fulfill({ json: { email: 'root@example.test', role: 'SUPER_ADMIN', moduleAccess: [{ moduleSlug: 'case-management', moduleName: 'Case Management', accessible: true, featureKeys: ['case-workflow'] }] } }));
  await page.route('**/users/tenants', route => route.fulfill({ json: [{ id: 'tenant-a', name: 'Tenant A' }, { id: 'tenant-b', name: 'Tenant B' }] }));
  await page.route('**/cases?*', route => { requests.push(route.request().url()); return route.fulfill({ json: { items: [], total: 0 } }); });
  await page.route('http://localhost:3001/cases', route => route.fulfill({ json: { id: 'case-b' } }));

  await page.goto(`${app}/cases`);
  await expect(page.getByText('Pilih tenant untuk membuka Case Management.')).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('combobox', { name: 'Tenant Case Management' }).selectOption('tenant-b');
  await expect.poll(() => requests.some(url => new URL(url).searchParams.get('tenantId') === 'tenant-b')).toBe(true);
  await page.getByRole('button', { name: 'New Case' }).click();
  await page.getByLabel('Title').fill('Investigation B');
  const creation = page.waitForRequest(request => request.url().endsWith('/cases') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Create Case' }).click();
  expect((await creation).postDataJSON()).toMatchObject({ tenantId: 'tenant-b', title: 'Investigation B' });
});

test('subset feature access hides Case and Intelligence Hub entries', async ({ page }) => {
  await page.route('**/auth/me', route => route.fulfill({ json: { email: 'analyst@example.test', role: 'USER', moduleAccess: [
    { moduleSlug: 'case-management', moduleName: 'Case Management', accessible: true, featureKeys: [] },
    { moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', accessible: true, featureKeys: ['indicator-management'] },
  ] } }));
  await page.goto(`${app}/cases`);
  await expect(page.getByText('Anda tidak memiliki akses ke modul Case Management.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Case Management' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Threat Intelligence' }).click();
  await expect(page.getByRole('link', { name: 'Indicators' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Intelligence Hub' })).toHaveCount(0);
});

test('SUPER_ADMIN Case actions follow tenant switching and reject stale detail', async ({ page }) => {
  const actions: { path: string; tenantId: string }[] = [];
  await page.route('**/auth/me', route => route.fulfill({ json: { email: 'root@example.test', role: 'SUPER_ADMIN', moduleAccess: [{ moduleSlug: 'case-management', moduleName: 'Case Management', accessible: true, featureKeys: ['case-workflow'] }] } }));
  await page.route('**/users/tenants', route => route.fulfill({ json: [{ id: 'tenant-a', name: 'Tenant A' }, { id: 'tenant-b', name: 'Tenant B' }] }));
  await page.route('http://localhost:3001/cases?*', route => {
    const tenantId = new URL(route.request().url()).searchParams.get('tenantId');
    const caseId = tenantId === 'tenant-a' ? 'case-a' : 'case-b';
    return route.fulfill({ json: { items: [{ id: caseId, caseNumber: caseId, title: `Case ${tenantId}`, status: 'OPEN', priority: 'HIGH', createdAt: '2026-01-01T00:00:00Z' }], total: 1 } });
  });
  await page.route('http://localhost:3001/cases/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const tenantId = url.searchParams.get('tenantId') ?? '';
    if (url.pathname.endsWith('/assignable-users')) return route.fulfill({ json: [{ id: `user-${tenantId}`, name: `Responder ${tenantId}`, email: 'responder@example.test' }] });
    const caseId = url.pathname.split('/')[2];
    if (tenantId !== `tenant-${caseId.at(-1)}`) return route.fulfill({ status: 404, json: { message: 'Case tidak ditemukan' } });
    if (request.method() !== 'GET') { actions.push({ path: url.pathname, tenantId }); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname.endsWith('/notes') || url.pathname.endsWith('/evidence') || url.pathname.endsWith('/activity') || url.pathname.endsWith('/indicators') || url.pathname.endsWith('/threat-actors') || url.pathname.endsWith('/campaigns')) return route.fulfill({ json: [] });
    if (url.pathname.includes('/available')) return route.fulfill({ json: [] });
    return route.fulfill({ json: { id: caseId, caseNumber: caseId, title: `Case ${tenantId}`, description: '', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', creator: { id: 'root', name: 'Root', email: 'root@example.test' }, tenant: { id: tenantId, name: tenantId, slug: tenantId } } });
  });

  await page.goto(`${app}/cases`);
  await page.getByRole('combobox', { name: 'Tenant Case Management' }).selectOption('tenant-a');
  await page.getByRole('link', { name: 'case-a', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Case tenant-a' })).toBeVisible();
  await page.getByLabel('Catatan investigasi').fill('Note A');
  await page.getByRole('button', { name: 'Tambah catatan' }).click();
  await expect.poll(() => actions.some(action => action.path.endsWith('/case-a/notes') && action.tenantId === 'tenant-a')).toBe(true);

  await page.getByRole('combobox', { name: 'Tenant Case Management' }).selectOption('tenant-b');
  await expect(page.getByRole('heading', { name: 'Case tenant-a' })).toHaveCount(0);
  await expect(page.getByText('Case tidak ditemukan')).toBeVisible();
  await page.goto(`${app}/cases`);
  await page.getByRole('combobox', { name: 'Tenant Case Management' }).selectOption('tenant-b');
  await page.getByRole('link', { name: 'case-b', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Case tenant-b' })).toBeVisible();
  await page.getByLabel('Catatan investigasi').fill('Note B');
  await page.getByRole('button', { name: 'Tambah catatan' }).click();
  await expect.poll(() => actions.some(action => action.path.endsWith('/case-b/notes') && action.tenantId === 'tenant-b')).toBe(true);
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('dialog', { name: 'Assign Case' }).getByRole('combobox').selectOption('user-tenant-b');
  await page.getByRole('dialog', { name: 'Assign Case' }).getByRole('button', { name: 'Assign' }).click();
  await expect.poll(() => actions.some(action => action.path.endsWith('/case-b/assign') && action.tenantId === 'tenant-b')).toBe(true);
  expect(actions).toHaveLength(3);
});
