import { expect, test, type Page, type Route } from '@playwright/test';

const observed = '2026-09-30T00:00:00.000Z';
const asset = { id: 'asset-1', tenantId: 'tenant-1', name: '192.0.2.10', type: 'IP_ADDRESS', value: '192.0.2.10', status: 'ACTIVE', criticality: 'HIGH', description: null, owner: null, firstSeenAt: observed, lastSeenAt: observed, createdAt: observed, updatedAt: observed };
const schedule = { enabled: true, intervalMinutes: 1440, lastRunAt: observed, nextRunAt: '2026-10-01T00:00:00.000Z' };
const run = { id: 'run-1', status: 'COMPLETED', source: 'SCHEDULED', startedAt: observed, completedAt: observed, discovered: 2, failed: 0 };
const change = { id: 'change-1', type: 'SERVICE_CHANGED', entityKey: 'ip-1:TCP:22', previousValue: '{"version":"8.4"}', currentValue: '{"version":"8.5"}', detectedAt: observed, run: { source: 'SCHEDULED', status: 'COMPLETED' } };
async function json(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); }
async function setup(page: Page, options: { readonly changes?: readonly unknown[]; readonly error?: boolean } = {}) {
  await page.route('**/auth/me', route => json(route, { email: 'admin@cti.local', role: 'ADMIN', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned: true, accessible: true, featureKeys: ['asset-management', 'asset-discovery'] }] }));
  await page.route(/^http:\/\/localhost:3001\/attack-surface\/assets(?:\?.*)?$/, route => json(route, { items: [asset], total: 1, totalPages: 1 }));
  await page.route('**/attack-surface/assets/asset-1/port-services', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/relationships', route => json(route, { asset, relationships: [] }));
  await page.route('**/attack-surface/assets/asset-1/threat-intelligence', route => json(route, { matches: [] }));
  await page.route('**/attack-surface/assets/asset-1/findings', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/findings/risk-summary', route => json(route, { total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0 }));
  await page.route('**/attack-surface/assets/asset-1/vulnerability-correlations', route => json(route, []));
  await page.route('**/attack-surface/assets/asset-1/discovery/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/schedule')) return json(route, options.error ? { message: 'Unavailable' } : schedule, options.error ? 500 : 200);
    if (path.endsWith('/changes')) return json(route, options.changes ?? []);
    if (path.endsWith('/runs')) return json(route, [run]);
    return json(route, {});
  });
  await page.goto('http://localhost:3000/attack-surface/assets');
  await page.getByRole('button', { name: 'Detail' }).click();
}

test('schedule loads, updates, and empty change history is explicit', async ({ page }) => {
  await setup(page);
  const section = page.getByLabel('Discovery schedule and change history');
  await expect(section).toContainText('Enabled');
  await expect(section).toContainText('1440 min');
  await expect(section).toContainText('No exposure changes recorded.');
  const request = page.waitForRequest(req => req.url().endsWith('/discovery/schedule') && req.method() === 'PATCH');
  await section.getByRole('button', { name: 'Save schedule' }).click();
  expect((await request).postDataJSON()).toEqual({ enabled: true, intervalMinutes: 1440 });
  const runRequest = page.waitForRequest(req => req.url().endsWith('/discovery/runs') && req.method() === 'POST');
  await section.getByRole('button', { name: 'Run discovery now' }).click();
  await runRequest;
});

test('history shows before/after and stale state at desktop and mobile widths', async ({ page }) => {
  await setup(page, { changes: [change, { ...change, id: 'change-2', type: 'PORT_NOT_OBSERVED', previousValue: 'TCP 22', currentValue: null }] });
  const section = page.getByLabel('Discovery schedule and change history');
  await expect(section).toContainText('SERVICE CHANGED'.toLowerCase());
  await expect(section).toContainText('{"version":"8.4"} → {"version":"8.5"}');
  await expect(section).toContainText('no longer observed');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await section.screenshot({ path: `test-results/asm-schedule-${width}.png` });
  }
});

test('schedule API error offers retry', async ({ page }) => {
  await setup(page, { error: true });
  const section = page.getByLabel('Discovery schedule and change history');
  await expect(section.getByRole('alert')).toContainText('Could not load discovery history.');
  await expect(section.getByRole('button', { name: 'Retry' })).toBeVisible();
});
