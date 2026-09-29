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
  await page.route('**/auth/me', route => json(route, { email: 'analyst@cti.local', role: 'USER', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned, accessible: assigned, featureKeys: ['asset-inventory', 'asset-discovery'] }] }));
}

test('lists, searches, filters, paginates, opens detail, and gates discovery by type', async ({ page }) => {
  await mockSession(page);
  const requests: URL[] = [];
  await page.route(assetsApi, async route => {
    requests.push(new URL(route.request().url()));
    await json(route, { items: [domain, host], total: 12, totalPages: 2 });
  });
  await page.goto(`${app}/attack-surface/assets`);
  await expect(page.getByRole('heading', { name: 'Know what is exposed.' })).toBeVisible();
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
  await expect(page.getByRole('region', { name: /Asset Intelligence Workspace/ }).getByRole('heading', { name: 'example.com' })).toBeVisible();
  await expect(page.getByRole('region', { name: /Asset Intelligence Workspace/ }).getByRole('heading', { name: 'Asset overview' })).toBeVisible();
  await expect(page.getByRole('region', { name: /Asset Intelligence Workspace/ }).getByText('Security')).toBeVisible();
  await expect(page.getByRole('region', { name: /Asset Intelligence Workspace/ })).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to assets' }).click();
  await expect(page.getByRole('button', { name: 'Detail' }).first()).toBeFocused();
});

test('creates, edits, and deletes an asset', async ({ page }) => {
  await page.route('**/auth/me', route => json(route, { email: 'admin@cti.local', role: 'ADMIN', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned: true, accessible: true, featureKeys: ['asset-inventory', 'asset-discovery'] }] }));
  let listCalls = 0; let created = false; let edited = false; let deleted = false;
  let editPayload: Record<string, string> | null = null;
  await page.route(assetsApi, route => {
    if (route.request().method() === 'POST') { created = true; return json(route, domain, 201); }
    listCalls += 1; return json(route, { items: [domain], total: 1, totalPages: 1 });
  });
  await page.route('http://localhost:3001/attack-surface/assets/domain-1', route => { const method = route.request().method(); edited ||= method === 'PATCH'; deleted ||= method === 'DELETE'; if (method === 'PATCH') editPayload = route.request().postDataJSON(); return json(route, method === 'DELETE' ? { deleted: true, id: domain.id } : domain); });
  await page.goto(`${app}/attack-surface/assets`);
  await page.getByRole('button', { name: 'Create asset' }).click();
  await page.getByLabel('Name').fill('new.example.com'); await page.getByLabel('Value').fill('new.example.com');
  await page.getByRole('dialog').getByRole('button', { name: 'Create asset', exact: true }).click();
  await expect.poll(() => created).toBeTruthy();
  await page.getByRole('button', { name: 'Edit' }).click(); await page.getByLabel('Name').fill('edited.example.com'); await page.getByLabel('Owner').fill(''); await page.getByLabel('Description').fill('Updated asset'); await page.getByLabel('Last seen').fill(''); await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => edited).toBeTruthy();
  expect(editPayload).toMatchObject({ owner: '', description: 'Updated asset', lastSeenAt: '' });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Asset?' });
  await expect(confirmation).toContainText('example.com');
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  expect(deleted).toBe(false);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Delete Asset' }).click();
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


test('discovers DNS/IP on subdomain and scans services on an IP asset', async ({ page }) => {
  await page.route('**/auth/me', route => json(route, { email: 'admin@cti.local', role: 'ADMIN', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned: true, accessible: true, featureKeys: [] }] }));
  const subdomain = { ...domain, id: 'sub-1', name: 'www.example.com', value: 'www.example.com', type: 'SUBDOMAIN' };
  const ip = { ...domain, id: 'ip-1', name: '203.0.113.10', value: '203.0.113.10', type: 'IP_ADDRESS' };
  await page.route(assetsApi, route => json(route, { items: [subdomain, ip], total: 2, totalPages: 1 }));
  await page.route('**/attack-surface/assets/sub-1/discover', route => json(route, { rootDomain: 'www.example.com', discovered: 1, created: 1, updated: 0, skipped: 0, failed: 0, providers: ['DNS'], errors: [] }));
  await page.route('**/attack-surface/assets/ip-1/port-services', route => json(route, [{ id: 'port-1', port: 443, protocol: 'TCP', service: 'https', status: 'OPEN', firstSeenAt: now, lastSeenAt: now }]));
  await page.route('**/attack-surface/assets/ip-1/port-services/discover', route => json(route, { target: '203.0.113.10', scanned: 2, open: 1, closed: 0, timeout: 1, failed: 0, results: [{ port: 443, protocol: 'TCP', service: 'https', status: 'open' }, { port: 80, protocol: 'TCP', service: 'http', status: 'timeout' }] }));
  await page.goto(`${app}/attack-surface/assets`);
  await page.getByRole('button', { name: 'Discover DNS/IP' }).click();
  await expect(page.getByLabel('Discovery results')).toContainText('www.example.com');
  await page.getByRole('button', { name: 'Detail' }).nth(1).click();
  await expect(page.getByLabel('Port and services')).toContainText('443');
  await page.getByRole('button', { name: 'Discover ports' }).click();
  await expect(page.getByLabel('Port discovery results')).toContainText('TIMEOUT');
});

test('assigned ASM stays hidden when backend access is denied', async ({ page }) => {
  await page.route('**/auth/me', route => json(route, { email: 'cj-admin@cti.local', role: 'ADMIN', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned: true, accessible: false, featureKeys: [] }] }));
  await page.goto(`${app}/attack-surface/assets`);
  await expect(page.getByText('Access denied')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Assets' })).toHaveCount(0);
});

test('USER can inspect IP services without a port discovery action', async ({ page }) => {
  await mockSession(page);
  const ip = { ...domain, id: 'ip-1', name: '203.0.113.10', value: '203.0.113.10', type: 'IP_ADDRESS' };
  await page.route(assetsApi, route => json(route, { items: [ip], total: 1, totalPages: 1 }));
  await page.route('**/attack-surface/assets/ip-1/port-services', route => json(route, []));
  await page.goto(`${app}/attack-surface/assets`);
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(page.getByLabel('Port and services')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Discover ports' })).toHaveCount(0);
});

test('USER empty state does not suggest creating an asset', async ({ page }) => {
  await mockSession(page);
  await page.route(assetsApi, route => json(route, { items: [], total: 0, totalPages: 0 }));
  await page.goto(`${app}/attack-surface/assets`);
  await expect(page.getByText('No assets found')).toBeVisible();
  await expect(page.getByText('Adjust the filters or contact an administrator to add assets.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create asset' })).toHaveCount(0);
});

test('SUPER_ADMIN selects tenant and can discover IP ports', async ({ page }) => {
  const ip = { ...domain, id: 'ip-1', name: '203.0.113.10', value: '203.0.113.10', type: 'IP_ADDRESS' };
  await page.route('**/auth/me', route => json(route, { email: 'root@cti.local', role: 'SUPER_ADMIN', moduleAccess: [{ moduleId: 'asm', moduleName: 'Attack Surface Management', moduleSlug: 'attack-surface-management', assigned: true, accessible: true, featureKeys: [] }] }));
  await page.route('**/users/tenants', route => json(route, [{ id: 'tenant-1', name: 'Tenant One' }]));
  await page.route(assetsApi, route => json(route, { items: [ip], total: 1, totalPages: 1 }));
  await page.route('**/attack-surface/assets/ip-1/port-services?tenantId=tenant-1', route => json(route, []));
  const discoveryTenants: string[] = [];
  await page.route('**/attack-surface/assets/ip-1/port-services/discover?tenantId=tenant-1', route => { discoveryTenants.push(new URL(route.request().url()).searchParams.get('tenantId') ?? ''); return json(route, { target: ip.value, scanned: 1, open: 1, closed: 0, timeout: 0, failed: 0, results: [{ port: 443, protocol: 'TCP', service: 'https', status: 'open' }] }); });
  await page.goto(`${app}/attack-surface/assets`);
  await expect(page.getByLabel('Tenant Attack Surface')).toHaveValue('tenant-1');
  await page.getByRole('button', { name: 'Detail' }).click();
  await page.getByRole('button', { name: 'Discover ports' }).click();
  await expect(page.getByLabel('Port discovery results')).toContainText('OPEN');
  expect(discoveryTenants).toContain('tenant-1');
});

test('shows matching threat intelligence and an empty correlation state', async ({ page }) => {
  await mockSession(page);
  await page.route(assetsApi, route => json(route, { items: [domain, host], total: 2, totalPages: 1 }));
  await page.route('**/attack-surface/assets/domain-1/threat-intelligence', route => json(route, { assetId: domain.id, assetType: domain.type, assetValue: domain.value, matches: [{ id: 'indicator-1', type: 'DOMAIN', value: 'example.com', source: 'feed', confidence: 80, enrichmentSummary: null }] }));
  await page.route('**/attack-surface/assets/host-1/threat-intelligence', route => json(route, { assetId: host.id, assetType: host.type, assetValue: host.value, matches: [] }));
  await page.goto(`${app}/attack-surface/assets`);
  await page.getByRole('button', { name: 'Detail' }).first().click();
  await expect(page.getByRole('region', { name: 'Threat Intelligence' })).toContainText('1 matched indicators');
  await expect(page.getByRole('region', { name: 'Threat Intelligence' })).toContainText('feed');
  await page.getByRole('button', { name: 'Back to assets' }).click();
  await page.getByRole('button', { name: 'Detail' }).last().click();
  await expect(page.getByRole('region', { name: 'Threat Intelligence' })).toContainText('No matching threat intelligence indicators found.');
});

test('shows discovery lineage for the selected asset', async ({ page }) => {
  await mockSession(page);
  await page.route(assetsApi, route => json(route, { items: [domain], total: 1, totalPages: 1 }));
  await page.route('**/attack-surface/assets/domain-1/relationships', route => json(route, {
    asset: { id: domain.id, type: domain.type, value: domain.value },
    relationships: [{ id: 'rel-1', type: 'DISCOVERED_SUBDOMAIN', source: 'CRT_SH', direction: 'outgoing',
      rootAsset: { id: domain.id, type: domain.type, value: domain.value },
      relatedAsset: { id: 'sub-1', type: 'SUBDOMAIN', value: 'api.example.com' },
      firstSeenAt: now, lastSeenAt: now }],
  }));
  await page.route('**/attack-surface/assets/domain-1/threat-intelligence', route => json(route, { matches: [] }));
  await page.goto(`${app}/attack-surface/assets`);
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(page.getByRole('region', { name: 'Discovery Relationships' })).toContainText('api.example.com');
  await expect(page.getByRole('region', { name: 'Discovery Relationships' })).toContainText('CRT_SH');
});
