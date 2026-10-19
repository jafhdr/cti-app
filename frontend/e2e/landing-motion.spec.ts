import { expect, test } from '@playwright/test';
const app = process.env.LANDING_QA_URL ?? 'http://localhost:3000';
for (const width of [1440, 768, 375]) {
  test(`landing story at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(app);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.locator('.lp-feature')).toHaveCount(3);
    await expect(page.locator('.lp-cta').getByRole('link', { name: /Get Started/i })).toBeVisible();
    await expect(page.locator('.lp-footer')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
