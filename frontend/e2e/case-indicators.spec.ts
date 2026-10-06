import { expect, test } from '@playwright/test';

test('admin links and unlinks an existing indicator from a case', async ({ page }) => {
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  const person = { id: 'admin-1', name: 'Admin', email: 'admin@test.local' };
  const available = { id: 'indicator-1', value: '203.0.113.10', type: 'IP_ADDRESS', severity: 'HIGH', status: 'ACTIVE', tags: ['c2'], source: 'Threat feed', sourceObservations: [{ id: 'source-a', sourceName: 'Feed A', provider: 'URLhaus', firstSeenAt: '2026-09-28T08:00:00.000Z', lastSeenAt: '2026-09-28T09:00:00.000Z' }, { id: 'source-b', sourceName: 'Feed B', provider: 'AbuseIPDB', firstSeenAt: '2026-09-28T08:30:00.000Z', lastSeenAt: '2026-09-28T09:30:00.000Z' }] };
  let linked: readonly typeof available[] = [];

  await page.route('**/auth/me', async (route) => route.fulfill({ json: {
    id: person.id,
    email: person.email,
    role: 'ADMIN',
    moduleAccess: [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] }],
  } }));
  await page.route('http://localhost:3001/cases/case-1', async (route) => route.fulfill({ json: { id: 'case-1', caseNumber: 'CASE-2026-00001', title: 'Suspicious login', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', creator: person, tenant: { id: 'tenant-1', name: 'Acme', slug: 'acme' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }));
  await page.route('http://localhost:3001/cases/case-1/indicators', async (route) => {
    if (route.request().method() === 'POST') {
      linked = [available];
      await route.fulfill({ status: 201, json: available });
      return;
    }
    await route.fulfill({ json: linked });
  });
  await page.route('http://localhost:3001/cases/case-1/indicators/available**', async (route) => route.fulfill({ json: linked.length === 0 ? [available] : [] }));
  await page.route('http://localhost:3001/cases/case-1/indicators/indicator-1', async (route) => {
    linked = [];
    await route.fulfill({ json: { success: true } });
  });
  await page.route('http://localhost:3001/cases/case-1/notes', async (route) => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/evidence', async (route) => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/activity', async (route) => route.fulfill({ json: [] }));

  await page.goto(`${baseUrl}/cases/case-1`);
  await expect(page.getByText('Belum ada Indicator yang terhubung.')).toBeVisible();
  await page.getByRole('button', { name: 'Add Indicator' }).click();
  await page.getByPlaceholder('Cari value, source, atau tag...').fill('203.0.113');
  await expect(page.getByText('203.0.113.10')).toBeVisible();
  await page.getByRole('button', { name: 'Hubungkan 203.0.113.10' }).click();
  await expect(page.getByText('203.0.113.10')).toBeVisible();
  await expect(page.getByText('Feed A')).toBeVisible();
  await expect(page.getByText('Feed B')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/case-indicators/desktop-linked.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Indicators' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../.omo/evidence/case-indicators/mobile-linked.png', fullPage: true });
  await page.getByRole('button', { name: 'Lepas 203.0.113.10' }).click();
  await expect(page.getByText('Belum ada Indicator yang terhubung.')).toBeVisible();
});
