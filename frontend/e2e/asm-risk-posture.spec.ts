import { expect, test, type Route } from '@playwright/test';
const asset = { id: 'asset-1', tenantId: 'tenant-1', name: 'Risk IP', type: 'IP_ADDRESS', value: '192.0.2.10', status: 'ACTIVE', criticality: 'HIGH', description: null, owner: null, firstSeenAt: null, lastSeenAt: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
test('risk posture empty and persisted history at desktop and mobile', async ({ page }) => {
  await page.route('**/auth/me', route => json(route, { email: 'qa@local', role: 'ADMIN', moduleAccess: [{ moduleSlug: 'attack-surface-management', accessible: true, featureKeys: ['asset-management'] }] }));
  await page.route(/^http:\/\/localhost:3001\/attack-surface\/assets(?:\?.*)?$/, route => json(route, { items: [asset], total: 1, totalPages: 1 }));
  await page.route('**/attack-surface/assets/asset-1/port-services', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/relationships', route => json(route, { asset, relationships: [] }));
  await page.route('**/attack-surface/assets/asset-1/threat-intelligence', route => json(route, { matches: [] }));
  await page.route('**/attack-surface/assets/asset-1/findings/risk-summary', route => json(route, { total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0 }));
  await page.route('**/attack-surface/assets/asset-1/findings', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/vulnerability-correlations', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/alerts', route => json(route, []));
  let current: object | null = null;
  await page.route('**/attack-surface/assets/asset-1/risk-posture', route => json(route, { current, previous: current ? { score: 3 } : null, history: current ? [current] : [] }));
  await page.goto('http://localhost:3000/attack-surface/assets');
  await page.getByRole('button', { name: 'Detail' }).click();
  const section = page.getByLabel('Risk posture');
  await expect(section).toContainText('No risk baseline yet');
  current = { score: 11, total: 3, critical: 1, high: 0, medium: 1, low: 1, trend: 'INCREASED', evaluatedAt: '2026-10-01T00:00:00Z' };
  await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(section).toContainText('Current score');
  await expect(section).toContainText('increased');
  await expect(section).toContainText('Active findings: 3');
  for (const width of [1280, 390]) { await page.setViewportSize({ width, height: 900 }); await section.screenshot({ path: `test-results/asm-risk-posture-${width}.png` }); }
});
