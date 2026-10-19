import { expect, test, type Page } from '@playwright/test';

const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3000';
type Role = 'USER' | 'ADMIN' | 'SUPER_ADMIN';
const application = (id: string, name: string) => ({ id, name, description: 'Service', criticality: 'HIGH', status: 'ACTIVE', owner: 'App team', repositoryUrl: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', linkedAssetCount: 0 });
async function fixture(page: Page, role: Role, features: readonly string[] = ['application-inventory'], asm = false): Promise<void> {
  const records: Record<string, ReturnType<typeof application>[]> = { 'tenant-a': [application('app-a', 'Portal A')], 'tenant-b': [application('app-b', 'Portal B')] };
  const linked = new Set<string>();
  const asset = { id: 'asset-a', name: 'Portal domain', value: 'portal.example.test', type: 'DOMAIN', status: 'ACTIVE', criticality: 'HIGH' };
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === new URL(app).origin) { await route.continue(); return; }
    const path = url.pathname; const tenant = role === 'SUPER_ADMIN' ? url.searchParams.get('tenantId') : 'tenant-a';
    const send = (body: object, status = 200) => route.fulfill({ status, json: body, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } });
    if (path === '/auth/me') { await send({ id: 'actor', email: 'qa@example.test', role, tenantId: role === 'SUPER_ADMIN' ? null : 'tenant-a', moduleAccess: [
      { moduleId: 'appsec', moduleSlug: 'appsec-posture', moduleName: 'AppSec Posture', accessible: true, featureKeys: features },
      { moduleId: 'asm', moduleSlug: 'attack-surface-management', moduleName: 'Attack Surface Management', accessible: asm, featureKeys: asm ? ['asset-management'] : [] },
    ] }); return; }
    if (path === '/users/tenants') { await send([{ id: 'tenant-a', name: 'Tenant A' }, { id: 'tenant-b', name: 'Tenant B' }]); return; }
    if (!path.startsWith('/appsec/applications')) { await route.continue(); return; }
    if (!tenant) { await send({ message: 'Tenant wajib' }, 400); return; }
    const list = records[tenant] ?? []; const segments = path.split('/').filter(Boolean); const id = segments[2]; const item = list.find(value => value.id === id);
    if (segments.length === 2 && request.method() === 'GET') { const search = url.searchParams.get('search')?.toLowerCase() ?? ''; const items = list.filter(value => value.name.toLowerCase().includes(search)); await send({ items, total: items.length, page: 1, limit: 10 }); return; }
    if (segments.length === 2 && request.method() === 'POST') { const body = request.postDataJSON(); const created = { ...application('app-new', body.name), ...body }; list.unshift(created); await send(created, 201); return; }
    if (!item) { await send({ message: 'Not found' }, 404); return; }
    if (segments.length === 3 && request.method() === 'GET') { await send(item); return; }
    if (segments.length === 3 && request.method() === 'PATCH') { Object.assign(item, request.postDataJSON()); await send(item); return; }
    if (segments[3] === 'assets' && !asm && role !== 'SUPER_ADMIN') { await send({ message: 'ASM denied' }, 403); return; }
    if (segments[4] === 'available') { await send({ items: linked.has(asset.id) ? [] : [asset], total: linked.has(asset.id) ? 0 : 1, page: 1, limit: 25 }); return; }
    if (segments.length === 4) { await send(linked.has(asset.id) ? [asset] : []); return; }
    if (segments[4] === asset.id && request.method() === 'POST') { linked.add(asset.id); await send({ applicationId: id, assetId: asset.id }, 201); return; }
    if (segments[4] === asset.id && request.method() === 'DELETE') { linked.delete(asset.id); await send({ unlinked: true }); return; }
    await send({ message: 'Not found' }, 404);
  });
}

test('USER reads Applications without mutation or ASM data', async ({ page }) => {
  await fixture(page, 'USER'); await page.goto(`${app}/appsec/applications`);
  await expect(page.getByRole('link', { name: 'Portal A' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create application' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Portal A' }).click();
  await expect(page).toHaveURL(`${app}/appsec/applications/app-a`);
  await expect(page.getByText('ASM asset access is required')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit application' })).toHaveCount(0);
});

test('ADMIN creates edits links and unlinks', async ({ page }) => {
  await fixture(page, 'ADMIN', ['application-inventory'], true); await page.goto(`${app}/appsec/applications`);
  await page.getByRole('button', { name: 'Create application' }).click();
  await page.getByRole('dialog').getByLabel('Name *').fill('New portal');
  await page.getByRole('dialog').getByRole('button', { name: 'Create application' }).click();
  await expect(page.getByRole('link', { name: 'New portal' })).toBeVisible();
  await page.getByRole('link', { name: 'New portal' }).click();
  await page.getByRole('button', { name: 'Edit application' }).click();
  await page.getByRole('dialog').getByLabel('Owner').fill('Security team');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Security team')).toBeVisible();
  await page.getByRole('button', { name: 'Link Asset' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Link', exact: true }).click();
  await expect(page.getByText('portal.example.test')).toBeVisible();
  await page.getByRole('button', { name: 'Unlink' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unlink Asset' }).click();
  await expect(page.getByText('No ASM Assets linked')).toBeVisible();
});

test('SUPER_ADMIN switches tenant without stale Applications', async ({ page }) => {
  await fixture(page, 'SUPER_ADMIN', ['application-inventory'], true); await page.goto(`${app}/appsec/applications`);
  await expect(page.getByText('Pilih tenant untuk membuka')).toBeVisible();
  await page.getByLabel('Tenant AppSec').selectOption('tenant-a');
  await expect(page.getByRole('link', { name: 'Portal A' })).toBeVisible();
  await page.getByLabel('Tenant AppSec').selectOption('tenant-b');
  await expect(page.getByRole('link', { name: 'Portal B' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Portal A' })).toHaveCount(0);
});

test('finding-management alone cannot open Applications', async ({ page }) => {
  await fixture(page, 'ADMIN', ['finding-management']); await page.goto(`${app}/appsec/applications`);
  await expect(page.getByText('Akses AppSec untuk halaman ini tidak tersedia')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Applications' })).toHaveCount(0);
});

test('visual QA captures list and detail at three widths', async ({ page }) => {
  await fixture(page, 'ADMIN', ['application-inventory'], true);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${app}/appsec/applications`);
    await expect(page.getByRole('link', { name: 'Portal A' })).toBeVisible();
    await page.screenshot({ path: `../.omo/evidence/appsec3/list-${width}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Portal A' }).click();
    await expect(page.getByRole('heading', { name: 'Linked ASM Assets' })).toBeVisible();
    await page.screenshot({ path: `../.omo/evidence/appsec3/detail-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
});

test('visual QA captures mutation and restricted states', async ({ page }) => {
  await fixture(page, 'ADMIN', ['application-inventory'], true);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`${app}/appsec/applications`);
  await page.getByRole('button', { name: 'Create application' }).click();
  await expect(page.getByRole('dialog', { name: 'Create application' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/appsec3/create-375.png', fullPage: false });
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('link', { name: 'Portal A' }).click();
  await page.getByRole('button', { name: 'Link Asset' }).click();
  await expect(page.getByRole('dialog', { name: 'Link ASM Asset' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/appsec3/picker-375.png', fullPage: false });
});

test('visual QA captures USER without ASM access', async ({ page }) => {
  await fixture(page, 'USER'); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${app}/appsec/applications/app-a`);
  await expect(page.getByText('ASM asset access is required')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/appsec3/no-asm-1280.png', fullPage: true });
});

test('visual QA captures empty and error states', async ({ page }) => {
  await fixture(page, 'ADMIN', ['application-inventory'], true);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`${app}/appsec/applications`);
  await page.getByRole('textbox', { name: 'Search applications' }).fill('absent');
  await expect(page.getByText('No applications found')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/appsec3/empty-375.png', fullPage: true });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(app).origin && url.pathname === '/appsec/applications') {
      await route.fulfill({ status: 500, json: { message: 'Service unavailable' }, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } });
      return;
    }
    await route.fallback();
  });
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Layanan sedang bermasalah' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/appsec3/error-375.png', fullPage: true });
});

test('visual QA captures loading state', async ({ page }) => {
  await fixture(page, 'ADMIN');
  await page.setViewportSize({ width: 375, height: 900 });
  let release = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(app).origin && url.pathname === '/appsec/applications' && route.request().method() === 'GET') await hold;
    await route.fallback();
  });
  await page.goto(`${app}/appsec/applications`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status').filter({ hasText: 'Loading applications...' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/appsec3/loading-375.png', fullPage: false });
  release();
});
