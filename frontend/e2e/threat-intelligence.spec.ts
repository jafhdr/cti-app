import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const app = 'http://localhost:3000';

async function login(page: import('@playwright/test').Page): Promise<void> {
  const response = await page.request.post(`${api}/auth/login`, { data: { email: 'superadmin@cti.local', password: 'SuperAdmin123!' } });
  expect(response.ok()).toBeTruthy();
}

test('Threat Intelligence is the parent navigation and overview uses API data', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${app}/threat-intelligence`);
  await expect(page.getByRole('heading', { name: 'Threat Intelligence', exact: true })).toBeVisible();
  await expect(page.getByLabel('Tenant Threat Intelligence')).toBeVisible();
  await expect(page.getByText('Threat Intelligence', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('CTI Entities', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/threat-intelligence/overview-desktop.png', fullPage: true });
});

test('entity sections and Intelligence Hub stay inside Threat Intelligence', async ({ page }) => {
  await login(page);
  for (const route of ['threat-actors', 'campaigns', 'malware-tools', 'vulnerabilities', 'reports', 'sources', 'feeds']) {
    await page.goto(`${app}/threat-intelligence/${route}`);
    await expect(page.locator('h1')).toBeVisible();
  }
  await page.goto(`${app}/threat-intelligence/indicators`);
  await expect(page.getByRole('heading', { name: 'Indicators / IOC', exact: true })).toBeVisible();
  await expect(page.locator('.ti-section-tabs')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../.omo/evidence/threat-intelligence/indicators-desktop.png', fullPage: true });
  await page.goto(`${app}/threat-intelligence/hub`);
  await expect(page.getByRole('heading', { name: 'CTI Entities', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Relationships', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buat case' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Buat alert' })).toHaveCount(0);
  await page.screenshot({ path: '../.omo/evidence/threat-intelligence/hub-desktop.png', fullPage: true });
});

test('Threat Intelligence remains usable on mobile', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app}/threat-intelligence`);
  await expect(page.getByRole('heading', { name: 'Threat Intelligence', exact: true })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/threat-intelligence/overview-mobile.png', fullPage: true });
  await page.goto(`${app}/threat-intelligence/hub`);
  await expect(page.getByRole('heading', { name: 'Intelligence Hub', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'CTI Platform dashboard' })).toBeVisible();
  await expect(page.locator('.ti-section-tabs')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('.sidebar-navigation').evaluate(element => { element.scrollLeft = 0; });
  await page.locator('.sidebar').evaluate(element => { element.scrollLeft = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../.omo/evidence/threat-intelligence/hub-mobile.png', fullPage: true });
});
