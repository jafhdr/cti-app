import { expect, test, type Page } from '@playwright/test';

const app = process.env.SOURCES_APP_URL || 'http://localhost:3000';
const technique = { id: 'technique-1', externalId: 'T1059', name: 'Command and Scripting Interpreter', description: 'Executes commands and scripts.', tactic: 'Execution', platform: 'Windows', url: 'https://attack.mitre.org/techniques/T1059/', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', campaigns: [{ campaign: { id: 'campaign-1', name: 'Operation Phantom', status: 'ACTIVE' } }], _count: { campaigns: 1 } } as const;

async function session(page: Page, role: 'ADMIN' | 'USER' = 'ADMIN'): Promise<void> {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'user', email: 'user@example.test', role, tenantId: 'tenant-a', moduleAccess: [{ moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, featureKeys: [] }] } }));
}

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
  await session(page, 'USER'); await page.route('http://localhost:3001/intelligence/mitre-techniques**', route => route.fulfill({ json: { items: [technique], page: 1, limit: 10, total: 1, totalPages: 1 } })); await page.goto(`${app}/threat-intelligence/mitre-attack`); await expect(page.getByRole('button', { name: 'T1059' })).toBeVisible(); await expect(page.getByRole('button', { name: '+ Add technique' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
});
