import { expect, test, type Page } from '@playwright/test';

const app = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const evidence = '../.omo/evidence/attack-surface/modal-migration';
const asset = { id: 'domain-1', tenantId: 'tenant-1', name: 'example.com', type: 'DOMAIN', value: 'example.com', status: 'ACTIVE', criticality: 'HIGH', description: 'Public domain', owner: 'Security', firstSeenAt: '2026-09-22T08:00:00.000Z', lastSeenAt: '2026-09-22T08:00:00.000Z', createdAt: '2026-09-22T08:00:00.000Z', updatedAt: '2026-09-22T08:00:00.000Z' };

async function fixtures(page: Page) {
  await page.route('**/auth/me', route => route.fulfill({ json: { email: 'admin@cti.local', role: 'ADMIN', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned: true, accessible: true, featureKeys: ['asset-inventory', 'asset-discovery'] }] } }));
  await page.route(/^http:\/\/localhost:3001\/attack-surface\/assets(?:\?.*)?$/, route => route.fulfill({ json: { items: [asset], total: 1, totalPages: 1 } }));
  await page.route('http://localhost:3001/attack-surface/assets/domain-1/relationships', route => route.fulfill({ json: { relationships: [{ id: 'rel-1', type: 'DISCOVERED_SUBDOMAIN', source: 'CRT_SH', direction: 'outgoing', rootAsset: { id: asset.id, type: asset.type, value: asset.value }, relatedAsset: { id: 'sub-1', type: 'SUBDOMAIN', value: 'api.example.com' }, firstSeenAt: asset.firstSeenAt, lastSeenAt: asset.lastSeenAt }] } }));
  await page.route('http://localhost:3001/attack-surface/assets/domain-1/threat-intelligence', route => route.fulfill({ json: { matches: [] } }));
  await page.route('http://localhost:3001/attack-surface/assets/domain-1/discover', route => route.fulfill({ json: { rootDomain: 'example.com', discovered: 2, created: 1, updated: 1, skipped: 0, failed: 0, providers: ['CRTSH'], errors: [] } }));
}

test('ASM form overlay and page-level detail preserve focus, themes, and responsive layout', async ({ browser }) => {
  for (const width of [1440, 768, 375]) for (const [theme, scheme] of [['dark','dark'], ['light','light'], ['system-dark','dark'], ['system-light','light']] as const) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, colorScheme: scheme });
    await context.addInitScript(value => localStorage.setItem('cti-theme', value), theme.startsWith('system') ? 'system' : theme);
    const page = await context.newPage(); await fixtures(page); await page.goto(`${app}/attack-surface/assets`);
    const createTrigger = page.getByRole('button', { name: 'Create asset' }); await createTrigger.click();
    const form = page.getByRole('dialog', { name: 'Create Asset' }); await expect(form).toBeVisible();
    await expect.poll(() => form.evaluate(node => node.contains(document.activeElement))).toBe(true);
    expect(await page.evaluate(() => ({ lock: document.body.style.overflow === 'hidden', inert: Array.from(document.body.children).some(node => node.hasAttribute('inert')), overflow: document.documentElement.scrollWidth > innerWidth }))).toEqual({ lock: true, inert: true, overflow: false });
    if ((width === 1440 || width === 375) && theme === 'dark') await page.screenshot({ path: `${evidence}/asset-create-${width}.png` });
    await page.keyboard.press('Escape'); await expect(form).toBeHidden(); await expect(createTrigger).toBeFocused();
    await page.getByRole('button', { name: 'Detail' }).click(); const workspace = page.getByRole('region', { name: /Asset Intelligence Workspace/ }); await expect(workspace).toBeVisible();
    await expect(workspace.getByRole('heading', { name: 'Asset overview' })).toBeVisible();
    await expect(workspace).toBeFocused(); await expect(page.getByRole('dialog')).toHaveCount(0);
    if ((width === 1440 || width === 375) && theme === 'dark') await page.screenshot({ path: `${evidence}/asset-detail-${width}.png` });
    if (width === 375 && theme === 'dark') { await workspace.getByRole('region', { name: 'Discovery Relationships' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/relationships-375.png` }); }
    await workspace.getByRole('button', { name: 'Back to assets' }).click(); await expect(workspace).toBeHidden();
    await context.close();
  }
});

test('Discovery stays in workspace and Delete uses contextual confirmation', async ({ page }) => {
  await fixtures(page); await page.setViewportSize({ width: 1440, height: 850 }); await page.goto(`${app}/attack-surface/assets`);
  await page.getByRole('button', { name: 'Discover Subdomains' }).click(); await expect(page.getByRole('region', { name: 'Discovery results' })).toContainText('CRTSH');
  await page.screenshot({ path: `${evidence}/discovery-1440.png` });
  await page.setViewportSize({ width: 375, height: 812 }); await page.screenshot({ path: `${evidence}/discovery-375.png` });
  await page.getByRole('button', { name: 'Delete', exact: true }).click(); const confirmation = page.getByRole('dialog', { name: 'Delete Asset?' });
  await expect(confirmation).toContainText('example.com'); await page.screenshot({ path: `${evidence}/confirmation-375.png` });
  await page.locator('.cti-overlay').click({ position: { x: 2, y: 2 } }); await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel' }).click(); await expect(confirmation).toBeHidden();
});

test('Asset form and delete errors remain open and retryable', async ({ page }) => {
  await fixtures(page);
  let createRequests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/^http:\/\/localhost:3001\/attack-surface\/assets(?:\?.*)?$/, async route => {
    if (route.request().method() === 'POST') { createRequests += 1; if (createRequests === 1) { await gate; await route.fulfill({ status: 500, json: { message: 'Create failed' } }); } else await route.fulfill({ status: 201, json: asset }); return; }
    await route.fulfill({ json: { items: [asset], total: 1, totalPages: 1 } });
  });
  await page.route('http://localhost:3001/attack-surface/assets/domain-1', route => route.fulfill({ status: 500, json: { message: route.request().method() === 'PATCH' ? 'Edit failed' : 'Delete failed' } }));
  await page.goto(`${app}/attack-surface/assets`); await page.getByRole('button', { name: 'Create asset' }).click();
  const create = page.getByRole('dialog', { name: 'Create Asset' });
  await create.getByRole('button', { name: 'Create asset' }).click(); await expect(create.getByLabel('Name')).toBeFocused();
  await create.getByLabel('Name').fill('new.example.com'); await create.getByLabel('Value').fill('new.example.com');
  await create.getByRole('button', { name: 'Create asset' }).click(); await expect(create.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(createRequests).toBe(1); release?.(); await expect(create.getByRole('alert')).toContainText('Create failed');
  await create.getByRole('button', { name: 'Create asset' }).click(); await expect(create).toBeHidden(); expect(createRequests).toBe(2);
  await page.getByRole('button', { name: 'Edit' }).click(); const edit = page.getByRole('dialog', { name: 'Edit Asset' });
  await expect(edit.getByLabel('Name')).toHaveValue('example.com'); await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit.getByRole('alert')).toContainText('Edit failed'); await edit.getByRole('button', { name: 'Cancel' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Delete', exact: true }).click(); const confirmation = page.getByRole('dialog', { name: 'Delete Asset?' });
  await confirmation.getByRole('button', { name: 'Delete Asset' }).click(); await expect(confirmation.getByRole('alert')).toContainText('Delete failed');
  await expect(confirmation).toBeVisible();
});
