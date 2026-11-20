const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFileSync, writeFileSync } = require('node:fs');

async function login(page, email, password) {
  await page.goto('http://localhost:33010/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Sign In/ }).click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

async function main() {
  const f = JSON.parse(readFileSync('../.omo/evidence/sicti-phase3b-qa-fixture.json', 'utf8'));
  assert.match(f.domain, /\.test$/);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const first = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const second = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  try {
    const initiator = await first.newPage();
    await login(initiator, f.initiator.email, f.password);
    await initiator.goto('http://localhost:33010/threat-intelligence/playbooks');
    await initiator.getByRole('heading', { name: 'Response playbooks' }).waitFor();
    await initiator.getByLabel('Correlation alert').selectOption(f.alertId);
    await initiator.getByRole('button', { name: 'Create playbook run' }).click();
    const run = initiator.locator('.playbook-run').filter({ hasText: f.domain }).first();
    await run.getByLabel('Decision reason').fill('Synthetic correlation and exact QA target reviewed.');
    await run.getByRole('button', { name: 'Confirm target' }).click();
    await run.getByText('PENDING APPROVAL').waitFor();
    const approver = await second.newPage();
    await login(approver, f.approver.email, f.password);
    await approver.goto('http://localhost:33010/threat-intelligence/playbooks');
    const approvalRun = approver.locator('.playbook-run').filter({ hasText: f.domain }).first();
    await approvalRun.getByLabel('Decision reason').fill('Separate analyst approval for synthetic sandbox domain.');
    approver.once('dialog', dialog => void dialog.accept());
    await approvalRun.getByRole('button', { name: 'Approve simulation' }).click();
    await approvalRun.getByText('APPROVED', { exact: true }).waitFor();
    await approvalRun.getByRole('button', { name: 'Queue sandbox block' }).click();
    for (let i = 0; i < 30; i++) {
      await approver.getByRole('button', { name: 'Refresh status' }).click();
      if (await approvalRun.getByText('VERIFIED', { exact: true }).first().isVisible().catch(() => false)) break;
      await approver.waitForTimeout(300);
    }
    await approvalRun.getByText('VERIFIED', { exact: true }).first().waitFor();
    assert.match(await approvalRun.innerText(), /STATE VERIFIED/);
    await approver.setViewportSize({ width: 1365, height: 1350 });
    await approver.screenshot({ path: '../docs/audits/sicti-phase3b-block-verified-desktop.png', fullPage: true });
    approver.once('dialog', dialog => void dialog.accept());
    await approvalRun.getByRole('button', { name: 'Queue safe rollback' }).click();
    for (let i = 0; i < 30; i++) {
      await approver.getByRole('button', { name: 'Refresh status' }).click();
      if (await approvalRun.getByText('ROLLED BACK', { exact: true }).first().isVisible().catch(() => false)) break;
      await approver.waitForTimeout(300);
    }
    await approvalRun.getByText('ROLLED BACK', { exact: true }).first().waitFor();
    assert.match(await approvalRun.innerText(), /blocked: no/);
    await approver.screenshot({ path: '../docs/audits/sicti-phase3b-restored-desktop.png', fullPage: true });
    await approver.setViewportSize({ width: 390, height: 1700 });
    await approver.screenshot({ path: '../docs/audits/sicti-phase3b-restored-mobile.png', fullPage: true });
    const response = await approver.request.get('http://localhost:33101/playbooks/runs');
    assert.equal(response.status(), 200);
    const row = (await response.json()).find(item => item.domain === f.domain && item.status === 'ROLLED_BACK');
    assert.ok(row);
    writeFileSync('../docs/audits/sicti-phase3b-browser-evidence.json', JSON.stringify({ runId: row.id, alertId: row.alertId, status: row.status, jobs: row.sandboxJobs.map(job => ({ operation: job.operation, status: job.status, attempts: job.attempts, events: job.events.map(event => event.kind) })), authenticated: true, screenshotCount: 3 }, null, 2));
    process.stdout.write('Authenticated Phase 3B browser flow PASS\n');
  } finally { await first.close(); await second.close(); await browser.close(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : error}\n`); process.exitCode = 1; });
