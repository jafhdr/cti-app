const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const web = 'http://localhost:33120';
const api = 'http://localhost:33121';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  try {
    await page.goto(`${web}/login`);
    await page.getByLabel('Email address').fill(process.env.CASE_QA_ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill('CaseQaPass123!');
    await page.getByRole('button', { name: /Sign In/ }).click();
    await page.waitForURL(/dashboard|cases/, { timeout: 25000 });
    await page.goto(`${web}/cases`);
    await page.getByRole('heading', { name: 'Investigation performance' }).waitFor({ timeout: 25000 });
    await page.getByText('Snapshot as of').waitFor({ timeout: 25000 });
    const summary = await page.request.get(`${api}/cases/v2/operations/summary`);
    assert.equal(summary.status(), 200);
    assert.equal((await summary.json()).counts.total, 4);
    await page.getByLabel('Queue').selectOption('ALL');
    await page.getByRole('link', { name: process.env.CASE_QA_CASE_NUMBER }).waitFor();
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 850 });
      await page.screenshot({ path: `../docs/audits/case-v2-p1d-dashboard-${width}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Horizontal overflow at ${width}`);
      const alerts = await page.getByRole('alert').allInnerTexts();
      assert.deepEqual(alerts.filter(text => text.trim()), [], JSON.stringify(alerts));
    }
    await page.getByRole('link', { name: process.env.CASE_QA_CASE_NUMBER }).click();
    await page.waitForURL(/cases\//);
    console.log(JSON.stringify({ verdict: 'PASS', viewports: [1280,768,375], realApi: true, caseNavigation: true }));
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
