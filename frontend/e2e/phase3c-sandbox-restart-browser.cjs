const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFileSync, writeFileSync } = require('node:fs');
const { randomUUID, createHmac } = require('node:crypto');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');

async function replaceMock(oldPid, mode = 'normal') {
  const endpoint = process.env.SICTI_SOAR_SANDBOX_URL;
  if (!Number.isInteger(oldPid) || !endpoint) throw new Error('Isolated mock restart configuration required');
  process.kill(oldPid);
  for (let i = 0; i < 80; i++) {
    try { process.kill(oldPid, 0); await new Promise(resolveWait => setTimeout(resolveWait, 50)); }
    catch { break; }
  }
  const child = spawn(process.execPath, ['qa-phase3b-mock-tool.cjs'], { cwd: resolve(__dirname, '../../backend'), env: { ...process.env, SICTI_SOAR_MOCK_PORT: new URL(endpoint).port, SICTI_SOAR_MOCK_MODE: mode }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((done, fail) => {
      child.stdout.once('data', data => data.toString().includes('Sandbox mock ready') ? done() : fail(new Error('Mock restart failed')));
      child.once('error', fail);
      child.once('exit', code => fail(new Error(`Mock restart exited ${code}`)));
    });
    return child;
  } catch (error) { child.kill(); throw error; }
}

async function restartMockAndVerify(f) {
  const child = await replaceMock(Number(process.env.SICTI_SOAR_MOCK_PID));
  const endpoint = process.env.SICTI_SOAR_SANDBOX_URL;
  const secret = process.env.SICTI_SOAR_SANDBOX_SECRET;
  try {
    const body = JSON.stringify({ version: 1, requestId: randomUUID(), tenantId: f.tenantId, target: f.domain, timestamp: Date.now(), nonce: randomUUID() });
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    const response = await fetch(`${endpoint}v1/state`, { method: 'POST', headers: { 'x-soar-signature': signature }, body });
    assert.equal(response.status, 200);
    const raw = await response.text();
    assert.equal(response.headers.get('x-soar-signature'), createHmac('sha256', secret).update(raw).digest('hex'));
    assert.equal(JSON.parse(raw).blocked, true);
    return child;
  } catch (error) { child.kill(); throw error; }
}

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
  let restartedMock;
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
    await approver.screenshot({ path: '../docs/audits/sicti-phase3c-block-verified-desktop.png', fullPage: true });
    restartedMock = await restartMockAndVerify(f);
    approver.once('dialog', dialog => void dialog.accept());
    await approvalRun.getByRole('button', { name: 'Queue safe rollback' }).click();
    for (let i = 0; i < 30; i++) {
      await approver.getByRole('button', { name: 'Refresh status' }).click();
      if (await approvalRun.getByText('ROLLED BACK', { exact: true }).first().isVisible().catch(() => false)) break;
      await approver.waitForTimeout(300);
    }
    await approvalRun.getByText('ROLLED BACK', { exact: true }).first().waitFor();
    assert.match(await approvalRun.innerText(), /blocked: no/);
    await approver.screenshot({ path: '../docs/audits/sicti-phase3c-restored-desktop.png', fullPage: true });
    await approver.setViewportSize({ width: 390, height: 1700 });
    await approver.screenshot({ path: '../docs/audits/sicti-phase3c-restored-mobile.png', fullPage: true });
    await initiator.reload();
    await initiator.getByLabel('Correlation alert').selectOption(f.alertId);
    await initiator.getByRole('button', { name: 'Create playbook run' }).click();
    const secondRun = initiator.locator('.playbook-run').filter({ hasText: f.domain }).first();
    await secondRun.getByLabel('Decision reason').fill('Synthetic second run for rollback recovery testing.');
    await secondRun.getByRole('button', { name: 'Confirm target' }).click();
    await approver.setViewportSize({ width: 1365, height: 900 });
    await approver.reload();
    const recoverableRun = approver.locator('.playbook-run').filter({ hasText: f.domain }).first();
    await recoverableRun.getByLabel('Decision reason').fill('Independent approval for rollback recovery QA.');
    approver.once('dialog', dialog => void dialog.accept());
    await recoverableRun.getByRole('button', { name: 'Approve simulation' }).click();
    await recoverableRun.getByRole('button', { name: 'Queue sandbox block' }).click();
    for (let i = 0; i < 40; i++) {
      await approver.getByRole('button', { name: 'Refresh status' }).click();
      if (await recoverableRun.getByText('VERIFIED', { exact: true }).first().isVisible().catch(() => false)) break;
      await approver.waitForTimeout(300);
    }
    await recoverableRun.getByText('VERIFIED', { exact: true }).first().waitFor();
    restartedMock = await replaceMock(restartedMock.pid, 'rollback-failure');
    approver.once('dialog', dialog => void dialog.accept());
    await recoverableRun.getByRole('button', { name: 'Queue safe rollback' }).click();
    for (let i = 0; i < 70; i++) {
      await approver.getByRole('button', { name: 'Refresh status' }).click();
      if (await recoverableRun.getByText('ROLLBACK FAILED', { exact: true }).first().isVisible().catch(() => false)) break;
      await approver.waitForTimeout(300);
    }
    await recoverableRun.getByText('ROLLBACK FAILED', { exact: true }).first().waitFor();
    await approver.setViewportSize({ width: 1365, height: 1350 });
    await approver.screenshot({ path: '../docs/audits/sicti-phase3c-recovery-failed-desktop.png', fullPage: true });
    restartedMock = await replaceMock(restartedMock.pid, 'normal');
    await recoverableRun.getByLabel('Recovery reason').fill('Operator confirmed sandbox outage ended and requests verified restoration.');
    approver.once('dialog', dialog => void dialog.accept());
    await recoverableRun.getByRole('button', { name: 'Retry sandbox restoration' }).click();
    for (let i = 0; i < 40; i++) {
      await approver.getByRole('button', { name: 'Refresh status' }).click();
      if (await recoverableRun.getByText('ROLLED BACK', { exact: true }).first().isVisible().catch(() => false)) break;
      await approver.waitForTimeout(300);
    }
    await recoverableRun.getByText('ROLLED BACK', { exact: true }).first().waitFor();
    assert.match(await recoverableRun.innerText(), /RECOVERY QUEUED/);
    assert.match(await recoverableRun.innerText(), /blocked: no/);
    await approver.screenshot({ path: '../docs/audits/sicti-phase3c-recovery-restored-desktop.png', fullPage: true });
    await approver.setViewportSize({ width: 390, height: 1700 });
    await approver.screenshot({ path: '../docs/audits/sicti-phase3c-recovery-restored-mobile.png', fullPage: true });
    const response = await approver.request.get('http://localhost:33101/playbooks/runs');
    assert.equal(response.status(), 200);
    const row = (await response.json()).find(item => item.domain === f.domain && item.status === 'ROLLED_BACK');
    assert.ok(row);
    writeFileSync('../docs/audits/sicti-phase3c-browser-evidence.json', JSON.stringify({ runId: row.id, alertId: row.alertId, status: row.status, mockRestarted: true, persistedBlockedStateConfirmed: true, operatorRecoveryVerified: true, jobs: row.sandboxJobs.map(job => ({ operation: job.operation, status: job.status, attempts: job.attempts, events: job.events.map(event => event.kind) })), authenticated: true, screenshotCount: 6 }, null, 2));
    process.stdout.write('Authenticated Phase 3C browser restart flow PASS\n');
  } finally { if (restartedMock) restartedMock.kill(); await first.close(); await second.close(); await browser.close(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : error}\n`); process.exitCode = 1; });
