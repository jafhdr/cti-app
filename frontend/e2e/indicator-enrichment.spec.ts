import { expect, test, type Page } from '@playwright/test';

const app = 'http://localhost:3000';
const indicator = { id: 'indicator-1', value: 'example.com', type: 'DOMAIN', severity: 'HIGH', confidence: 90, status: 'ACTIVE', tags: ['phishing'], source: 'analyst', description: 'Suspicious domain', expiresAt: null, tenant: { id: 'tenant-a', name: 'Tenant A' }, intelligenceEntity: null };
const enrichment = { id: 'enrichment-1', provider: 'CLOUDFLARE_DNS', status: 'SUCCESS', error: null, createdAt: '2026-09-14T08:00:00.000Z', data: { host: 'example.com', responseCode: 0, records: [{ type: 1, ttl: 300, value: '93.184.216.34' }] } };
const attribution = { status: 'MATCH', indicatorId: 'indicator-1', candidate: { id: 'actor-1', name: 'APT One' }, confidence: 85, matchedEvidence: [{ kind: 'INDICATOR_TAG', value: 'phishing', weight: 20 }, { kind: 'INTELLIGENCE_REPORT', value: 'report-1', weight: 65 }], created: true };

async function session(page: Page): Promise<{ readonly runCount: () => number }> {
  let enriched = false;
  let runs = 0;
  await page.route(/\/auth\/me$/, route => route.fulfill({ json: { id: 'admin', name: 'QA Admin', email: 'admin@example.test', role: 'ADMIN', tenantId: 'tenant-a', moduleAccess: [{ moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, featureKeys: [] }] } }));
  await page.route(/\/intelligence\/overview(?:\?.*)?$/, route => route.fulfill({ json: { entities: [] } }));
  await page.route(/\/indicators\?.+$/, route => route.fulfill({ json: { items: [indicator], total: 1, page: 1, limit: 100 } }));
  await page.route(/\/indicators\/indicator-1\/enrichments$/, route => route.fulfill({ json: enriched ? [enrichment] : [] }));
  await page.route(/\/indicators\/indicator-1\/enrich$/, route => {
    enriched = true;
    runs += 1;
    return route.fulfill({ json: enrichment });
  });
  await page.route(/\/indicators\/indicator-1\/attribute-threat-actor$/, route => route.fulfill({ json: attribution }));
  return { runCount: () => runs };
}

test('indicator detail runs threat actor attribution and displays its evidence', async ({ page }) => {
  await session(page);
  await page.goto(`${app}/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();

  await page.getByRole('button', { name: 'Run attribution' }).click();

  await expect(page.getByText('MATCH', { exact: true })).toBeVisible();
  await expect(page.getByText('APT One', { exact: true })).toBeVisible();
  await expect(page.getByText('85% confidence')).toBeVisible();
  await expect(page.getByText('INTELLIGENCE_REPORT: report-1 (+65)')).toBeVisible();
  for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'tablet', width: 768, height: 900 }, { name: 'mobile', width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `../.omo/evidence/indicator-attribution/${viewport.name}.png`, fullPage: true });
  }
});

test('indicator detail runs enrichment and keeps the saved provider context visible', async ({ page }) => {
  const state = await session(page);
  await page.goto(`${app}/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(page.getByText('No enrichment yet')).toBeVisible();

  await page.getByRole('button', { name: 'Enrich', exact: true }).click();

  await expect(page.getByText('Enrichment berhasil disimpan.')).toBeVisible();
  await expect(page.getByText('CLOUDFLARE_DNS')).toBeVisible();
  await expect(page.getByText('93.184.216.34')).toBeVisible();
  expect(state.runCount()).toBe(1);
});

test('indicator enrichment detail is readable at desktop, tablet, and mobile widths', async ({ page }) => {
  await session(page);
  await page.goto(`${app}/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();
  await page.getByRole('button', { name: 'Enrich', exact: true }).click();
  await expect(page.getByText('93.184.216.34')).toBeVisible();
  for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'tablet', width: 768, height: 900 }, { name: 'mobile', width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `../.omo/evidence/indicator-enrichment/${viewport.name}.png`, fullPage: true });
  }
});

test('indicator enrichment exposes busy, hover, focus, close, and API error states', async ({ page }) => {
  await session(page);
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
  await page.route(/\/indicators\/indicator-1\/enrich$/, async route => {
    await responseGate;
    await route.fulfill({ status: 503, json: { message: 'Provider temporarily unavailable' } });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${app}/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();

  const enrichButton = page.getByRole('button', { name: 'Enrich', exact: true });
  await enrichButton.hover();
  await page.screenshot({ path: '../.omo/evidence/indicator-enrichment/hover.png', fullPage: true });
  const request = enrichButton.click();
  const busyButton = page.getByRole('button', { name: 'Enriching...' });
  await expect(busyButton).toBeDisabled();
  await page.screenshot({ path: '../.omo/evidence/indicator-enrichment/busy.png', fullPage: true });
  releaseResponse?.();
  await request;
  await expect(page.getByText('Provider temporarily unavailable', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/indicator-enrichment/error.png', fullPage: true });

  const closeButton = page.getByRole('button', { name: 'Close' });
  await enrichButton.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Run attribution' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  const focusStyle = await closeButton.evaluate(element => ({ outlineStyle: getComputedStyle(element).outlineStyle, outlineWidth: Number.parseFloat(getComputedStyle(element).outlineWidth) }));
  expect(focusStyle).toMatchObject({ outlineStyle: 'solid' });
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: '../.omo/evidence/indicator-enrichment/focus.png', fullPage: true });
  await closeButton.click();
  await expect(page.getByRole('region', { name: 'example.com' })).toHaveCount(0);
});

test('indicator enrichment exposes the history loading state', async ({ page }) => {
  await session(page);
  let releaseHistory: (() => void) | undefined;
  const historyGate = new Promise<void>(resolve => { releaseHistory = resolve; });
  await page.route(/\/indicators\/indicator-1\/enrichments$/, async route => {
    await historyGate;
    await route.fulfill({ json: [] });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${app}/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(page.getByText('Loading enrichment history...')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/indicator-enrichment/loading.png', fullPage: true });
  releaseHistory?.();
  await expect(page.getByText('No enrichment yet')).toBeVisible();
});
