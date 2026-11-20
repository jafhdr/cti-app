const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const { email, password, value } = JSON.parse(process.env.CORRELATION_QA_FIXTURE);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  try {
    await page.goto('http://localhost:33100/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /Sign In/ }).click();
    await page.waitForURL(/dashboard/, { timeout: 20000 });
    await page.goto('http://localhost:33100/threat-intelligence/correlations');
    await page.getByRole('heading', { name: 'Threat correlations' }).waitFor();
    await page.getByText('No matches in this tenant.').waitFor();
    await page.getByLabel('Observed value').fill(value.toUpperCase());
    const started = performance.now();
    await page.getByRole('button', { name: 'Submit QA event' }).click();
    await page.getByRole('status').getByText('MATCHED').waitFor({ timeout: 20000 });
    await page.getByRole('heading', { name: value }).waitFor();
    const visibleLatencyMs = Math.round(performance.now() - started);
    const status = await page.getByRole('status').innerText();
    const alerts = await page.getByRole('alert').allInnerTexts();
    assert.deepEqual(alerts.filter(text => text.trim()), []);
    await page.screenshot({ path: '../docs/audits/sicti-correlation-pilot-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '../docs/audits/sicti-correlation-pilot-mobile.png', fullPage: true });
    console.log(JSON.stringify({ verdict: 'PASS', authenticated: true, route: '/threat-intelligence/correlations', visibleLatencyMs, status, screenshots: ['desktop', 'mobile'] }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
