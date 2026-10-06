import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const app = process.env.FEEDS_APP_URL || 'http://localhost:3000';
const providers = [
  { provider: 'URLHAUS', name: 'URLhaus', status: 'ACTIVE', lastSyncAt: '2026-09-11T03:00:00.000Z', received: 100, created: 12, updated: 88, error: null },
  { provider: 'MALWAREBAZAAR', name: 'MalwareBazaar', status: 'FAILED', lastSyncAt: '2026-09-11T03:00:00.000Z', received: 0, created: 0, updated: 0, error: 'Provider timeout' },
  { provider: 'ABUSEIPDB', name: 'AbuseIPDB', status: 'NOT_CONFIGURED', lastSyncAt: null, received: 0, created: null, updated: null, error: null },
] as const;

async function session(page: Page, role: 'ADMIN' | 'USER' = 'ADMIN'): Promise<void> {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: role.toLowerCase(), email: `${role.toLowerCase()}@example.test`, role, tenantId: 'tenant-a', moduleAccess: [{ moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, accessible: true, featureKeys: ['indicator-management'] }] } }));
}

test('shows three providers and reports partial sync without hiding a failed provider', async ({ page }) => {
  await session(page); let syncMethod = '';
  await page.route('**/indicators/feed-status**', route => route.fulfill({ json: { tenantId: 'tenant-a', scheduler: { enabled: true, intervalMinutes: 60, nextSyncAt: null }, providers } }));
  await page.route('**/indicators/feed-sync', route => { syncMethod = route.request().method(); return route.fulfill({ json: { results: [{ provider: 'URLHAUS', status: 'SYNCED', created: 3, updated: 7, skipped: 0, received: 10 }, { provider: 'MALWAREBAZAAR', status: 'FAILED', created: 0, updated: 0, skipped: 0, received: 0, message: 'Provider timeout' }, { provider: 'ABUSEIPDB', status: 'SKIPPED', created: 0, updated: 0, skipped: 0, received: 0, message: 'Not configured' }], totals: { created: 3, updated: 7, skipped: 0, received: 10 } } }); });
  await page.goto(`${app}/threat-intelligence/feeds`);
  await expect(page.getByRole('heading', { name: 'Threat Feeds' })).toBeVisible();
  for (const provider of providers) await expect(page.getByRole('heading', { name: provider.name })).toBeVisible();
  await expect(page.getByText('Provider timeout')).toBeVisible();
  for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'tablet', width: 768, height: 900 }, { name: 'mobile', width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `../.omo/evidence/intelligence-feeds/${viewport.name}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Sync Now' }).click();
  await expect.poll(() => syncMethod).toBe('POST');
  await expect(page.getByText(/Sync selesai sebagian.*3 dibuat, 7 diperbarui/)).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/intelligence-feeds/partial-success-mobile.png', fullPage: true });
});

test('user can monitor feeds but cannot manually sync', async ({ page }) => {
  await session(page, 'USER');
  await page.route('**/indicators/feed-status**', route => route.fulfill({ json: { tenantId: 'tenant-a', scheduler: { enabled: true, intervalMinutes: 60, nextSyncAt: null }, providers } }));
  await page.goto(`${app}/threat-intelligence/feeds`);
  await expect(page.getByRole('heading', { name: 'Threat Feeds' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync Now' })).toHaveCount(0);
});

test('shows honest loading state and success feedback', async ({ page }) => {
  await session(page); let release = (): void => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/indicators/feed-status**', async route => { await gate; await route.fulfill({ json: { tenantId: 'tenant-a', scheduler: { enabled: true, intervalMinutes: 60, nextSyncAt: null }, providers } }); });
  await page.route('**/indicators/feed-sync', route => route.fulfill({ json: { results: providers.map(provider => ({ provider: provider.provider, status: 'SYNCED', created: 2, updated: 3, skipped: 0, received: 5 })), totals: { created: 6, updated: 9, skipped: 0, received: 15 } } }));
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto(`${app}/threat-intelligence/feeds`);
  await expect(page.getByText('Loading threat feeds...')).toBeVisible(); await expect(page.getByText('Loading', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/intelligence-feeds/loading-mobile.png', fullPage: true }); release();
  await expect(page.getByRole('button', { name: 'Sync Now' })).toBeVisible(); await page.getByRole('button', { name: 'Sync Now' }).click();
  await expect(page.getByText(/Sync selesai.*6 dibuat, 9 diperbarui/)).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/intelligence-feeds/success-mobile.png', fullPage: true });
});

test('shows full sync failure without collapsing provider visibility', async ({ page }) => {
  await session(page);
  await page.route('**/indicators/feed-status**', route => route.fulfill({ json: { tenantId: 'tenant-a', scheduler: { enabled: true, intervalMinutes: 60, nextSyncAt: null }, providers } }));
  await page.route('**/indicators/feed-sync', route => route.fulfill({ json: { results: providers.map(provider => ({ provider: provider.provider, status: 'FAILED', created: 0, updated: 0, skipped: 0, received: 0, message: 'Provider unavailable' })), totals: { created: 0, updated: 0, skipped: 0, received: 0 } } }));
  await page.setViewportSize({ width: 768, height: 900 }); await page.goto(`${app}/threat-intelligence/feeds`); await page.getByRole('button', { name: 'Sync Now' }).click();
  await expect(page.getByText(/Sync gagal.*0 dibuat, 0 diperbarui/)).toBeVisible();
  for (const provider of providers) await expect(page.getByRole('heading', { name: provider.name })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/intelligence-feeds/failed-tablet.png', fullPage: true });
});

test('does not report all skipped providers as success', async ({ page }) => {
  await session(page);
  await page.route('**/indicators/feed-status**', route => route.fulfill({ json: { tenantId: 'tenant-a', scheduler: { enabled: true, intervalMinutes: 60, nextSyncAt: null }, providers } }));
  await page.route('**/indicators/feed-sync', route => route.fulfill({ json: { results: providers.map(provider => ({ provider: provider.provider, status: 'SKIPPED', created: 0, updated: 0, skipped: 0, received: 0, message: 'Cooldown feed masih aktif' })), totals: { created: 0, updated: 0, skipped: 0, received: 0 } } }));
  await page.goto(`${app}/threat-intelligence/feeds`); await page.getByRole('button', { name: 'Sync Now' }).click();
  await expect(page.getByText(/Sync tidak dapat dijalankan/)).toBeVisible();
  await expect(page.locator('.feed-feedback-success')).toHaveCount(0);
});
