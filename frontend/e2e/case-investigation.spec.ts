import { expect, test } from '@playwright/test';

test('analyst adds an investigation note and evidence and sees timeline activity', async ({ page }) => {
  const notes: Array<Record<string, unknown>> = [];
  const evidence: Array<Record<string, unknown>> = [];
  const activity: Array<Record<string, unknown>> = [];
  const person = { id: 'user-1', name: 'Analyst', email: 'analyst@test.local' };

  await page.route('**/auth/me', async (route) => route.fulfill({ json: {
    id: person.id,
    email: person.email,
    role: 'USER',
    moduleAccess: [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] }],
  } }));

  await page.route('http://localhost:3001/cases/case-1', async (route) => route.fulfill({ json: { id: 'case-1', caseNumber: 'CASE-2026-00001', title: 'Suspicious login', description: 'Investigate access', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', creator: person, tenant: { id: 'tenant-1', name: 'Acme', slug: 'acme' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }));
  await page.route('http://localhost:3001/cases/case-1/notes', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.requestId).toBeTruthy();
      const item = { id: 'note-1', content: body.content, author: person, createdAt: new Date().toISOString() };
      notes.unshift(item);
      activity.unshift({ id: 'activity-note', action: 'NOTE_ADDED', createdAt: new Date().toISOString() });
      await route.fulfill({ status: 201, json: item });
      return;
    }
    await route.fulfill({ json: notes });
  });
  await page.route('http://localhost:3001/cases/case-1/evidence', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.requestId).toBeTruthy();
      const item = { id: 'evidence-1', ...body, creator: person, createdAt: new Date().toISOString() };
      evidence.unshift(item);
      activity.unshift({ id: 'activity-evidence', action: 'EVIDENCE_ADDED', createdAt: new Date().toISOString() });
      await route.fulfill({ status: 201, json: item });
      return;
    }
    await route.fulfill({ json: evidence });
  });
  await page.route('http://localhost:3001/cases/case-1/activity', async (route) => route.fulfill({ json: activity }));
  await page.route('http://localhost:3001/cases/case-1/indicators', async (route) => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/threat-actors', async (route) => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/campaigns', async (route) => route.fulfill({ json: [] }));

  await page.goto('http://localhost:3000/cases/case-1');
  await expect(page.getByRole('navigation', { name: 'Bagian detail case' })).toBeVisible();
  await expect(page.getByText('Belum ada catatan investigasi.')).toBeVisible();
  await page.getByLabel('Catatan investigasi').fill('IP sumber telah divalidasi');
  await page.getByLabel('Tambah catatan').click();
  await expect(page.getByText('IP sumber telah divalidasi')).toBeVisible();
  await page.getByRole('button', { name: 'Add Evidence' }).click();
  await expect(page.getByRole('dialog', { name: 'Add Evidence' })).toBeVisible();
  await page.getByLabel('Nama evidence').fill('auth.log');
  await page.getByLabel('Tipe evidence').fill('log');
  await page.getByLabel('Sumber evidence').fill('SIEM');
  await page.getByRole('button', { name: 'Tambah Evidence' }).click();
  await expect(page.getByText('auth.log')).toBeVisible();
  await expect(page.getByText('Evidence ditambahkan')).toBeVisible();
  await expect(page.getByText('Catatan investigasi ditambahkan')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Related Intelligence', exact: true })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/cases/investigation-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Investigation Notes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evidence', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../.omo/evidence/cases/investigation-mobile.png', fullPage: true });
  const evidencePath = '../.omo/evidence/cases/phase2';
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => localStorage.setItem('cti-theme', value), theme);
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Investigation', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidencePath}/case-phase2-${theme}-${width}.png`, fullPage: true });
    }
  }
  for (const colorScheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(() => localStorage.setItem('cti-theme', 'system'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
  }
});
