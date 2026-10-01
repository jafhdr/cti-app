import { expect, test, type Page, type Route } from '@playwright/test';

const api = 'http://localhost:3001/attack-surface/assets/asset-1/vulnerability-correlations';
const observed = '2026-09-30T00:00:00.000Z';
const asset = { id: 'asset-1', tenantId: 'tenant-1', name: '192.0.2.10', type: 'IP_ADDRESS', value: '192.0.2.10', status: 'ACTIVE', criticality: 'HIGH', description: null, owner: null, firstSeenAt: observed, lastSeenAt: observed, createdAt: observed, updatedAt: observed };
const base = { id: 'correlation-1', status: 'ACTIVE', matchReason: 'Exact product and version match', service: { protocol: 'TCP', port: 22, service: 'ssh', product: 'OpenSSH', version: '8.4' }, vulnerability: { cveId: 'CVE-2026-99999', name: 'OpenSSH issue', severity: 'HIGH', cvssScore: 8.1, source: 'Catalog' } };
async function json(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); }
async function setup(page: Page, response: readonly unknown[] | null) {
  await page.route('**/auth/me', route => json(route, { email: 'analyst@cti.local', role: 'USER', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned: true, accessible: true, featureKeys: ['asset-management'] }] }));
  await page.route(/^http:\/\/localhost:3001\/attack-surface\/assets(?:\?.*)?$/, route => json(route, { items: [asset], total: 1, totalPages: 1 }));
  await page.route('**/attack-surface/assets/asset-1/port-services', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/relationships', route => json(route, { asset, relationships: [] }));
  await page.route('**/attack-surface/assets/asset-1/threat-intelligence', route => json(route, { matches: [] }));
  await page.route('**/attack-surface/assets/asset-1/findings', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/findings/risk-summary', route => json(route, { total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0 }));
  await page.route(api, route => json(route, response ?? { message: 'Unavailable' }, response === null ? 500 : 200));
  await page.goto('http://localhost:3000/attack-surface/assets');
  await page.getByRole('button', { name: 'Detail' }).click();
}

test('empty and error states explain correlation availability', async ({ page }) => {
  await setup(page, []);
  await expect(page.getByLabel('Vulnerabilities')).toContainText('No vulnerability correlations recorded.');
  await page.route(api, route => json(route, { message: 'Unavailable' }, 500));
  await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(page.getByLabel('Vulnerabilities').getByRole('alert')).toContainText('Could not load vulnerability correlations.');
});

test('confirmed, candidate, and stale rows stay distinct on desktop and mobile', async ({ page }) => {
  await setup(page, [{ ...base, confidence: 'HIGH' }, { ...base, id: 'candidate', confidence: 'LOW', matchReason: 'Product matches; service version is unknown', service: { ...base.service, version: null } }, { ...base, id: 'stale', status: 'STALE', confidence: 'HIGH' }]);
  const section = page.getByLabel('Vulnerabilities');
  await expect(section.getByText('Confirmed match')).toBeVisible();
  await expect(section.getByText('Candidate · review needed')).toBeVisible();
  await expect(section.getByText('No longer observed')).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await section.screenshot({ path: `test-results/asm-vulnerabilities-${width}.png` });
  }
});
