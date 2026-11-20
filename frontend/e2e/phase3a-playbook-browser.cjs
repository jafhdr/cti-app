const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function login(page, email, password) {
  await page.goto('http://localhost:33010/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Sign In/ }).click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

async function main() {
  const f = JSON.parse(process.env.PHASE3A_QA_FIXTURE || '{}');
  if (!f.initiator?.email || !f.approver?.email || !f.password || !f.alertId) throw new Error('Disposable SOAR QA fixture required');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const first = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const second = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  try {
    const page = await first.newPage();
    await login(page, f.initiator.email, f.password);
    await page.goto('http://localhost:33010/threat-intelligence/playbooks');
    await page.getByRole('heading', { name: 'Response playbooks' }).waitFor();
    const otherPending = await page.request.post('http://localhost:33101/playbooks/runs', { data: { alertId: f.alertId, idempotencyKey: crypto.randomUUID() } });
    assert.equal(otherPending.status(), 201);
    await page.reload();
    await page.getByLabel('Correlation alert').selectOption(f.alertId);
    await page.getByRole('button', { name: 'Create playbook run' }).click();
    await page.getByText('Playbook trigger recorded.').waitFor();
    const run = page.locator('.playbook-run').filter({ hasText: f.domain }).first();
    await run.getByLabel('Decision reason').fill('Confirmed the synthetic correlation and target domain.');
    assert.equal(await page.locator('.playbook-run').nth(1).getByLabel('Decision reason').inputValue(), '');
    await run.getByRole('button', { name: 'Confirm target' }).click();
    await run.getByText('PENDING APPROVAL').waitFor();
    const approverPage = await second.newPage();
    await login(approverPage, f.approver.email, f.password);
    await approverPage.goto('http://localhost:33010/threat-intelligence/playbooks');
    const approvalRun = approverPage.locator('.playbook-run').filter({ hasText: f.domain }).first();
    await approvalRun.getByLabel('Decision reason').fill('Independent QA analyst authorizes sandbox simulation only.');
    approverPage.once('dialog', dialog => void dialog.accept());
    await approvalRun.getByRole('button', { name: 'Approve simulation' }).click();
    await approvalRun.getByText('APPROVED', { exact: true }).waitFor();
    await approvalRun.getByRole('button', { name: 'Execute sandbox simulation' }).click();
    await approvalRun.getByText('VERIFYING', { exact: true }).waitFor();
    await approvalRun.getByRole('button', { name: 'Verify receipt' }).click();
    await approvalRun.getByText('VERIFIED', { exact: true }).first().waitFor();
    assert.match(await approvalRun.innerText(), /Sandbox only; no external block was made/);
    assert.match(await approvalRun.innerText(), /IMMUTABLE ACTION RECEIPT/);
    await approverPage.setViewportSize({ width: 1365, height: 1350 });
    await approverPage.evaluate(() => window.scrollTo(0, 0));
    await approverPage.screenshot({ path: '../docs/audits/sicti-phase3a-desktop.png' });
    await approverPage.setViewportSize({ width: 390, height: 1700 });
    await approverPage.evaluate(() => window.scrollTo(0, 0));
    await approverPage.screenshot({ path: '../docs/audits/sicti-phase3a-mobile.png' });
    const response = await approverPage.request.get('http://localhost:33101/playbooks/runs');
    assert.equal(response.status(), 200);
    const rows = await response.json();
    assert.ok(rows.some(row => row.status === 'VERIFIED' && row.alertId === f.alertId));
    process.stdout.write(JSON.stringify({ verdict: 'PASS', authenticated: true, alertLinked: true, independentApproval: true, simulated: true, verified: true, screenshots: 2 }) + '\n');
  } finally { await first.close(); await second.close(); await browser.close(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : 'Browser QA failed'}\n`); process.exitCode = 1; });
