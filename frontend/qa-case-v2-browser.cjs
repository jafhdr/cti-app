const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:33100/login');
    await page.getByLabel('Email address').fill(process.env.CASE_QA_ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill('CaseQaPass123!');
    await page.getByRole('button', { name: /Sign In/ }).click();
    await page.waitForURL(/dashboard|cases/, { timeout: 20000 });
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto('http://localhost:33100/cases');
      await page.getByRole('heading', { name: 'Case Management' }).waitFor();
      await page.getByText('Loading cases...').waitFor({ state: 'hidden' });
      const alerts = await page.getByRole('alert').allInnerTexts();
      assert.equal(alerts.filter(text => text.trim()).length, 0, JSON.stringify(alerts));
      await page.screenshot({ path: `../docs/audits/case-v2-p1a-browser-${width}.png`, fullPage: true });
    }
    console.log(JSON.stringify({ verdict: 'PASS', viewports: [1280, 768, 375], route: '/cases', authentication: 'real' }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
