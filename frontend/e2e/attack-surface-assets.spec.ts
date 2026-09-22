import { expect, test, type Page, type Route } from '@playwright/test';

const app = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const assetsApi = /^http:\/\/localhost:3001\/attack-surface\/assets(?:\?.*)?$/;
const now = '2026-09-22T08:00:00.000Z';
const domain = asset('domain-1', 'example.com', 'DOMAIN');
const host = asset('host-1', 'gateway', 'HOST');

function asset(id: string, name: string, type: 'DOMAIN' | 'HOST') {
  return { id, tenantId: 'tenant-1', name, type, value: type === 'DOMAIN' ? name : '10.0.0.1', status: 'ACTIVE', criticality: 'HIGH', description: null, owner: 'Security', firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now } as const;
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockSession(page: Page, assigned = true): Promise<void> {
  await page.route('**/auth/me', route => json(route, { email: 'analyst@cti.local', role: 'USER', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned, featureKeys: ['asset-inventory', 'asset-discovery'] }] }));
}

test('lists, searches, filters, paginates, opens detail, and gates discovery by type', async ({ page }) => {
  await mockSession(page);
  const requests: URL[] = [];
  await page.route(assetsApi, async route => {
    requests.push(new URL(route.request().url()));
    await json(route, { items: [domain, host], total: 12, totalPages: 2 });
  });
  await page.goto(`${app}/attack-surface/assets`);
  await expect(page.getByRole('heading', { name: 'Attack Surface Assets' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Discover Subdomains' })).toHaveCount(1);
  await expect(page.getByText('gateway')).toBeVisible();
  await page.getByLabel('Search assets').fill('example');
  await expect.poll(() => requests.some(url => url.searchParams.get('search') === 'example')).toBeTruthy();
  await page.getByLabel('Filter type').selectOption('DOMAIN');
  await page.getByLabel('Filter status').selectOption('ACTIVE');
  await page.getByLabel('Filter criticality').selectOption('HIGH');
  await expect.poll(() => requests.some(url => url.searchParams.get('type') === 'DOMAIN' && url.searchParams.get('status') === 'ACTIVE' && url.searchParams.get('criticality') === 'HIGH')).toBeTruthy();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect.poll(() => requests.some(url => url.searchParams.get('page') === '2')).toBeTruthy();
  await page.getByRole('button', { name: 'Detail' }).first().click();
  await expect(page.getByRole('heading', { name: 'Asset Detail' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Security')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close asset panel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Detail' }).first()).toBeFocused();
});

test('creates, edits, and deletes an asset', async ({ page }) => {
  await page.route('**/auth/me', route => json(route, { email: 'admin@cti.local', role: 'ADMIN', moduleAccess: [] }));
  let listCalls = 0; let created = false; let edited = false; let deleted = false;
  await page.route(assetsApi, route => {
    if (route.request().method() === 'POST') { created = true; return json(route, domain, 201); }
    listCalls += 1; return json(route, { items: [domain], total: 1, totalPages: 1 });
  });
  await page.route('http://localhost:3001/attack-surface/assets/domain-1', route => { const method = route.request().method(); edited ||= method === 'PATCH'; deleted ||= method === 'DELETE'; return json(route, method === 'DELETE' ? { deleted: true, id: domain.id } : domain); });
  await page.goto(`${app}/attack-surface/assets`);
  await page.getByRole('button', { name: 'Create asset' }).click();
  await page.getByLabel('Name').fill('new.example.com'); await page.getByLabel('Value').fill('new.example.com');
  await page.getByRole('dialog').getByRole('button', { name: 'Create asset', exact: true }).click();
  await expect.poll(() => created).toBeTruthy();
  await page.getByRole('button', { name: 'Edit' }).click(); await page.getByLabel('Name').fill('edited.example.com'); await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => edited).toBeTruthy();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => deleted).toBeTruthy(); expect(listCalls).toBeGreaterThan(2);
});

test('shows discovery success and failure', async ({ page }) => {
  await mockSession(page);
  await page.route(assetsApi, route => json(route, { items: [domain], total: 1, totalPages: 1 }));
  let fail = false;
  await page.route('http://localhost:3001/attack-surface/assets/domain-1/discover', route => fail ? json(route, { message: 'Provider unavailable' }, 502) : json(route, { rootDomain: 'example.com', discovered: 7, created: 3, updated: 2, skipped: 1, failed: 1, providers: ['CLOUDFLARE_DOH', 'CRTSH'], errors: ['one hostname failed'] }));
  await page.goto(`${app}/attack-surface/assets`); await page.getByRole('button', { name: 'Discover Subdomains' }).click();
  await expect(page.getByLabel('Discovery results')).toContainText('CLOUDFLARE_DOH · CRTSH'); await expect(page.getByLabel('Discovery results')).toContainText('7');
  fail = true; await page.getByRole('button', { name: 'Discover Subdomains' }).click(); await expect(page.locator('.error[role="alert"]')).toContainText('Provider unavailable'); await expect(page.getByRole('button', { name: 'Retry discovery' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Discover Subdomains' })).toBeVisible();
});

test('renders loading, empty, API error, API 403, and module denial states', async ({ page }) => {
  await mockSession(page);
  let mode: 'slow' | 'empty' | 'error' | 'denied' = 'slow';
  await page.route(assetsApi, async route => {
    if (mode === 'slow') { await new Promise(resolve => setTimeout(resolve, 250)); await json(route, { items: [], total: 0, totalPages: 0 }); return; }
    if (mode === 'error') { await json(route, { message: 'Inventory service unavailable' }, 500); return; }
    if (mode === 'denied') { await json(route, { message: 'Forbidden' }, 403); return; }
    await json(route, { items: [], total: 0, totalPages: 0 });
  });
  await page.goto(`${app}/attack-surface/assets`); await expect(page.getByText('Loading assets...')).toBeVisible(); await expect(page.getByText('No assets found')).toBeVisible();
  mode = 'error'; await page.reload(); await expect(page.locator('.error[role="alert"]')).toContainText('Inventory service unavailable');
  mode = 'denied'; await page.reload(); await expect(page.getByText('Module access required')).toBeVisible();
  await page.unrouteAll(); await mockSession(page, false); await page.goto(`${app}/attack-surface/assets`); await expect(page.getByText('Access denied')).toBeVisible();
});
