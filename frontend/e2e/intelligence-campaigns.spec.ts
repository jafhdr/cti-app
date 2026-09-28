import { expect, test, type Page } from '@playwright/test';

const app = process.env.SOURCES_APP_URL || 'http://localhost:3000';
const actor = { id: 'actor-1', entity: { name: 'Lazarus Group' } } as const;
const indicator = { id: 'ioc-1', value: 'evil.example', type: 'DOMAIN', severity: 'HIGH', status: 'ACTIVE' } as const;
const mitreTechnique = { id: 'technique-1', externalId: 'T1059', name: 'Command and Scripting Interpreter', tactic: 'Execution', platform: 'Windows' } as const;
const campaign = {
  id: 'campaign-1', name: 'Operation Phantom', description: 'Credential theft campaign', objective: 'Collect credentials',
  status: 'ACTIVE', severity: 'HIGH', confidence: 88, startDate: '2026-08-01T00:00:00.000Z', endDate: null,
  externalId: 'CAM-001', referenceUrl: 'https://example.org/campaign', threatActorId: actor.id,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z', threatActor: actor,
  indicators: [{ indicator }], mitreTechniques: [{ mitreTechnique }], _count: { indicators: 1, mitreTechniques: 1 },
} as const;

async function session(page: Page, role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' = 'ADMIN'): Promise<void> {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'user', email: 'user@example.test', role, tenantId: role === 'SUPER_ADMIN' ? null : 'tenant-a', moduleAccess: [{ moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, accessible: true, featureKeys: [] }] } }));
  if (role === 'SUPER_ADMIN') await page.route('**/users/tenants', route => route.fulfill({ json: [{ id: 'tenant-a', name: 'Tenant A' }] }));
}

test('admin completes campaign CRUD using existing actor and indicators', async ({ page }) => {
  page.on('pageerror', error => console.error(error.stack));
  await session(page);
  const methods: string[] = [];
  let requestUrl = '';
  await page.route('http://localhost:3001/intelligence/campaigns**', route => {
    methods.push(route.request().method()); requestUrl = route.request().url();
    if (route.request().method() === 'GET' && requestUrl.includes('campaign-1')) return route.fulfill({ json: campaign });
    if (route.request().method() === 'GET') return route.fulfill({ json: { items: [campaign], page: 1, limit: 10, total: 1, totalPages: 1 } });
    return route.fulfill({ json: route.request().method() === 'DELETE' ? { deleted: true, id: campaign.id } : campaign });
  });
  await page.route('http://localhost:3001/intelligence/campaigns/relations**', route => route.fulfill({ json: { threatActors: [actor], indicators: [indicator], mitreTechniques: [mitreTechnique] } }));
  await page.goto(`${app}/threat-intelligence/campaigns`);
  await expect(page.getByRole('button', { name: 'Operation Phantom' })).toBeVisible();
  await page.getByRole('button', { name: 'Operation Phantom' }).click();
  await expect(page.getByRole('region', { name: 'Operation Phantom' })).toContainText('Lazarus Group');
  await expect(page.getByRole('region', { name: 'Operation Phantom' })).toContainText('evil.example');
  await expect(page.getByRole('region', { name: 'Operation Phantom' })).toContainText('T1059');
  await expect(page.getByRole('region', { name: 'Operation Phantom' })).toContainText('1 indicator');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '../.omo/evidence/intelligence-campaigns/detail-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 768, height: 900 });
  await page.screenshot({ path: '../.omo/evidence/intelligence-campaigns/detail-tablet.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: '../.omo/evidence/intelligence-campaigns/detail-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByLabel('Search campaigns').fill('phantom');
  await expect.poll(() => requestUrl).toContain('search=phantom');
  await page.getByRole('button', { name: '+ Add campaign' }).click();
  await page.getByLabel('Name').fill('New Campaign');
  await page.locator('form').getByLabel('Threat actor').selectOption(actor.id);
  await page.locator('form').getByLabel('Indicators').selectOption(indicator.id);
  await page.locator('form').getByLabel('MITRE techniques').selectOption(mitreTechnique.id);
  await page.getByRole('button', { name: 'Save campaign' }).click();
  await expect.poll(() => methods).toContain('POST');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Objective').fill('Updated objective');
  await page.getByRole('button', { name: 'Save campaign' }).click();
  await expect.poll(() => methods).toContain('PATCH');
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => methods).toContain('DELETE');
});

test('user can read campaigns but cannot manage them', async ({ page }) => {
  page.on('pageerror', error => console.error(error.stack));
  await session(page, 'USER');
  await page.route('http://localhost:3001/intelligence/campaigns**', route => route.fulfill({ json: { items: [campaign], page: 1, limit: 10, total: 1, totalPages: 1 } }));
  await page.route('http://localhost:3001/intelligence/campaigns/relations**', route => route.fulfill({ json: { threatActors: [actor], indicators: [indicator], mitreTechniques: [mitreTechnique] } }));
  await page.goto(`${app}/threat-intelligence/campaigns`);
  await expect(page.getByRole('button', { name: 'Operation Phantom' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add campaign' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
});
