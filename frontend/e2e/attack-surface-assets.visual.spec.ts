import { expect, test, type Route } from '@playwright/test';

const app = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const asset = { id: 'domain-1', tenantId: 'tenant-1', name: 'example.com', type: 'DOMAIN', value: 'example.com', status: 'ACTIVE', criticality: 'HIGH', description: 'Primary public domain', owner: 'Security Operations', firstSeenAt: '2026-09-20T08:00:00.000Z', lastSeenAt: '2026-09-22T08:00:00.000Z', createdAt: '2026-09-20T08:00:00.000Z', updatedAt: '2026-09-22T08:00:00.000Z' } as const;
const ipAsset = { ...asset, id: 'ip-1', name: '203.0.113.10', value: '203.0.113.10', type: 'IP_ADDRESS' } as const;

async function json(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
}

test('captures responsive Attack Surface states', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/auth/me', route => json(route, { email: 'admin@cti.local', role: 'ADMIN', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned: true, accessible: true, featureKeys: ['asset-inventory', 'asset-discovery'] }] }));
  await page.route(/^http:\/\/localhost:3001\/attack-surface\/assets(?:\?.*)?$/, route => json(route, { items: [asset, ipAsset], total: 2, totalPages: 1 }));
  await page.route('http://localhost:3001/attack-surface/assets/domain-1/discover', route => json(route, { rootDomain: 'example.com', discovered: 12, created: 7, updated: 3, skipped: 2, failed: 0, providers: ['CLOUDFLARE_DOH', 'CRTSH'], errors: [] }));
  await page.route('http://localhost:3001/attack-surface/assets/domain-1/relationships', route => json(route, { asset: { id: asset.id, type: asset.type, value: asset.value }, relationships: [{ id: 'rel-1', type: 'DISCOVERED_SUBDOMAIN', source: 'CRT_SH', direction: 'outgoing', rootAsset: { id: asset.id, type: asset.type, value: asset.value }, relatedAsset: { id: 'sub-1', type: 'SUBDOMAIN', value: 'api.example.com' }, firstSeenAt: asset.firstSeenAt, lastSeenAt: asset.lastSeenAt }] }));
  await page.route('http://localhost:3001/attack-surface/assets/domain-1/threat-intelligence', route => json(route, { assetId: asset.id, assetType: asset.type, assetValue: asset.value, matches: [{ id: 'indicator-1', type: 'DOMAIN', value: asset.value, source: 'feed', confidence: 80, enrichmentSummary: null }] }));
  await page.route('http://localhost:3001/attack-surface/assets/ip-1/port-services', route => json(route, [{ id: 'port-1', port: 443, protocol: 'TCP', service: 'https', status: 'OPEN', firstSeenAt: asset.firstSeenAt, lastSeenAt: asset.lastSeenAt }]));
  await page.route('http://localhost:3001/attack-surface/assets/ip-1/relationships', route => json(route, { relationships: [] }));
  await page.route('http://localhost:3001/attack-surface/assets/ip-1/threat-intelligence', route => json(route, { matches: [] }));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${app}/attack-surface/assets`); await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' }); await expect(page.getByRole('heading', { name: 'Know what is exposed.' })).toBeVisible();
  await page.getByRole('button', { name: 'Discover Subdomains' }).click(); await expect(page.getByLabel('Discovery results')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/attack-surface/assets-1440.png', fullPage: true });
  await page.getByRole('button', { name: 'Detail' }).first().click(); await expect(page.getByRole('region', { name: 'Asset discovery' })).toContainText('12'); await page.getByRole('region', { name: 'Asset discovery' }).getByRole('button', { name: 'Discover subdomains' }).click(); await expect(page.getByRole('region', { name: 'Asset discovery' })).toContainText('7'); await expect(page.getByRole('region', { name: 'Threat Intelligence' })).toContainText('1 matched indicators'); await page.screenshot({ path: '../.omo/evidence/attack-surface/detail-1440.png' }); await page.getByRole('region', { name: 'Discovery Relationships' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: '../.omo/evidence/attack-surface/relationships-1440.png' }); await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.getByRole('button', { name: 'Detail' }).last().click(); await expect(page.getByRole('region', { name: 'Port and services' })).toContainText('443'); await page.getByRole('region', { name: 'Port and services' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: '../.omo/evidence/attack-surface/services-1440.png' }); await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.getByRole('button', { name: 'Terang' }).click(); await expect(page.locator('html')).toHaveClass(/light/); await page.screenshot({ path: '../.omo/evidence/attack-surface/assets-light-1440.png', fullPage: true });
  await page.getByRole('button', { name: 'Detail' }).first().click(); await page.screenshot({ path: '../.omo/evidence/attack-surface/detail-light-1440.png' }); await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.getByRole('button', { name: 'Sistem' }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Gelap' }).click();
  await page.setViewportSize({ width: 768, height: 900 }); await expect.poll(() => page.getByRole('button', { name: 'Discover Subdomains' }).evaluate(button => { const bounds = button.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= window.innerWidth; })).toBeTruthy(); await page.screenshot({ path: '../.omo/evidence/attack-surface/assets-768.png', fullPage: true });
  await page.getByRole('button', { name: 'Detail' }).first().click(); await expect(page.getByRole('region', { name: /Asset Intelligence Workspace/ })).toBeVisible(); await page.screenshot({ path: '../.omo/evidence/attack-surface/detail-768.png' }); await page.getByRole('region', { name: 'Discovery Relationships' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: '../.omo/evidence/attack-surface/relationships-768.png' }); await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.getByRole('button', { name: 'Detail' }).last().click(); await page.getByRole('region', { name: 'Port and services' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: '../.omo/evidence/attack-surface/services-768.png' }); await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.setViewportSize({ width: 375, height: 812 }); await page.screenshot({ path: '../.omo/evidence/attack-surface/assets-375.png', fullPage: true });
  await page.getByRole('button', { name: 'Detail' }).first().click(); await expect(page.getByRole('region', { name: /Asset Intelligence Workspace/ })).toBeVisible(); await page.screenshot({ path: '../.omo/evidence/attack-surface/detail-375.png' }); await page.getByRole('region', { name: 'Discovery Relationships' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: '../.omo/evidence/attack-surface/relationships-375.png' }); await page.locator('.asm-threat-table tbody tr').scrollIntoViewIfNeeded(); await page.screenshot({ path: '../.omo/evidence/attack-surface/threat-375.png' }); await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.getByRole('button', { name: 'Detail' }).last().click(); await page.getByRole('region', { name: 'Port and services' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: '../.omo/evidence/attack-surface/services-375.png' });
});

test('captures forms and non-happy states', async ({ page }) => {
  let listState: 'ready' | 'loading' | 'empty' | 'error' | 'denied' = 'ready';
  let discoveryFails = false;
  await page.route('**/auth/me', route => json(route, { email: 'admin@cti.local', role: 'ADMIN', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned: true, accessible: true, featureKeys: ['asset-inventory', 'asset-discovery'] }] }));
  await page.route(/^http:\/\/localhost:3001\/attack-surface\/assets(?:\?.*)?$/, async route => {
    if (listState === 'loading') { await new Promise(resolve => setTimeout(resolve, 1_500)); await json(route, { items: [], total: 0, totalPages: 0 }); return; }
    if (listState === 'error') { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Inventory service unavailable' }) }); return; }
    if (listState === 'denied') { await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Forbidden' }) }); return; }
    await json(route, listState === 'empty' ? { items: [], total: 0, totalPages: 0 } : { items: [asset], total: 1, totalPages: 1 });
  });
  await page.route('http://localhost:3001/attack-surface/assets/domain-1/discover', route => discoveryFails ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'Provider unavailable' }) }) : json(route, { rootDomain: 'example.com', discovered: 0, created: 0, updated: 0, skipped: 0, failed: 0, providers: [], errors: [] }));
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(`${app}/attack-surface/assets`); await expect(page.getByRole('heading', { name: 'Know what is exposed.' })).toBeVisible();
  await page.getByRole('button', { name: 'Create asset' }).click(); await page.screenshot({ path: '../.omo/evidence/attack-surface/create-1280.png', fullPage: true }); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit' }).click(); await page.screenshot({ path: '../.omo/evidence/attack-surface/edit-1280.png', fullPage: true }); await page.setViewportSize({ width: 375, height: 812 }); await expect(page.getByRole('dialog', { name: 'Edit Asset' })).toBeVisible(); await page.screenshot({ path: '../.omo/evidence/attack-surface/edit-375.png', fullPage: true }); await page.getByRole('dialog', { name: 'Edit Asset' }).getByRole('button', { name: 'Close' }).click(); await page.setViewportSize({ width: 1280, height: 900 });
  discoveryFails = true; await page.getByRole('button', { name: 'Discover Subdomains' }).click(); await expect(page.locator('.error[role="alert"]')).toBeVisible(); await page.screenshot({ path: '../.omo/evidence/attack-surface/discovery-error-1280.png', fullPage: true });
  listState = 'loading'; await page.reload(); await expect(page.getByText('Loading assets...')).toBeVisible(); await page.screenshot({ path: '../.omo/evidence/attack-surface/loading-1280.png', fullPage: true }); await expect(page.getByText('No assets found')).toBeVisible();
  listState = 'empty'; await page.reload(); await expect(page.getByText('No assets found')).toBeVisible(); await page.screenshot({ path: '../.omo/evidence/attack-surface/empty-1280.png', fullPage: true });
  listState = 'error'; await page.reload(); await expect(page.locator('.error[role="alert"]')).toBeVisible(); await page.screenshot({ path: '../.omo/evidence/attack-surface/error-1280.png', fullPage: true });
  listState = 'denied'; await page.reload(); await expect(page.getByText('Module access required')).toBeVisible(); await page.screenshot({ path: '../.omo/evidence/attack-surface/api-403-1280.png', fullPage: true });
  await page.unrouteAll(); await page.route('**/auth/me', route => json(route, { email: 'analyst@cti.local', role: 'USER', moduleAccess: [] })); await page.goto(`${app}/attack-surface/assets`); await expect(page.getByText('Access denied')).toBeVisible(); await page.screenshot({ path: '../.omo/evidence/attack-surface/module-denied-1280.png', fullPage: true });
});
