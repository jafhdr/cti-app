const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  try {
    await page.goto('http://localhost:33100/login');
    await page.getByLabel('Email address').fill(process.env.CASE_QA_ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill('CaseQaPass123!');
    await page.getByRole('button', { name: /Sign In/ }).click();
    await page.waitForURL(/dashboard|cases/, { timeout: 25000 });
    const create = await page.request.post('http://localhost:33101/cases', { data: { title: 'Browser P1-B workflow QA' } });
    assert.equal(create.status(), 201, await create.text());
    const caseId = (await create.json()).id;
    await page.goto(`http://localhost:33100/cases/${caseId}`);
    await page.getByRole('heading', { name: 'Workflow', exact: true }).waitFor({ timeout: 25000 });
    await page.getByLabel('Judul task').fill('Browser investigation task');
    await page.getByLabel('Task assignee').selectOption({ label: process.env.CASE_QA_ANALYST_NAME });
    await page.getByRole('button', { name: 'Tambah task' }).click();
    await page.getByText('Browser investigation task').waitFor();
    const task = page.getByRole('listitem').filter({ hasText: 'Browser investigation task' });
    await task.getByRole('button', { name: 'Mulai' }).click();
    await task.getByText('IN PROGRESS').waitFor();
    await page.getByLabel('Due date').fill('2026-10-29T12:00');
    await page.getByRole('button', { name: 'Simpan due date' }).click();
    await page.getByText('Overdue').waitFor();
    await page.getByLabel('Handoff assignee').selectOption({ label: process.env.CASE_QA_ANALYST_NAME });
    await page.getByLabel('Alasan handoff').fill('Browser QA shift handoff');
    await page.getByRole('button', { name: 'Serahkan case' }).click();
    await page.getByText('Browser QA shift handoff').waitFor();
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 850 });
      await page.screenshot({ path: `../docs/audits/case-v2-p1b-browser-${width}.png`, fullPage: true });
      const alert = await page.getByRole('alert').allInnerTexts();
      assert.equal(alert.filter(text => text.trim()).length, 0, JSON.stringify(alert));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    }
    console.log(JSON.stringify({ verdict: 'PASS', route: `/cases/${caseId}`, viewports: [1280, 768, 375], authentication: 'real', actions: ['create task', 'start task', 'set due date', 'handoff'] }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
