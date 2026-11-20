const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const fixture = JSON.parse(process.env.PHASE2A_QA_FIXTURE || '{}');
  if (!fixture.baseUrl || !fixture.email || !fixture.password || !fixture.actorId) throw new Error('Authenticated disposable Phase 2A QA fixture required');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  try {
    await page.goto(`${fixture.baseUrl}/login`);
    await page.getByLabel('Email address').fill(fixture.email);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: /Sign In/ }).click();
    await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(async error => {
      const alert = await page.getByRole('alert').allTextContents();
      throw new Error(`${error.message}; currentUrl=${page.url()}; alerts=${JSON.stringify(alert)}`);
    });
    await page.goto(`${fixture.baseUrl}/intelligence/threat-actors?actorId=${encodeURIComponent(fixture.actorId)}`);
    await page.getByRole('heading', { name: 'ATT&CK observation timeline' }).waitFor();
    const priorResponse = await page.request.get(`http://localhost:33101/intelligence/ttp-observations?actorId=${fixture.actorId}`);
    assert.equal(priorResponse.status(), 200);
    const prior = await priorResponse.json();
    const latest = Math.max(Date.parse('2026-11-11T08:00:00Z'), ...prior.map(item => Date.parse(item.observedStartAt)));
    const uiTime = new Date(latest + 60000).toISOString().slice(0, 16);
    await page.getByRole('button', { name: 'Add observation' }).click();
    await page.getByLabel('ATT&CK technique').selectOption({ index: 1 });
    await page.getByLabel('Linked SIR evidence').selectOption({ index: 1 });
    await page.getByLabel('ATT&CK version').fill('Enterprise QA');
    await page.getByLabel('Observed from').fill(uiTime);
    await page.getByLabel('Actor attribution confidence').fill('70');
    await page.getByLabel('Technique mapping confidence').fill('80');
    await page.getByLabel('Attribution and technique basis').fill('Analyst verified the source and mapped the observed behavior.');
    await page.getByRole('button', { name: 'Create candidate' }).click();
    await page.getByText('Candidate observation created for analyst review.').waitFor();
    const timeline = page.getByRole('region', { name: 'ATT&CK observation timeline' });
    await timeline.getByText('Candidate · awaiting review', { exact: true }).last().waitFor();
    await timeline.getByLabel('Review reason').last().fill('Source and ATT&CK mapping checked by analyst.');
    await timeline.getByRole('button', { name: 'Confirm' }).last().click();
    await page.getByText('Observation confirmed.').waitFor();
    await timeline.getByText('Confirmed', { exact: true }).first().waitFor();
    await page.screenshot({ path: '../docs/audits/sicti-phase2a-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '../docs/audits/sicti-phase2a-mobile.png', fullPage: true });
    const api = 'http://localhost:33101/intelligence/ttp-observations';
    const create = (key, start, end, tlp = 'AMBER') => ({ idempotencyKey: key, threatActorId: fixture.actorId, mitreTechniqueId: fixture.techniqueId, attackVersion: 'Enterprise QA', sirEvidenceId: fixture.evidenceId, attributionBasis: 'Analyst verified source-backed behavior.', observedStartAt: start, observedEndAt: end, timePrecision: start === end ? 'INSTANT' : 'INTERVAL', tlp, actorConfidence: 70, techniqueConfidence: 80 });
    const key = `${Date.now()}-${Math.random()}`;
    const overlap = await page.request.post(api, { data: create(`qa-overlap-${key}`, '2026-11-09T07:30:00Z', '2026-11-09T08:30:00Z') });
    assert.equal(overlap.status(), 201);
    const overlappingPoint = await page.request.post(api, { data: create(`qa-overlap-point-${key}`, '2026-11-09T08:00:00Z', '2026-11-09T08:00:00Z') });
    assert.equal(overlappingPoint.status(), 201);
    const rejected = await page.request.post(api, { data: create(`qa-reject-${key}`, '2026-11-09T09:00:00Z', '2026-11-09T09:00:00Z') });
    assert.equal(rejected.status(), 201);
    const rejectedBody = await rejected.json();
    const review = await page.request.post(`${api}/${rejectedBody.id}/reviews`, { data: { status: 'REJECTED', expectedStatus: 'CANDIDATE', reason: 'Analyst found the attribution unsupported.' } });
    assert.equal(review.status(), 201);
    const red = await page.request.post(api, { data: create(`qa-red-${key}`, '2026-11-09T10:00:00Z', '2026-11-09T10:00:00Z', 'RED') });
    assert.equal(red.status(), 201);
    const redBody = await red.json();
    const timelineResponse = await page.request.get(`${api}?actorId=${fixture.actorId}`);
    assert.equal(timelineResponse.status(), 200);
    const observations = await timelineResponse.json();
    assert.ok(observations.some(item => item.id === rejectedBody.id && item.status === 'REJECTED'));
    assert.ok(observations.some(item => item.ordering === 'OVERLAPS'));
    const sorted = observations.map(item => new Date(item.observedStartAt).valueOf());
    assert.deepEqual(sorted, [...sorted].sort((a, b) => a - b));
    const userContext = await browser.newContext();
    try {
      const login = await userContext.request.post('http://localhost:33101/auth/login', { data: { email: fixture.userEmail, password: fixture.password } });
      assert.equal(login.status(), 201);
      const limited = await userContext.request.get(`${api}?actorId=${fixture.actorId}`);
      assert.equal(limited.status(), 200);
      assert.ok(!(await limited.json()).some(item => item.id === redBody.id));
      const forbiddenCreate = await userContext.request.post(api, { data: create(`qa-user-${key}`, '2026-11-09T11:00:00Z', '2026-11-09T11:00:00Z') });
      assert.equal(forbiddenCreate.status(), 403);
    } finally { await userContext.close(); }
    const otherContext = await browser.newContext();
    try {
      const login = await otherContext.request.post('http://localhost:33101/auth/login', { data: { email: fixture.otherEmail, password: fixture.password } });
      assert.equal(login.status(), 201);
      const foreign = await otherContext.request.get(`${api}?actorId=${fixture.actorId}`);
      assert.equal(foreign.status(), 404);
      const foreignCreate = await otherContext.request.post(api, { data: create(`qa-foreign-${key}`, '2026-11-09T11:00:00Z', '2026-11-09T11:00:00Z') });
      assert.equal(foreignCreate.status(), 404);
    } finally { await otherContext.close(); }
    process.stdout.write(`${JSON.stringify({ verdict: 'PASS', authenticated: true, observationCreated: true, analystConfirmed: true, rejected: true, overlappingIntervals: true, chronological: true, redRestricted: true, crossTenantDenied: true, screenshots: 2 })}\n`);
  } finally { await browser.close(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : 'Browser QA failed'}\n`); process.exitCode = 1; });
