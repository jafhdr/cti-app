const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const f = JSON.parse(process.env.PHASE2B_QA_FIXTURE || '{}');
  if (!f.email || !f.password || !f.actorId || !f.commandId || !f.outcomeEvidenceId) throw new Error('Disposable Phase 2B QA fixture required');
  const api = 'http://localhost:33101';
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  try {
    await page.goto('http://localhost:33010/login');
    await page.getByLabel('Email address').fill(f.email);
    await page.getByLabel('Password', { exact: true }).fill(f.password);
    await page.getByRole('button', { name: /Sign In/ }).click();
    await page.waitForURL(/dashboard/, { timeout: 20000 });
    const marker = `${Date.now()}-${Math.random()}`;
    async function record(key, techniqueId, evidenceId, time) {
      const created = await page.request.post(`${api}/intelligence/ttp-observations`, { data: { idempotencyKey: `${marker}-${key}`, threatActorId: f.actorId, mitreTechniqueId: techniqueId, sirEvidenceId: evidenceId, attackVersion: 'Enterprise QA', attributionBasis: 'Independent synthetic analyst-mapped source evidence.', observedStartAt: time, observedEndAt: time, timePrecision: 'INSTANT', tlp: 'AMBER', actorConfidence: 80, techniqueConfidence: 90 } });
      assert.equal(created.status(), 201, await created.text());
      const row = await created.json();
      const reviewed = await page.request.post(`${api}/intelligence/ttp-observations/${row.id}/reviews`, { data: { status: 'CONFIRMED', expectedStatus: 'CANDIDATE', reason: 'Analyst confirmed synthetic independent source.' } });
      assert.equal(reviewed.status(), 201, await reviewed.text());
      return row;
    }
    await record('one', f.commandId, f.evidenceId, '2026-11-01T08:00:00.000Z');
    await record('two', f.commandId, f.secondEvidenceId, '2026-11-02T08:00:00.000Z');
    await page.goto(`http://localhost:33010/intelligence/threat-actors?actorId=${encodeURIComponent(f.actorId)}`);
    const section = page.getByRole('region', { name: 'Next-step hypothesis history' });
    await section.getByRole('button', { name: 'Generate hypothesis run' }).click();
    await section.getByText('Deterministic hypothesis run recorded.').waitFor();
    await section.getByRole('heading', { name: /T1105 Ingress Tool Transfer/ }).waitFor();
    assert.match(await section.innerText(), /Heuristic support/);
    const candidate = section.locator('.next-step-candidate').first();
    await candidate.getByLabel('Review reason').fill('Investigate the source-backed next technique.');
    await candidate.getByRole('button', { name: 'Accept for investigation' }).click();
    await section.getByText('Analyst review recorded.').waitFor();
    await candidate.getByRole('button', { name: 'Copy case guidance' }).waitFor();
    const runsResponse = await page.request.get(`${api}/intelligence/next-step-runs?actorId=${f.actorId}`);
    assert.equal(runsResponse.status(), 200);
    const [run] = await runsResponse.json();
    assert.equal(run.status, 'GENERATED');
    await new Promise(resolve => setTimeout(resolve, 1100));
    const outcome = await record('outcome', f.transferId, f.outcomeEvidenceId, new Date().toISOString());
    await page.reload();
    const after = page.getByRole('region', { name: 'Next-step hypothesis history' });
    const item = after.locator('.next-step-candidate').first();
    await item.getByLabel('Later confirmed observation').selectOption(outcome.id);
    await item.getByLabel('Review reason').fill('Later independent source verifies the technique.');
    await item.getByRole('button', { name: 'Record verified outcome' }).click();
    await after.getByText('Analyst review recorded.').waitFor();
    await item.getByText(/Outcome: VERIFIED/).waitFor();
    await page.screenshot({ path: '../docs/audits/sicti-phase2b-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '../docs/audits/sicti-phase2b-mobile.png', fullPage: true });
    const regular = await browser.newContext();
    try {
      const login = await regular.request.post(`${api}/auth/login`, { data: { email: f.userEmail, password: f.password } });
      assert.equal(login.status(), 201);
      assert.equal((await regular.request.post(`${api}/intelligence/next-step-runs`, { data: { idempotencyKey: 'forbidden', threatActorId: f.actorId, asOf: new Date().toISOString(), horizonDays: 14 } })).status(), 403);
    } finally { await regular.close(); }
    const foreign = await browser.newContext();
    try {
      const login = await foreign.request.post(`${api}/auth/login`, { data: { email: f.otherEmail, password: f.password } });
      assert.equal(login.status(), 201);
      assert.equal((await foreign.request.get(`${api}/intelligence/next-step-runs?actorId=${f.actorId}`)).status(), 404);
    } finally { await foreign.close(); }
    process.stdout.write(JSON.stringify({ verdict: 'PASS', authenticated: true, confirmedInputs: 2, generated: true, explanation: true, accepted: true, verifiedOutcome: true, roleDenied: true, foreignScopeDenied: true, screenshots: 2 }) + '\n');
  } finally { await browser.close(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : 'Browser QA failed'}\n`); process.exitCode = 1; });
