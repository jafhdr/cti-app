import { expect, test } from '@playwright/test';
const app = process.env.LANDING_QA_URL ?? 'http://localhost:3000';
for (const width of [1440, 768, 375]) {
  test(`landing reference at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(app);
    await expect(page.locator('.lp-cap-grid article')).toHaveCount(4);
    await expect(page.locator('.lp-asset-steps span')).toHaveCount(4);
    await expect(page.locator('.lp-security-list span')).toHaveCount(3);
    await expect(page.locator('.lp-socials a')).toHaveCount(4);
    await expect(page.locator('.lp-footer-email')).toHaveText('ptsisi@sisi.sig.id');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test('hover styles change and return to rest', async ({ page }) => {
  await page.goto(app);
  for (const [selector, property] of [['.lp-cap-grid article', 'backgroundColor'], ['.lp-asset-steps span', 'backgroundColor'], ['.lp-security-list span', 'borderTopColor']] as const) {
    const item = page.locator(selector).first();
    const rest = await item.evaluate((node, name) => getComputedStyle(node)[name], property);
    await item.hover();
    await expect.poll(() => item.evaluate((node, name) => getComputedStyle(node)[name], property)).not.toBe(rest);
    await page.mouse.move(0, 0);
    await expect.poll(() => item.evaluate((node, name) => getComputedStyle(node)[name], property)).toBe(rest);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(Number.parseFloat(await page.locator('.lp-cap-grid article').first().evaluate((node) => getComputedStyle(node).transitionDuration))).toBeLessThan(0.01);
});
