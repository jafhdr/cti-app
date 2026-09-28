import { expect, test } from '@playwright/test';

const subscription = {
  id: 'sub-1', isCustom: false, billingCycle: 'MONTHLY', priceMonthly: 100000,
  priceYearly: 1000000, status: 'ACTIVE', subscribedAt: '2026-09-01T00:00:00.000Z',
  renewalAt: '2026-10-01T00:00:00.000Z', subscriptionActive: true,
  package: { id: 'plan-1', name: 'Professional', description: 'Plan from fixture', type: 'PREDEFINED', priceMonthly: 100000, priceYearly: 1000000, modules: [] },
  includedModules: [
    { id: 'asm', name: 'Attack Surface Management', subscriptionIncluded: true },
    { id: 'ti', name: 'Threat Intelligence', subscriptionIncluded: true },
    { id: 'cases', name: 'Case Management', subscriptionIncluded: false },
  ], customModules: [],
};

test('subscription fixture overview across themes and viewports', async ({ page }) => {
  await page.route('**/auth/me', route => route.fulfill({ json: { role: 'ADMIN', email: 'admin@example.test', tenant: { id: 'tenant-1', name: 'Fixture Organization' }, moduleAccess: [] } }));
  await page.route('**/subscription/packages', route => route.fulfill({ json: [subscription.package] }));
  await page.route('**/subscription/my', route => route.fulfill({ json: subscription }));
  await page.goto('http://localhost:3000/subscription');
  await expect(page.getByRole('heading', { name: 'Professional' }).first()).toBeVisible();
  await expect(page.getByLabel('Platform capabilities').getByText('Attack Surface Management')).toBeVisible();
  await expect(page.getByLabel('Platform capabilities').getByText('Unavailable')).toBeVisible();
  for (const [name, width] of [['dark-1440', 1440], ['light-1440', 1440], ['mobile-375', 375], ['tablet-768', 768]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => localStorage.setItem('cti-theme', theme), name.startsWith('light') ? 'light' : 'dark');
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../.omo/evidence/subscription/phase1/subscription-${name}.png`, fullPage: true });
    await page.screenshot({ path: `../.omo/evidence/subscription/phase1/entitlements-${name}.png`, fullPage: true });
  }
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => localStorage.setItem('cti-theme', 'system'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
  }
});
