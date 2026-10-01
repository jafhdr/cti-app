import { expect, test, type Page, type Route } from '@playwright/test';
const asset = { id: 'asset-1', tenantId: 'tenant-1', name: 'Test IP', type: 'IP_ADDRESS', value: '192.0.2.10', status: 'ACTIVE', criticality: 'HIGH', description: null, owner: null, firstSeenAt: null, lastSeenAt: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
const alert = { id: 'alert-1', title: 'Management port TCP 3389 opened', description: 'Review exposure.', severity: 'HIGH', status: 'OPEN', source: 'ASM', firstSeenAt: '2026-10-01T00:00:00Z', findingId: null, changeEventId: null, vulnerabilityCorrelationId: null, case: null };
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function setup(page: Page, caseAccess: boolean) {
  await page.route('**/auth/me', route => json(route, { email: 'qa@local', role: 'ADMIN', moduleAccess: [{ moduleSlug: 'attack-surface-management', accessible: true, featureKeys: ['asset-management'] }, ...(caseAccess ? [{ moduleSlug: 'case-management', accessible: true, featureKeys: ['case-workflow'] }] : [])] }));
  await page.route(/^http:\/\/localhost:3001\/attack-surface\/assets(?:\?.*)?$/, route => json(route, { items: [asset], total: 1, totalPages: 1 }));
  await page.route('**/attack-surface/assets/asset-1/port-services', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/relationships', route => json(route, { asset, relationships: [] }));
  await page.route('**/attack-surface/assets/asset-1/threat-intelligence', route => json(route, { matches: [] }));
  await page.route('**/attack-surface/assets/asset-1/findings/risk-summary', route => json(route, { total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0 }));
  await page.route('**/attack-surface/assets/asset-1/findings', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/vulnerability-correlations', route => json(route, []));
}
test('alert lifecycle and case action at desktop and mobile', async ({ page }) => {
  await setup(page, true);
  let items: unknown[] = [];
  await page.route('**/attack-surface/assets/asset-1/alerts', route => json(route, items));
  await page.route('**/alerts/alert-1/acknowledge', route => { items = [{ ...alert, status: 'ACKNOWLEDGED' }]; return json(route, items[0]); });
  await page.route('**/alerts/alert-1/resolve', route => { items = [{ ...alert, status: 'CLOSED', case: { id: 'case-1', caseNumber: 'CASE-1', status: 'OPEN' } }]; return json(route, items[0]); });
  await page.route('**/cases/from-asm-alert/alert-1', route => { items = [{ ...alert, status: 'ACKNOWLEDGED', case: { id: 'case-1', caseNumber: 'CASE-1', status: 'OPEN' } }]; return json(route, { id: 'case-1' }); });
  await page.goto('http://localhost:3000/attack-surface/assets');
  await page.getByRole('button', { name: 'Detail' }).click();
  const section = page.getByLabel('ASM alerts');
  await expect(section).toContainText('No actionable alerts');
  items = [alert];
  await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(section).toContainText('Management port TCP 3389 opened');
  await section.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(section).toContainText('ACKNOWLEDGED');
  await section.getByRole('button', { name: 'Create Case' }).click();
  await expect(section.getByRole('link', { name: 'Open CASE-1' })).toBeVisible();
  for (const width of [1280, 390]) { await page.setViewportSize({ width, height: 900 }); await section.screenshot({ path: `test-results/asm-alerts-${width}.png` }); }
  await section.getByRole('button', { name: 'Resolve' }).click();
  await expect(section).toContainText('CLOSED');
  await expect(section.getByRole('link', { name: 'Open CASE-1' })).toBeVisible();
});
test('alert errors retry and Case action is hidden without Case access', async ({ page }) => {
  await setup(page, false);
  let error = true;
  await page.route('**/attack-surface/assets/asset-1/alerts', route => json(route, error ? { message: 'Unavailable' } : [alert], error ? 500 : 200));
  await page.goto('http://localhost:3000/attack-surface/assets');
  await page.getByRole('button', { name: 'Detail' }).click();
  const section = page.getByLabel('ASM alerts');
  await expect(section.getByRole('alert')).toContainText('Failed to load alerts');
  error = false;
  await section.getByRole('button', { name: 'Retry' }).click();
  await expect(section).toContainText('Management port TCP 3389 opened');
  await expect(section.getByRole('button', { name: 'Create Case' })).toHaveCount(0);
});
