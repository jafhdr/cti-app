const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const api = 'http://localhost:33111';
const web = 'http://localhost:33110';

async function login(page, email) {
  await page.goto(`${web}/login`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('CaseQaPass123!');
  await page.getByRole('button', { name: /Sign In/ }).click();
  await page.waitForURL(/dashboard|cases/, { timeout: 25000 });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const reviewerContext = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const admin = await adminContext.newPage();
  const reviewer = await reviewerContext.newPage();
  try {
    await login(admin, process.env.CASE_QA_ADMIN_EMAIL);
    const created = await admin.request.post(`${api}/cases`, { data: { title: 'Browser P1-C review and closure QA' } });
    assert.equal(created.status(), 201, await created.text());
    const caseId = (await created.json()).id;
    const evidence = await admin.request.post(`${api}/cases/${caseId}/evidence`, { data: { requestId: `browser-p1c-${Date.now()}`, name: 'SIEM timeline', type: 'log', source: 'QA SIEM ticket' } });
    assert.equal(evidence.status(), 201, await evidence.text());
    for (const status of ['IN_PROGRESS', 'RESOLVED']) {
      const response = await admin.request.patch(`${api}/cases/${caseId}`, { data: { status } });
      assert.equal(response.status(), 200, await response.text());
    }
    await admin.goto(`${web}/cases/${caseId}`);
    await admin.getByRole('heading', { name: 'Review and closure', exact: true }).waitFor({ timeout: 25000 });
    await admin.getByRole('button', { name: 'History', exact: true }).click();
    await admin.getByText('Revision 1').waitFor();
    await admin.getByLabel('Independent reviewer').selectOption({ label: process.env.CASE_QA_REVIEWER_NAME });
    await admin.getByLabel('Review request context').fill('Evidence ready for independent review');
    await admin.getByRole('button', { name: 'Request review' }).click();
    await admin.getByText(/Cycle 1 · REQUESTED/).waitFor();
    await login(reviewer, process.env.CASE_QA_REVIEWER_EMAIL);
    await reviewer.goto(`${web}/cases/${caseId}`);
    await reviewer.getByLabel('Review decision reason').fill('Evidence and investigation checked independently');
    await reviewer.getByRole('button', { name: 'Approve review' }).click();
    await reviewer.getByText(/Cycle 1 · APPROVED/).waitFor();
    await reviewer.screenshot({ path: '../docs/audits/case-v2-p1c-review-decision.png', fullPage: true });
    await admin.reload();
    await admin.getByText(/Cycle 1 · APPROVED/).waitFor();
    await admin.getByLabel('Closure reason').fill('Investigation complete');
    await admin.getByLabel('Final investigation summary').fill('The SIEM timeline was reviewed and the case resolution confirmed.');
    await admin.getByRole('button', { name: 'Close case' }).click();
    await admin.getByText('Closed · cycle 1').waitFor();
    for (const width of [1280, 768, 375]) {
      await admin.setViewportSize({ width, height: 850 });
      await admin.screenshot({ path: `../docs/audits/case-v2-p1c-closure-${width}.png`, fullPage: true });
      const alerts = await admin.getByRole('alert').allInnerTexts();
      assert.equal(alerts.filter(text => text.trim()).length, 0, JSON.stringify(alerts));
      assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Horizontal overflow at ${width}`);
    }
    await admin.getByLabel('Reopen reason').fill('New intelligence requires another cycle');
    await admin.getByRole('button', { name: 'Reopen case' }).click();
    await admin.getByText('Reopened · cycle 1 → 2').waitFor();
    await admin.screenshot({ path: '../docs/audits/case-v2-p1c-reopened-375.png', fullPage: true });
    console.log(JSON.stringify({ verdict: 'PASS', route: `/cases/${caseId}`, viewports: [1280, 768, 375], authentication: 'real', actions: ['evidence history', 'request review', 'independent approval', 'closure', 'reopen'] }));
  } finally { await adminContext.close(); await reviewerContext.close(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
