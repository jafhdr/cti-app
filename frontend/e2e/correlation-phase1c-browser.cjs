const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
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
    const credential = await page.evaluate(async () => {
      const response = await fetch('http://localhost:33101/threat-correlations/connector-credentials', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Browser QA machine', expiresInDays: 1 }),
      });
      return { code: response.status, body: await response.json() };
    });
    assert.equal(credential.code, 201, JSON.stringify(credential));
    const sourceKey = `browser-machine-${randomUUID()}`;
    const submitted = await page.evaluate(async ({ token, sourceKey, value }) => {
      const response = await fetch('http://localhost:33101/threat-correlations/machine/events', {
        method: 'POST', headers: { authorization: `SICTIConnector ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKey, sourceName: 'Sandbox SIEM machine', observedAt: new Date().toISOString(),
          observableType: 'DOMAIN', observableValue: value.toUpperCase(), ioaKind: 'DNS_QUERY', confidence: 88, tlp: 'AMBER' }),
      });
      return { code: response.status, body: await response.json() };
    }, { token: credential.body.token, sourceKey, value });
    assert.equal(submitted.code, 201, JSON.stringify(submitted));
    assert.equal(submitted.body.status, 'QUEUED');
    const receipt = Date.parse(submitted.body.receivedAt);
    let state;
    for (let attempt = 0; attempt < 150; attempt++) {
      state = await page.evaluate(async id => {
        const response = await fetch(`http://localhost:33101/threat-correlations/connector/events/${id}`, { credentials: 'include' });
        return response.json();
      }, submitted.body.eventId);
      if (state.processingStatus === 'MATCHED') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(state.processingStatus, 'MATCHED');
    const apiReadableMs = Date.now() - receipt;
    await page.reload();
    await page.getByRole('heading', { name: value }).waitFor();
    const browserRenderedMs = Date.now() - receipt;
    assert.deepEqual((await page.getByRole('alert').allInnerTexts()).filter(Boolean), []);
    await page.screenshot({ path: '../docs/audits/sicti-correlation-phase1c-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '../docs/audits/sicti-correlation-phase1c-mobile.png', fullPage: true });
    await page.evaluate(async id => { await fetch(`http://localhost:33101/threat-correlations/connector-credentials/${id}`, {
      method: 'DELETE', credentials: 'include' }); }, credential.body.id);
    console.log(JSON.stringify({ verdict: 'PASS', authenticatedAnalyst: true, machineCredential: true,
      apiReadableMs, browserRenderedMs, processingMs: state.processingLatencyMs,
      upstreamAcquisitionMs: state.upstreamAcquisitionDelayMs, alerts: state.correlations.length }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
