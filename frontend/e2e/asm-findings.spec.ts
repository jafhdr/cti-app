import { expect, test, type Page, type Route } from '@playwright/test';

const app = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const api = 'http://localhost:3001/attack-surface/assets/asset-1/findings';
const observed = '2026-09-30T00:00:00.000Z';
const asset = { id: 'asset-1', tenantId: 'tenant-1', name: '192.0.2.10', type: 'IP_ADDRESS', value: '192.0.2.10', status: 'ACTIVE', criticality: 'HIGH', description: null, owner: null, firstSeenAt: observed, lastSeenAt: observed, createdAt: observed, updatedAt: observed };
const finding = { id: 'finding-1', tenantId: 'tenant-1', assetId: asset.id, title: 'rdp exposed on TCP 3389', description: 'TCP port accepted a connection.', type: 'EXPOSED_SERVICE', severity: 'MEDIUM', status: 'OPEN', source: 'PORT_DISCOVERY', evidence: { port: 3389 }, firstSeenAt: observed, lastSeenAt: observed };
async function json(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); }
async function setup(page: Page) {
  await page.route('**/auth/me', route => json(route, { email: 'analyst@cti.local', role: 'USER', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned: true, accessible: true, featureKeys: ['asset-management', 'asset-discovery'] }] }));
  await page.route(/^http:\/\/localhost:3001\/attack-surface\/assets(?:\?.*)?$/, route => json(route, { items: [asset], total: 1, totalPages: 1 }));
  await page.route('**/attack-surface/assets/asset-1/port-services', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/relationships', route => json(route, { asset, relationships: [] }));
  await page.route('**/attack-surface/assets/asset-1/threat-intelligence', route => json(route, { matches: [] }));
}

test('shows empty and populated findings with deterministic risk counts', async ({ page }) => {
  await setup(page);
  let populated = false;
  await page.route(api, route => json(route, populated ? [finding] : []));
  await page.route(`${api}/risk-summary`, route => json(route, populated ? { total: 1, critical: 0, high: 0, medium: 1, low: 0, open: 1 } : { total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0 }));
  await page.goto(`${app}/attack-surface/assets`);
  await page.getByRole('button', { name: 'Detail' }).click();
  const section = page.getByRole('region', { name: /Asset Intelligence Workspace/ }).getByLabel('Findings and risk assessment');
  await expect(section).toContainText('No findings recorded for this asset.');
  populated = true;
  await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(section.getByText('rdp exposed on TCP 3389')).toBeVisible();
  await expect(section.getByLabel('Risk summary')).toContainText('Medium1');
  await section.getByRole('button', { name: 'View' }).click();
  await expect(section.getByLabel('Finding detail')).toContainText('TCP port accepted a connection.');
});

test('shows a retry action when findings API fails', async ({ page }) => {
  await setup(page);
  await page.route(api, route => json(route, { message: 'Unavailable' }, 500));
  await page.route(`${api}/risk-summary`, route => json(route, { total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0 }));
  await page.goto(`${app}/attack-surface/assets`);
  await page.getByRole('button', { name: 'Detail' }).click();
  const section = page.getByLabel('Findings and risk assessment');
  await expect(section.getByRole('alert')).toContainText('Failed to load asset findings.');
  await expect(section.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('renders the populated finding detail at desktop and mobile widths', async ({ page }) => {
  await setup(page);
  await page.route(api, route => json(route, [finding]));
  await page.route(`${api}/risk-summary`, route => json(route, { total: 1, critical: 0, high: 0, medium: 1, low: 0, open: 1 }));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${app}/attack-surface/assets`);
    await page.getByRole('button', { name: 'Detail' }).click();
    const section = page.getByLabel('Findings and risk assessment');
    await expect(section.getByText('rdp exposed on TCP 3389')).toBeVisible();
    await section.screenshot({ path: `test-results/asm-findings-${width}.png` });
  }
});
