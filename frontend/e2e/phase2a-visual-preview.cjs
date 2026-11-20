const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');

const output = '../.omo/evidence/sicti-phase2a-preview';
const actor = { id: 'actor-preview', aliases: ['Blue Finch'], motivation: 'Credential access', targetSectors: ['Finance'], country: null, region: null, status: 'ACTIVE', createdAt: '2026-11-09T00:00:00Z', updatedAt: '2026-11-09T00:00:00Z', entity: { id: 'entity-preview', name: 'Blue Finch', description: 'Synthetic visual QA actor.', externalId: 'intrusion-set--preview', confidence: 72, severity: 'HIGH', metadata: null, indicators: [], outgoingRelationships: [], incomingRelationships: [], _count: { outgoingRelationships: 0, incomingRelationships: 0, indicators: 0 } }, malwareTools: [] };
const observations = [
  { id: 'observation-one', observedStartAt: '2026-11-08T08:00:00Z', observedEndAt: '2026-11-08T09:00:00Z', timePrecision: 'HOUR', status: 'CONFIRMED', ordering: 'FIRST', tlp: 'AMBER', attackVersion: 'Enterprise QA', attributionBasis: 'Analyst corroborated source report and technique mapping.', evidenceSnapshot: 'SIR-QA · Synthetic evidence · Reviewed report', sourceReliability: 'B', evidenceCredibility: '2', actorConfidence: 72, techniqueConfidence: 84, mitreTechnique: { externalId: 'T-QA-1', name: 'Synthetic discovery', tactic: 'Discovery' }, reviews: [{ id: 'review-one', status: 'CONFIRMED', reason: 'Two analysts checked the mapped behavior.', createdAt: '2026-11-09T08:00:00Z', reviewer: { name: 'QA Analyst' } }] },
  { id: 'observation-two', observedStartAt: '2026-11-08T08:30:00Z', observedEndAt: '2026-11-08T10:00:00Z', timePrecision: 'INTERVAL', status: 'DISPUTED', ordering: 'OVERLAPS', tlp: 'AMBER', attackVersion: 'Enterprise QA', attributionBasis: 'Source timing conflicts with the earlier campaign report.', evidenceSnapshot: 'SIR-QA · Synthetic evidence · Conflicting report', sourceReliability: null, evidenceCredibility: null, actorConfidence: 40, techniqueConfidence: 55, mitreTechnique: { externalId: 'T-QA-2', name: 'Synthetic collection', tactic: 'Collection' }, reviews: [{ id: 'review-two', status: 'DISPUTED', reason: 'Observation time has a conflicting source.', createdAt: '2026-11-09T09:00:00Z', reviewer: { name: 'QA Analyst' } }] },
];

async function main() {
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  await page.route('http://localhost:3001/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/auth/me' ? { role: 'ADMIN', email: 'visual-qa@example.test', moduleAccess: [{ moduleSlug: 'threat-intelligence', accessible: true, featureKeys: ['intelligence-hub'] }] }
      : path === '/intelligence/threat-actors' ? { items: [actor], total: 1, totalPages: 1 }
      : path === '/intelligence/threat-actors/actor-preview' ? actor
      : path === '/intelligence/ttp-observations' ? observations
      : path === '/intelligence/ttp-observations/evidence-options' ? [{ id: 'evidence-preview', label: 'SIR-QA · Synthetic evidence', relevanceNote: 'QA only' }]
      : path === '/intelligence/campaigns/relations' ? { threatActors: [], indicators: [], mitreTechniques: [{ id: 'technique-preview', externalId: 'T-QA-1', name: 'Synthetic discovery', tactic: 'Discovery' }] }
      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': 'http://localhost:33010', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  });
  try {
    await page.goto('http://localhost:33010/intelligence/threat-actors?actorId=actor-preview');
    await page.getByRole('heading', { name: 'ATT&CK observation timeline' }).waitFor();
    await page.getByText('Ordering uncertain: interval overlaps prior record').waitFor();
    await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
    await page.getByRole('button', { name: 'Add observation' }).click();
    await page.screenshot({ path: `${output}/desktop-form.png`, fullPage: true });
    await page.screenshot({ path: `${output}/desktop-form-viewport.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${output}/mobile-form.png`, fullPage: true });
    process.stdout.write(JSON.stringify({ verdict: 'VISUAL_PREVIEW_ONLY', mockApi: true, screenshots: 4 }));
  } finally { await browser.close(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : 'Preview failed'}\n`); process.exitCode = 1; });
