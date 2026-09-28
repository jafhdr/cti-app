import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const app = 'http://localhost:3000';

test('live backend: login, overview, indicators, search, filter, and tenant scope', async ({ page }) => {
  const login = await page.request.post(`${api}/auth/login`, { data: { email: 'superadmin@cti.local', password: 'SuperAdmin123!' } });
  expect(login.ok(), `login HTTP ${login.status()}`).toBeTruthy();
  const me = await page.request.get(`${api}/auth/me`);
  expect(me.ok()).toBeTruthy();
  const user = await me.json();
  expect(user.role).toBe('SUPER_ADMIN');
  await page.goto(`${app}/threat-intelligence`);
  await expect(page.getByRole('heading', { name: 'Understand what is targeting your organization.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recently updated entities' })).toBeVisible();
  await page.goto(`${app}/threat-intelligence/indicators`);
  await expect(page.getByRole('heading', { name: 'Track known malicious infrastructure.' })).toBeVisible();
  const response = await page.request.get(`${api}/indicators?limit=100&status=ACTIVE`);
  expect(response.ok(), `indicators HTTP ${response.status()}`).toBeTruthy();
  const data = await response.json();
  console.log('Live active indicator count:', data.total);
  expect(Array.isArray(data.items)).toBeTruthy();
  if (data.items.length > 0) {
    const first = data.items[0];
    await page.getByRole('textbox', { name: 'Search indicators' }).fill(first.value);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(first.value, { exact: true }).first()).toBeVisible();
    await page.locator('.ioc-filters select').nth(0).selectOption(first.type);
    await page.locator('.ioc-filters select').nth(1).selectOption(first.severity);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(first.value, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Detail' }).first().click();
    await expect(page.getByRole('heading', { name: first.value })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Provider results' })).toBeVisible();
  }
});

test('live backend: super admin tenant selection and indicator scoping', async ({ page }) => {
  const login = await page.request.post(`${api}/auth/login`, { data: { email: 'superadmin@cti.local', password: 'SuperAdmin123!' } });
  expect(login.ok(), `login HTTP ${login.status()}`).toBeTruthy();
  const tenants = await page.request.get(`${api}/users/tenants`);
  expect(tenants.ok()).toBeTruthy();
  expect((await tenants.json()).length).toBeGreaterThan(1);
  await page.goto(`${app}/threat-intelligence`);
  const select = page.getByLabel('Tenant Threat Intelligence');
  await expect(select).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recently updated entities' })).toBeVisible();
  await select.selectOption({ index: 1 });
  await expect(page.getByRole('heading', { name: 'Recently updated entities' })).toBeVisible();
});
