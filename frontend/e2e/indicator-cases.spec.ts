import { expect, test } from '@playwright/test';

const app = process.env.SOURCES_APP_URL || 'http://localhost:3000';
const indicator = { id: 'indicator-1', value: 'example.com', type: 'DOMAIN', severity: 'HIGH', confidence: 90, status: 'ACTIVE', tags: ['phishing'], source: 'analyst', description: 'Suspicious domain', expiresAt: null, tenant: { id: 'tenant-a', name: 'Tenant A' }, intelligenceEntity: null };
const caseRecord = { id: 'case-1', caseNumber: 'CASE-2026-00001', title: 'Suspicious login', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', updatedAt: '2026-09-20T08:00:00.000Z' };

test('searches, links, displays, and unlinks a Case from Indicator detail', async ({ page }) => {
  let linked: readonly typeof caseRecord[] = [];
  await page.route(/\/auth\/me$/, route => route.fulfill({ json: {
    id: 'admin', name: 'QA Admin', email: 'admin@example.test', role: 'ADMIN', tenantId: 'tenant-a',
    moduleAccess: [
      { moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, accessible: true, featureKeys: ['indicator-management'] },
      { moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] },
    ],
  } }));
  await page.route(/\/intelligence\/overview(?:\?.*)?$/, route => route.fulfill({ json: { entities: [] } }));
  await page.route(/\/indicators\?.+$/, route => route.fulfill({ json: { items: [indicator], total: 1, page: 1, limit: 100 } }));
  await page.route(/\/indicators\/indicator-1\/enrichments$/, route => route.fulfill({ json: [] }));
  await page.route(/\/indicators\/indicator-1\/cases$/, async route => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ caseId: caseRecord.id });
      linked = [caseRecord];
      await route.fulfill({ status: 201, json: caseRecord });
      return;
    }
    await route.fulfill({ json: linked });
  });
  await page.route(/\/indicators\/indicator-1\/cases\/available(?:\?.*)?$/, route => route.fulfill({ json: linked.length === 0 ? [caseRecord] : [] }));
  await page.route(/\/indicators\/indicator-1\/cases\/case-1$/, async route => {
    linked = [];
    await route.fulfill({ json: { success: true } });
  });

  await page.goto(`${app}/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(page.getByRole('heading', { name: 'Related Cases' })).toBeVisible();
  await expect(page.getByText('No related Cases yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Add to Case' }).click();
  await page.getByPlaceholder('Search case number or title...').fill('Suspicious');
  await expect(page.getByText('Suspicious login')).toBeVisible();
  await page.getByRole('button', { name: 'Link CASE-2026-00001' }).click();

  await expect(page.getByText('CASE-2026-00001')).toBeVisible();
  for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'tablet', width: 768, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../.omo/evidence/indicator-cases/${viewport.name}-linked.png`, fullPage: true });
  }

  await page.getByRole('button', { name: 'Unlink CASE-2026-00001' }).click();
  await expect(page.getByText('No related Cases yet.')).toBeVisible();
});

test('shows dialog loading, empty, search error, and working retry states', async ({ page }) => {
  let searchRequests = 0;
  let releaseInitialSearch: (() => void) | undefined;
  const initialSearchGate = new Promise<void>(resolve => { releaseInitialSearch = resolve; });
  await page.route(/\/auth\/me$/, route => route.fulfill({ json: {
    id: 'admin', name: 'QA Admin', email: 'admin@example.test', role: 'ADMIN', tenantId: 'tenant-a',
    moduleAccess: [
      { moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, accessible: true, featureKeys: ['indicator-management'] },
      { moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] },
    ],
  } }));
  await page.route(/\/intelligence\/overview(?:\?.*)?$/, route => route.fulfill({ json: { entities: [] } }));
  await page.route(/\/indicators\?.+$/, route => route.fulfill({ json: { items: [indicator], total: 1, page: 1, limit: 100 } }));
  await page.route(/\/indicators\/indicator-1\/enrichments$/, route => route.fulfill({ json: [] }));
  await page.route(/\/indicators\/indicator-1\/cases$/, route => route.fulfill({ json: [] }));
  await page.route(/\/indicators\/indicator-1\/cases\/available(?:\?.*)?$/, async route => {
    searchRequests += 1;
    if (searchRequests === 1) {
      await initialSearchGate;
      await route.fulfill({ json: [] });
      return;
    }
    if (searchRequests === 2) {
      await route.fulfill({ status: 503, json: { message: 'Case search temporarily unavailable' } });
      return;
    }
    await route.fulfill({ json: [caseRecord] });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${app}/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();
  await page.getByRole('button', { name: 'Add to Case' }).click();
  await expect(page.getByText('Searching Cases...')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/indicator-cases/dialog-loading.png', fullPage: true });
  releaseInitialSearch?.();
  await expect(page.getByText('No available Cases found.')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/indicator-cases/dialog-empty.png', fullPage: true });

  await page.getByPlaceholder('Search case number or title...').fill('Suspicious');
  await expect(page.getByText('Case search temporarily unavailable')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/indicator-cases/dialog-error.png', fullPage: true });
  await page.getByRole('button', { name: 'Retry search' }).click();
  await expect(page.getByText('Suspicious login')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../.omo/evidence/indicator-cases/dialog-results-mobile.png', fullPage: true });
});

test('creates a Case from an Indicator, shows it in Related Cases, and opens it', async ({ page }) => {
  const createdCase = { ...caseRecord, id: 'case-created', caseNumber: 'CASE-2026-00002', title: 'Investigate example.com', priority: 'CRITICAL', severity: 'HIGH' };
  await page.route(/\/auth\/me$/, route => route.fulfill({ json: {
    id: 'admin', name: 'QA Admin', email: 'admin@example.test', role: 'ADMIN', tenantId: 'tenant-a',
    moduleAccess: [
      { moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, accessible: true, featureKeys: ['indicator-management'] },
      { moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] },
    ],
  } }));
  await page.route(/\/intelligence\/overview(?:\?.*)?$/, route => route.fulfill({ json: { entities: [] } }));
  await page.route(/\/indicators\?.+$/, route => route.fulfill({ json: { items: [indicator], total: 1, page: 1, limit: 100 } }));
  await page.route(/\/indicators\/indicator-1\/enrichments$/, route => route.fulfill({ json: [] }));
  await page.route(/\/indicators\/indicator-1\/cases$/, route => route.fulfill({ json: [] }));
  await page.route(/\/cases\/from-indicator\/indicator-1$/, async route => {
    expect(route.request().postDataJSON()).toEqual({
      title: createdCase.title,
      description: 'Created directly from the IOC workflow',
      priority: 'CRITICAL',
      severity: 'HIGH',
    });
    await route.fulfill({ status: 201, json: createdCase });
  });

  await page.goto(`${app}/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();
  await page.getByRole('button', { name: 'Create Case' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Create Case', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Create Case', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Create Case', exact: true }).click();
  await page.getByLabel('Title').fill(createdCase.title);
  await page.getByLabel('Description').fill('Created directly from the IOC workflow');
  await page.getByLabel('Priority').selectOption('CRITICAL');
  await page.getByLabel('Severity').selectOption('HIGH');
  await page.getByLabel('Title').focus();
  await page.screenshot({ path: '../.omo/evidence/indicator-create-case/desktop-modal.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../.omo/evidence/indicator-create-case/mobile-modal.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('dialog').getByRole('button', { name: 'Create Case', exact: true }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('CASE-2026-00002 created and linked.')).toBeVisible();
  await expect(page.getByRole('link', { name: /CASE-2026-00002/ })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/indicator-create-case/desktop-created.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../.omo/evidence/indicator-create-case/mobile-created.png', fullPage: true });

  await page.getByRole('link', { name: /CASE-2026-00002/ }).click();
  await expect(page).toHaveURL(`${app}/cases/${createdCase.id}`);
});

for (const indicatorTenant of ['tenant-a', 'tenant-b']) {
  test(`SUPER_ADMIN selected tenant A creates from Indicator ${indicatorTenant} only when tenant matches`, async ({ page }) => {
    let submittedTenant = '';
    await page.addInitScript(() => sessionStorage.setItem('case-workspace-tenant', 'tenant-a'));
    await page.route(/\/auth\/me$/, route => route.fulfill({ json: {
      id: 'root', name: 'Root', email: 'root@example.test', role: 'SUPER_ADMIN',
      moduleAccess: [
        { moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, accessible: true, featureKeys: ['indicator-management'] },
        { moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] },
      ],
    } }));
    await page.route('**/users/tenants', route => route.fulfill({ json: [{ id: 'tenant-a', name: 'Tenant A' }, { id: 'tenant-b', name: 'Tenant B' }] }));
    await page.route(/\/indicators\?.+$/, route => route.fulfill({ json: { items: [{ ...indicator, tenant: { id: indicatorTenant, name: indicatorTenant } }], total: 1 } }));
    await page.route(/\/indicators\/indicator-1\/enrichments$/, route => route.fulfill({ json: [] }));
    await page.route(/\/indicators\/indicator-1\/cases$/, route => route.fulfill({ json: [] }));
    await page.route(/\/cases\/from-indicator\/indicator-1$/, route => {
      submittedTenant = route.request().postDataJSON().tenantId;
      return route.fulfill(indicatorTenant === submittedTenant ? { status: 201, json: caseRecord } : { status: 404, json: { message: 'Indicator tidak ditemukan' } });
    });
    await page.goto(`${app}/indicators`);
    await page.getByRole('button', { name: 'Detail' }).click();
    await page.getByRole('button', { name: 'Create Case' }).click();
    await page.getByLabel('Title').fill('Investigate IOC');
    await page.getByRole('dialog').getByRole('button', { name: 'Create Case', exact: true }).click();
    expect(submittedTenant).toBe('tenant-a');
    if (indicatorTenant === 'tenant-a') await expect(page.getByText(/created and linked/)).toBeVisible();
    else await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Indicator tidak ditemukan');
  });
}

test('does not expose Create Case to a USER', async ({ page }) => {
  await page.route(/\/auth\/me$/, route => route.fulfill({ json: {
    id: 'user', name: 'QA User', email: 'user@example.test', role: 'USER', tenantId: 'tenant-a',
    moduleAccess: [
      { moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, accessible: true, featureKeys: ['indicator-management'] },
      { moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] },
    ],
  } }));
  await page.route(/\/intelligence\/overview(?:\?.*)?$/, route => route.fulfill({ json: { entities: [] } }));
  await page.route(/\/indicators\?.+$/, route => route.fulfill({ json: { items: [indicator], total: 1, page: 1, limit: 100 } }));
  await page.route(/\/indicators\/indicator-1\/enrichments$/, route => route.fulfill({ json: [] }));
  await page.route(/\/indicators\/indicator-1\/cases$/, route => route.fulfill({ json: [] }));

  await page.goto(`${app}/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(page.getByRole('button', { name: 'Create Case' })).toHaveCount(0);
});
