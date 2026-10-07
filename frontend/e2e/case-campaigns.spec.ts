import { expect, test } from '@playwright/test';

test('admin opens a case, searches, links, and removes an existing campaign', async ({ page }) => {
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  const person = { id: 'admin-1', name: 'Admin', email: 'admin@test.local' };
  const available = { id: 'campaign-1', name: 'Operation Example', description: 'Tracked campaign', objective: 'Credential theft', status: 'ACTIVE', severity: 'HIGH', confidence: 80, externalId: 'C9999', threatActor: { entity: { name: 'Example Group' } } };
  let linked: readonly typeof available[] = [];
  let search = '';
  let availableError = false;
  let releaseInitialList: (() => void) | undefined;
  const initialListGate = new Promise<void>((resolve) => { releaseInitialList = resolve; });
  let initialListPending = true;

  await page.route('**/auth/me', async (route) => route.fulfill({ json: { id: person.id, email: person.email, role: 'ADMIN', moduleAccess: [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] }] } }));
  await page.route('http://localhost:3001/cases/case-1', async (route) => route.fulfill({ json: { id: 'case-1', caseNumber: 'CASE-2026-00001', title: 'Suspicious login', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', creator: person, tenant: { id: 'tenant-1', name: 'Acme', slug: 'acme' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }));
  await page.route('http://localhost:3001/cases/case-1/campaigns', async (route) => {
    if (route.request().method() === 'POST') { linked = [available]; await route.fulfill({ status: 201, json: available }); return; }
    if (initialListPending) { await initialListGate; initialListPending = false; }
    await route.fulfill({ json: linked });
  });
  await page.route('http://localhost:3001/cases/case-1/campaigns/available**', async (route) => { search = new URL(route.request().url()).searchParams.get('search') ?? ''; if (availableError) { await route.fulfill({ status: 500, json: { message: 'Campaign tersedia sementara tidak dapat dimuat' } }); return; } await route.fulfill({ json: linked.length === 0 ? [available] : [] }); });
  await page.route('http://localhost:3001/cases/case-1/campaigns/campaign-1', async (route) => { linked = []; await route.fulfill({ json: { success: true } }); });
  for (const suffix of ['indicators', 'threat-actors', 'notes', 'evidence', 'activity']) await page.route(`http://localhost:3001/cases/case-1/${suffix}`, async (route) => route.fulfill({ json: [] }));

  await page.goto(`${baseUrl}/cases/case-1`);
  await expect(page.getByRole('status', { name: 'Memuat Campaign terkait' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/case-campaigns/desktop-loading.png', fullPage: true });
  releaseInitialList?.();
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  await expect(page.getByText('Belum ada Campaign yang terhubung.')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/case-campaigns/desktop-empty.png', fullPage: true });
  await page.getByRole('button', { name: 'Add Campaign' }).click();
  const searchInput = page.getByPlaceholder('Cari nama, deskripsi, objective, atau external ID...');
  await expect(searchInput).toBeFocused();
  await searchInput.fill('Operation');
  await expect.poll(() => search).toBe('Operation');
  await expect(page.getByText('Operation Example')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/case-campaigns/desktop-search-results.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../.omo/evidence/case-campaigns/mobile-dialog.png', fullPage: true });
  await page.getByRole('button', { name: 'Hubungkan Operation Example' }).click();
  await expect(page.getByRole('heading', { name: 'Operation Example' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '../.omo/evidence/case-campaigns/desktop-linked.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../.omo/evidence/case-campaigns/mobile-linked.png', fullPage: true });
  await page.getByRole('button', { name: 'Lepas Operation Example' }).click();
  await expect(page.getByText('Belum ada Campaign yang terhubung.')).toBeVisible();
  availableError = true;
  await page.getByRole('button', { name: 'Add Campaign' }).click();
  await expect(page.getByText('Campaign tersedia sementara tidak dapat dimuat')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/case-campaigns/mobile-error-retry.png', fullPage: true });
  availableError = false;
  await page.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page.getByText('Operation Example')).toBeVisible();
});
