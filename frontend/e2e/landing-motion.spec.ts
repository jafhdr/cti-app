import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const app = process.env.LANDING_QA_URL ?? 'http://localhost:3100';
const evidence = '../.omo/evidence/landing/motion';

for (const width of [1440, 768, 375]) {
  test(`landing story remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(app);
    await mkdir(evidence, { recursive: true });
    await page.locator('.lp-hero').screenshot({ path: `${evidence}/hero-${width}.png`, animations: 'disabled' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get started' }).first()).toBeVisible();

    for (const id of ['intelligence', 'attack-surface', 'cases']) {
      const section = page.locator(`#${id}`);
      await section.scrollIntoViewIfNeeded();
      await expect(section.locator('[data-reveal]').first()).toHaveClass(/is-visible/);
      await expect(section.getByRole('heading', { level: 2 })).toBeVisible();
      await section.screenshot({ path: `${evidence}/${id}-${width}.png`, animations: 'disabled' });
    }

    await page.locator('.lp-cta').scrollIntoViewIfNeeded();
    await expect(page.locator('.lp-cta').getByRole('link', { name: 'Get started' })).toBeVisible();
    await page.locator('.lp-cta').screenshot({ path: `${evidence}/cta-${width}.png`, animations: 'disabled' });
    await expect(page.locator('.lp-footer')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('reduced motion keeps all landing content visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(app);
  await expect(page.locator('#intelligence .lp-panel')).toBeVisible();
  expect(await page.locator('#intelligence .lp-panel').evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
});

for (const [preference, colorScheme] of [['dark', 'dark'], ['light', 'light'], ['system', 'dark'], ['system', 'light']] as const) {
  test(`landing theme ${preference} with ${colorScheme} system`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.addInitScript((theme) => localStorage.setItem('cti-theme', theme), preference);
    await page.goto(app);
    await expect(page.locator('html')).toHaveAttribute('data-theme', preference === 'system' ? colorScheme : preference);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
}
