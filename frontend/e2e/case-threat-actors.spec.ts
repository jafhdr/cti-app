import { expect, test } from '@playwright/test';

test('admin searches, links, and removes an existing threat actor from a case', async ({ page }) => {
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  const person = { id: 'admin-1', name: 'Admin', email: 'admin@test.local' };
  const available = { id: 'actor-1', aliases: ['APT Example'], motivation: 'Espionage', targetSectors: ['Finance'], country: 'ID', region: 'SEA', status: 'ACTIVE', entity: { id: 'entity-1', name: 'Example Group', description: 'Tracked actor', externalId: 'G9999', confidence: 80, severity: 'HIGH' } };
  let linked: readonly typeof available[] = [];

  await page.route('**/auth/me', async (route) => route.fulfill({ json: {
    id: person.id,
    email: person.email,
    role: 'ADMIN',
    moduleAccess: [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, featureKeys: [] }],
  } }));
  await page.route('http://localhost:3001/cases/case-1', async (route) => route.fulfill({ json: { id: 'case-1', caseNumber: 'CASE-2026-00001', title: 'Suspicious login', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', creator: person, tenant: { id: 'tenant-1', name: 'Acme', slug: 'acme' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }));
  await page.route('http://localhost:3001/cases/case-1/threat-actors', async (route) => {
    if (route.request().method() === 'POST') {
      linked = [available];
      await route.fulfill({ status: 201, json: available });
      return;
    }
    await route.fulfill({ json: linked });
  });
  await page.route('http://localhost:3001/cases/case-1/threat-actors/available**', async (route) => route.fulfill({ json: linked.length === 0 ? [available] : [] }));
  await page.route('http://localhost:3001/cases/case-1/threat-actors/actor-1', async (route) => {
    linked = [];
    await route.fulfill({ json: { success: true } });
  });
  await page.route('http://localhost:3001/cases/case-1/indicators', async (route) => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/notes', async (route) => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/evidence', async (route) => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/activity', async (route) => route.fulfill({ json: [] }));

  await page.goto(`${baseUrl}/cases/case-1`);
  await expect(page.getByRole('heading', { name: 'Threat Actors' })).toBeVisible();
  await expect(page.getByText('Belum ada Threat Actor yang terhubung.')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/case-threat-actors/desktop-empty.png', fullPage: true });
  const addButton = page.getByRole('button', { name: 'Add Threat Actor' });
  await addButton.click();
  const searchInput = page.getByPlaceholder('Cari nama, alias, motivasi, atau negara...');
  await expect(searchInput).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Add Threat Actor' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/case-threat-actors/desktop-dialog.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Add Threat Actor' })).toBeHidden();
  await expect(addButton).toBeFocused();
  await addButton.click();
  await searchInput.fill('Example');
  await expect(page.getByText('Example Group')).toBeVisible();
  await page.getByRole('button', { name: 'Hubungkan Example Group' }).click();
  await expect(page.getByRole('heading', { name: 'Example Group' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/case-threat-actors/desktop-linked.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Threat Actors' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../.omo/evidence/case-threat-actors/mobile-linked.png', fullPage: true });
  await page.getByRole('button', { name: 'Lepas Example Group' }).click();
  await expect(page.getByText('Belum ada Threat Actor yang terhubung.')).toBeVisible();
});
