import { expect, test, type Page } from '@playwright/test';

const app = 'http://localhost:3000';
const evidence = '../.omo/evidence/threat-intelligence/phase1';
const indicator = { id: 'ioc-a', value: 'malicious.example', type: 'DOMAIN', severity: 'HIGH', confidence: 87, status: 'ACTIVE', tags: ['phishing'], source: 'Analyst feed', description: 'Observed phishing infrastructure', expiresAt: '2026-12-31T00:00:00.000Z', tenant: { id: 'tenant-a', name: 'Tenant A' }, intelligenceEntity: null };
const other = { ...indicator, id: 'ioc-b', value: '203.0.113.8', type: 'IP_ADDRESS', severity: 'CRITICAL', source: 'Sensor', tags: ['scanner'] };
const enrichment = { id: 'enrichment-a', provider: 'VIRUSTOTAL', status: 'SUCCESS', error: null, createdAt: '2026-09-28T09:00:00.000Z', data: { reputation: -8, detections: { malicious: 4, suspicious: 1, total: 80 }, analysisAt: '2026-09-28T08:00:00.000Z' } };

async function fixture(page: Page, access = true) {
  let rows = [indicator, other];
  let enriched = false;
  await page.route(/\/auth\/me$/, route => route.fulfill({ json: { id: 'admin', name: 'QA Admin', email: 'qa@example.test', role: 'ADMIN', tenantId: 'tenant-a', moduleAccess: [{ moduleId: 'ti', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', accessible: access, assigned: true, featureKeys: ['indicator-management'] }] } }));
  await page.route(/\/intelligence\/overview(?:\?.*)?$/, route => route.fulfill({ json: { entities: [{ id: 'entity-a', name: 'Observed campaign', type: 'CAMPAIGN', severity: 'HIGH', confidence: 83, description: 'Observed in tenant A', updatedAt: '2026-09-28T09:00:00.000Z', indicators: [{ id: 'ioc-a', value: indicator.value }] }], relationships: [] } }));
  await page.route(/\/indicators\?/, route => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search')?.toLowerCase();
    const filtered = rows.filter(row => (!search || [row.value, row.source, ...row.tags].some(value => value.toLowerCase().includes(search))) && (!url.searchParams.get('type') || row.type === url.searchParams.get('type')) && (!url.searchParams.get('severity') || row.severity === url.searchParams.get('severity')) && (!url.searchParams.get('status') || row.status === url.searchParams.get('status')));
    return route.fulfill({ json: { items: filtered, page: 1, limit: 100, total: filtered.length } });
  });
  await page.route(/\/indicators\/ioc-a\/enrichments$/, route => route.fulfill({ json: enriched ? [enrichment] : [] }));
  await page.route(/\/indicators\/ioc-a\/enrich$/, route => { enriched = true; return route.fulfill({ json: enrichment }); });
  await page.route(/\/indicators\/ioc-a\/discover-threat-actors$/, route => route.fulfill({ json: [] }));
  await page.route(/\/indicators\/ioc-a\/threat-actor-candidates$/, route => route.fulfill({ json: [] }));
  await page.route(/\/indicators\/(?:ioc-a|ioc-created)\/deactivate$/, route => { rows = rows.map(row => row.id === route.request().url().split('/').at(-2) ? { ...row, status: 'INACTIVE' } : row); return route.fulfill({ json: rows[0] }); });
  await page.route(/\/indicators\/(?:ioc-a|ioc-created)$/, route => { const body = route.request().postDataJSON(); const id = route.request().url().split('/').pop(); rows = rows.map(row => row.id === id ? { ...row, ...body } : row); return route.fulfill({ json: rows.find(row => row.id === id) }); });
  await page.route(/\/indicators$/, route => { if (route.request().resourceType() === 'document') return route.continue(); const body = route.request().postDataJSON(); rows = [{ ...indicator, ...body, id: 'ioc-created' }, ...rows]; return route.fulfill({ json: rows[0] }); });
}

for (const theme of ['dark', 'light', 'system-dark', 'system-light'] as const) {
  for (const width of [1440, 768, 375] as const) {
    test(`${theme} ${width}: overview, indicators, detail, enrichment`, async ({ page }) => {
      await fixture(page);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme.endsWith('light') ? 'light' : 'dark' });
      await page.addInitScript(value => localStorage.setItem('cti-theme', value), theme.startsWith('system') ? 'system' : theme);
      await page.goto(`${app}/threat-intelligence`);
      await expect(page.getByRole('heading', { name: 'Recently updated entities' })).toBeVisible();
      await expect(page.getByText('Observed campaign')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.endsWith('light') ? 'light' : 'dark');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${evidence}/overview-${theme}-${width}.png`, fullPage: true });
      await page.goto(`${app}/threat-intelligence/indicators`);
      await expect(page.getByText('malicious.example')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${evidence}/indicators-${theme}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Detail' }).first().click();
      await expect(page.getByRole('heading', { name: 'malicious.example' })).toBeVisible();
      await expect(page.getByText('Analyst feed')).toBeVisible();
      await expect(page.getByText('87% confidence')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${evidence}/detail-${theme}-${width}.png`, fullPage: true });
      await expect(page.getByText('No enrichment yet')).toBeVisible();
      await page.getByRole('button', { name: 'Enrich with VirusTotal' }).click();
      await expect(page.getByText('5 / 80')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${evidence}/enrichment-${theme}-${width}.png`, fullPage: true });
    });
  }
}

test('search, filters, reset, create, edit, and deactivate use API state', async ({ page }) => {
  await fixture(page);
  await page.goto(`${app}/threat-intelligence/indicators`);
  await expect(page.getByText('malicious.example')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('203.0.113.8');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('203.0.113.8')).toBeVisible();
  await expect(page.getByText('malicious.example')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('');
  await page.locator('.ioc-filters select').nth(0).selectOption('IP_ADDRESS');
  await page.locator('.ioc-filters select').nth(1).selectOption('CRITICAL');
  await page.locator('.ioc-filters select').nth(2).selectOption('ACTIVE');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('203.0.113.8')).toBeVisible();
  await expect(page.getByText('malicious.example')).toHaveCount(0);
  await page.locator('.ioc-filters select').nth(0).selectOption('');
  await page.locator('.ioc-filters select').nth(1).selectOption('');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('malicious.example')).toBeVisible();
  await page.getByRole('button', { name: '+ Add Indicator' }).click();
  await page.getByLabel('Value').fill('new.example');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('new.example')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).filter({ visible: true }).first().click();
  await page.getByLabel('Value').fill('edited.example');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('edited.example')).toBeVisible();
  await page.getByRole('button', { name: 'Deactivate' }).first().click();
  await page.getByRole('dialog', { name: 'Deactivate indicator' }).getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByText('Indicator dinonaktifkan.')).toBeVisible();
});

test('inaccessible module is denied despite assigned flag', async ({ page }) => {
  await fixture(page, false);
  await page.goto(`${app}/threat-intelligence`);
  await expect(page.getByRole('heading', { name: 'Akses modul dibatasi' })).toBeVisible();
});

test('system preference changes update both intelligence screens', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => localStorage.setItem('cti-theme', 'system'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${app}/threat-intelligence`);
  await expect(page.getByRole('heading', { name: 'Recently updated entities' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto(`${app}/threat-intelligence/indicators`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('unsupported email indicator shows provider availability clearly', async ({ page }) => {
  await fixture(page);
  await page.route(/\/indicators\?/, route => route.fulfill({ json: { items: [{ ...indicator, type: 'EMAIL', value: 'analyst@example.test' }], page: 1, limit: 100, total: 1 } }));
  await page.goto(`${app}/threat-intelligence/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(page.getByText('VirusTotal not available')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enrich with VirusTotal' })).toHaveCount(0);
});
