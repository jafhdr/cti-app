const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');

async function login(page, email, password) {
  await page.goto('http://localhost:33014/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Sign In/ }).click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

async function main() {
  const fixture = JSON.parse(readFileSync('../.omo/evidence/sicti-phase4a-qa-fixture.json', 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  try {
    const page = await context.newPage();
    await login(page, fixture.own.users.admin.email, fixture.password);
    await page.goto('http://localhost:33014/threat-intelligence/monitoring');
    try { await page.getByRole('heading', { name: 'Dark Web & Brand Monitoring' }).waitFor({ timeout: 10000 }); }
    catch (error) { process.stderr.write(`Monitoring route: ${page.url()}\n${(await page.locator('body').innerText()).slice(0, 1200)}\n`); throw error; }
    const brand = `sictiqa${Date.now().toString().slice(-7)}`;
    await page.getByLabel('Type').selectOption('BRAND');
    await page.getByRole('textbox', { name: 'Brand name' }).fill(brand);
    await page.getByRole('button', { name: 'Add watch' }).click();
    await page.getByText(brand, { exact: true }).first().waitFor();
    await page.getByLabel('Intelligence source').selectOption(fixture.own.sourceId);
    const providerKey = `qa-fixture-browser-${randomUUID().slice(0, 8)}`;
    await page.getByLabel('QA provider key').fill(providerKey);
    await page.getByRole('button', { name: 'Authorize QA source' }).click();
    await page.getByText(providerKey, { exact: false }).first().waitFor();
    const sources = await (await page.request.get('http://localhost:33102/intelligence/monitoring/sources')).json();
    const source = sources.find(item => item.providerKey === providerKey);
    assert.ok(source);
    const sourceCard = page.locator('.monitoring-panel').filter({ hasText: 'Simulated connector health' });
    await sourceCard.getByRole('button', { name: 'Enable QA schedule' }).click();
    await sourceCard.getByText('Scheduled QA collection').waitFor();
    await sourceCard.getByRole('button', { name: 'Run due schedules' }).click();
    let scheduled = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await page.request.get('http://localhost:33102/intelligence/monitoring/collections');
      scheduled = (await response.json()).some(job => job.sourceId === source.id && job.status === 'QUEUED');
      if (scheduled) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(scheduled, true);
    const processed = await page.request.post('http://localhost:33102/intelligence/monitoring/collections/process');
    assert.equal(processed.status(), 201);
    const collections = await (await page.request.get('http://localhost:33102/intelligence/monitoring/collections')).json();
    assert.ok(collections.some(job => job.sourceId === source.id && job.status === 'SUCCEEDED'));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const finding = page.locator('.monitoring-finding').filter({ hasText: brand }).first();
    await finding.getByRole('button', { name: 'Inspect evidence' }).click();
    const detail = page.getByRole('region', { name: 'Monitoring evidence detail' });
    await detail.getByText('qa://simulator/', { exact: false }).waitFor();
    await detail.getByLabel('Review reason').fill('Synthetic lookalike domain and source evidence checked.');
    await detail.getByRole('button', { name: 'Start review' }).click();
    await detail.getByText('UNDER REVIEW', { exact: false }).first().waitFor();
    await detail.getByLabel('Review reason').fill('Confirmed synthetic impersonation pattern for QA.');
    await detail.getByRole('button', { name: 'Confirm finding' }).click();
    await detail.getByText('CONFIRMED', { exact: false }).first().waitFor();
    await detail.getByRole('button', { name: 'Create alert' }).click();
    await detail.getByRole('button', { name: 'Alert linked' }).waitFor();
    await detail.getByRole('button', { name: 'Create case' }).click();
    await detail.getByRole('link', { name: 'Open linked case' }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /password|session token/i);
    await page.screenshot({ path: '../docs/audits/sicti-phase4b-monitoring-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '../docs/audits/sicti-phase4b-monitoring-mobile.png', fullPage: true });
    const evidence = { verdict: 'PASS', authenticated: true, tenantWatchlist: true, authorizedSimulator: true, scheduledCollection: true, syntheticObservation: true, matched: true, evidence: true, reviewed: true, alertLinked: true, caseLinked: true, screenshots: 2 };
    writeFileSync('../docs/audits/sicti-phase4b-browser-evidence.json', JSON.stringify(evidence, null, 2));
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } finally { await context.close(); await browser.close(); }
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : 'Phase 4A browser QA failed'}\n`); process.exitCode = 1; });
