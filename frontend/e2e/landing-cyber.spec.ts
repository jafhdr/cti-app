import { expect, test } from '@playwright/test';

const app = process.env.LANDING_QA_URL ?? 'http://localhost:3100';

for (const width of [1440, 768, 375]) {
  test(`static module showcase at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const apiRequests: string[] = [];
    page.on('request', (request) => {
      if (/\/api\//.test(request.url())) apiRequests.push(request.url());
    });

    await page.goto(app);
    await page.locator('#capabilities').scrollIntoViewIfNeeded();
    const cards = page.locator('#capabilities .lp-cyber-card');
    await expect(cards).toHaveCount(4);
    for (const name of ['Threat intelligence', 'Attack surface', 'Case management', 'Administration']) {
      await expect(cards.getByRole('heading', { name })).toBeVisible();
    }
    await expect(page.locator('.lp-module-visual')).toHaveCount(3);
    await expect(page.locator('.lp-threat-feature')).toHaveCount(4);
    await expect(page.locator('.lp-threat-reticle')).toHaveCount(1);
    await expect(page.locator('.lp-threat-header')).toHaveCount(1);
    await expect(page.locator('.lp-threat-feature b')).toHaveText(['Indicators', 'Threat Actors', 'Campaigns', 'Brief Reports']);
    await expect(page.locator('.lp-module-surface .lp-mini-node')).toHaveCount(4);
    await expect(page.locator('.lp-module-cases .lp-timeline i')).toHaveCount(4);
    await expect(page.locator('.lp-module-administration .lp-mini-node')).toHaveCount(4);
    for (const visual of await page.locator('.lp-module-visual').all()) {
      await expect(visual.locator('.lp-subsystems span')).toHaveCount(4);
    }
    const columns = await cards.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().left));
    expect(columns[0] === columns[1]).toBe(width === 375);
    for (const card of await cards.all()) await card.scrollIntoViewIfNeeded();
    await page.locator('#capabilities').screenshot({ path: `../.omo/evidence/landing/cyber-${width}.png`, animations: 'disabled' });
    if (width === 1440) await cards.first().screenshot({ path: '../.omo/evidence/landing/threat-intelligence-close.png', animations: 'disabled' });
    expect(apiRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('mouse spotlight and reduced-motion behavior', async ({ page }) => {
  await page.goto(app);
  const card = page.locator('.lp-cyber-card').first();
  await card.scrollIntoViewIfNeeded();
  await expect(page.locator('.lp-threat-signal .lp-threat-flow')).toHaveCSS('animation-name', 'lp-threat-travel');
  await card.hover();
  expect(await card.evaluate((element) => element.style.getPropertyValue('--pointer-x'))).not.toBe('');
  expect(await card.evaluate((element) => getComputedStyle(element).transform)).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(card).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.lp-threat-reticle')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.lp-threat-signal .lp-threat-flow')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.lp-module-visual')).toHaveCount(3);
});
