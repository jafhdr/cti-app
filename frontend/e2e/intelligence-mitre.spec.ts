import { expect, test, type Page } from '@playwright/test';

const app = process.env.SOURCES_APP_URL || 'http://localhost:3000';
const technique = { id: 'technique-1', externalId: 'T1059', name: 'Command and Scripting Interpreter', description: 'Executes commands and scripts.', tactic: 'Execution', platform: 'Windows', url: 'https://attack.mitre.org/techniques/T1059/', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', campaigns: [{ campaign: { id: 'campaign-1', name: 'Operation Phantom', status: 'ACTIVE' } }], _count: { campaigns: 1 } } as const;

async function session(page: Page, role: 'ADMIN' | 'USER' = 'ADMIN'): Promise<void> {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'user', email: 'user@example.test', role, tenantId: 'tenant-a', moduleAccess: [{ moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, featureKeys: [] }] } }));
}

async function mitrePage(page: Page): Promise<void> {
  await session(page);
  await page.route('http://localhost:3001/audit-logs**', route => route.fulfill({ json: { items: [{ id: 'audit-1', createdAt: '2026-09-15T08:00:00.000Z', metadata: { total: 191, created: 191, updated: 0, failed: 0 } }], page: 1, limit: 1, total: 1 } }));
  await page.route('http://localhost:3001/intelligence/mitre-techniques**', route => route.fulfill({ json: { items: [technique], page: 1, limit: 10, total: 1, totalPages: 1 } }));
}

test('MITRE ATT&CK page displays the latest sync summary', async ({ page }) => {
  await mitrePage(page);
  await page.goto(`${app}/threat-intelligence/mitre-attack`);
  await expect(page.getByRole('region', { name: 'MITRE ATT&CK sync status' })).toBeVisible();
  await expect(page.getByTestId('mitre-sync-total')).toHaveText('191');
  await expect(page.getByTestId('mitre-sync-created')).toHaveText('191');
  await expect(page.getByTestId('mitre-sync-updated')).toHaveText('0');
  await expect(page.getByTestId('mitre-sync-failed')).toHaveText('0');
  await expect(page.getByText('15 Sep 2026', { exact: false })).toBeVisible();
  for (const viewport of [{ name: 'mobile', width: 375, height: 812 }, { name: 'tablet', width: 768, height: 900 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.screenshot({ path: `../.omo/evidence/mitre-sync/page-${viewport.name}.png`, fullPage: true });
  }
});

test('Sync Now shows loading and refreshes the successful result', async ({ page }) => {
  await mitrePage(page);
  const pending = Promise.withResolvers<void>();
  await page.route('http://localhost:3001/intelligence/threat-actors/ingest-mitre', async route => {
    await pending.promise;
    await route.fulfill({ json: { total: 191, created: 0, updated: 191, failed: 0 } });
  });
  await page.goto(`${app}/threat-intelligence/mitre-attack`);
  await page.getByRole('button', { name: 'Sync Now' }).click();
  await expect(page.getByRole('button', { name: 'Syncing MITRE ATT&CK' })).toBeDisabled();
  await page.screenshot({ path: '../.omo/evidence/mitre-sync/loading.png', fullPage: true });
  pending.resolve();
  await expect(page.getByRole('status')).toContainText('Sync selesai');
  await expect(page.getByTestId('mitre-sync-updated')).toHaveText('191');
  await expect(page.getByTestId('mitre-sync-created')).toHaveText('0');
  await page.screenshot({ path: '../.omo/evidence/mitre-sync/success.png', fullPage: true });
});

test('Sync Now exposes an ingestion error and restores the action', async ({ page }) => {
  await mitrePage(page);
  await page.route('http://localhost:3001/intelligence/threat-actors/ingest-mitre', route => route.fulfill({ status: 500, json: { message: 'MITRE upstream unavailable' } }));
  await page.goto(`${app}/threat-intelligence/mitre-attack`);
  await page.getByRole('button', { name: 'Sync Now' }).click();
  await expect(page.getByRole('region', { name: 'MITRE ATT&CK sync status' }).getByRole('alert')).toContainText('MITRE upstream unavailable');
  await expect(page.getByRole('button', { name: 'Sync Now' })).toBeEnabled();
  await page.screenshot({ path: '../.omo/evidence/mitre-sync/error.png', fullPage: true });
});

test('admin completes MITRE technique CRUD and sees campaign relation', async ({ page }) => {
  await session(page); const methods: string[] = []; let requestUrl = '';
  await page.route('http://localhost:3001/intelligence/mitre-techniques**', route => { methods.push(route.request().method()); requestUrl = route.request().url(); if (route.request().method() === 'GET' && requestUrl.includes('technique-1')) return route.fulfill({ json: technique }); if (route.request().method() === 'GET') return route.fulfill({ json: { items: [technique], page: 1, limit: 10, total: 1, totalPages: 1 } }); return route.fulfill({ json: route.request().method() === 'DELETE' ? { deleted: true, id: technique.id } : technique }); });
  await page.goto(`${app}/threat-intelligence/mitre-attack`);
  await expect(page.getByRole('button', { name: 'T1059' })).toBeVisible();
  await page.getByRole('button', { name: 'T1059' }).click();
  await expect(page.getByRole('region', { name: technique.name })).toContainText('Operation Phantom');
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: '../.omo/evidence/intelligence-mitre/detail-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByLabel('Search MITRE techniques').fill('T1059');
  await expect.poll(() => requestUrl).toContain('search=T1059');
  await page.getByRole('button', { name: '+ Add technique' }).click();
  const form = page.locator('form'); await form.getByLabel('External ID').fill('T1003'); await form.getByLabel('Name').fill('OS Credential Dumping'); await form.getByLabel('Tactic').fill('Credential Access'); await form.getByLabel('Platform').fill('Windows'); await page.getByRole('button', { name: 'Save technique' }).click();
  await expect.poll(() => methods).toContain('POST'); await page.getByRole('button', { name: 'Edit' }).click(); await page.getByLabel('Name').fill('Updated technique'); await page.getByRole('button', { name: 'Save technique' }).click(); await expect.poll(() => methods).toContain('PATCH'); page.on('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Delete' }).click(); await expect.poll(() => methods).toContain('DELETE');
});

test('user can read MITRE techniques but cannot manage them', async ({ page }) => {
  await session(page, 'USER'); await page.route('http://localhost:3001/intelligence/mitre-techniques**', route => route.fulfill({ json: { items: [technique], page: 1, limit: 10, total: 1, totalPages: 1 } })); await page.goto(`${app}/threat-intelligence/mitre-attack`); await expect(page.getByRole('button', { name: 'T1059' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Sync Now' })).toHaveCount(0); await expect(page.getByRole('button', { name: '+ Add technique' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
});
