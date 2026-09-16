import { expect, test, type Page } from '@playwright/test';

const app = process.env.SOURCES_APP_URL || 'http://localhost:3000';
const indicator = { id: 'indicator-1', value: 'example.com', type: 'DOMAIN', severity: 'HIGH', confidence: 90, status: 'ACTIVE', tags: ['phishing'], source: 'analyst', description: 'Suspicious domain', expiresAt: null, tenant: { id: 'tenant-a', name: 'Tenant A' }, intelligenceEntity: null };
const candidate = { threatActorId: 'actor-1', name: 'Cozy Bear', score: 85, confidence: 'HIGH', evidence: [{ type: 'INTELLIGENCE_REPORT', value: 'report-1' }, { type: 'EXACT_INDICATOR', value: 'example.com' }] } as const;
const actor = { id: 'actor-1', aliases: ['APT 29'], motivation: 'Espionage', targetSectors: ['Government'], country: 'Russia', region: 'Europe', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z', entity: { id: 'entity-1', name: 'Cozy Bear', description: 'State-linked intrusion set', externalId: 'TA-001', confidence: 92, severity: 'CRITICAL', metadata: null, _count: { outgoingRelationships: 0, incomingRelationships: 0, indicators: 1 }, outgoingRelationships: [], incomingRelationships: [], indicators: [{ id: 'ioc-1', name: 'example.com', type: 'DOMAIN', severity: 'HIGH' }] } } as const;

async function indicatorSession(page: Page): Promise<void> {
  await page.route(/\/auth\/me$/, route => route.fulfill({ json: { id: 'admin', name: 'QA Admin', email: 'admin@example.test', role: 'ADMIN', tenantId: 'tenant-a', moduleAccess: [{ moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, featureKeys: [] }] } }));
  await page.route(/\/intelligence\/overview(?:\?.*)?$/, route => route.fulfill({ json: { entities: [] } }));
  await page.route(/\/indicators\?.+$/, route => route.fulfill({ json: { items: [indicator], total: 1, page: 1, limit: 100 } }));
  await page.route(/\/indicators\/indicator-1\/enrichments$/, route => route.fulfill({ json: [] }));
}

async function openIndicatorDetail(page: Page): Promise<void> {
  await page.goto(`${app}/indicators`);
  await page.getByRole('button', { name: 'Detail' }).click();
}

test('discovery button is available in indicator detail', async ({ page }) => {
  await indicatorSession(page);
  await openIndicatorDetail(page);
  await expect(page.getByRole('button', { name: 'Discover Threat Actors' })).toBeVisible();
});

test('successful discovery displays candidate details and opens the existing threat actor detail', async ({ page }) => {
  await indicatorSession(page);
  await page.route(/\/indicators\/indicator-1\/discover-threat-actors$/, route => route.fulfill({ json: { status: 'CANDIDATES', indicatorId: indicator.id, candidates: [candidate], overflow: false } }));
  await page.route('http://localhost:3001/intelligence/threat-actors?*', route => route.fulfill({ json: { items: [actor], total: 1, totalPages: 1 } }));
  await page.route('http://localhost:3001/intelligence/threat-actors/actor-1', route => route.fulfill({ json: actor }));
  await openIndicatorDetail(page);

  await page.getByRole('button', { name: 'Discover Threat Actors' }).click();

  const result = page.getByRole('article');
  await expect(result).toContainText('Cozy Bear');
  await expect(result).toContainText('85');
  await expect(result).toContainText('HIGH confidence');
  await expect(result).toContainText('INTELLIGENCE_REPORT');
  await expect(result).toContainText('report-1');
  for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'tablet', width: 768, height: 900 }, { name: 'mobile', width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `../.omo/evidence/indicator-threat-actor-discovery/${viewport.name}.png`, fullPage: true });
  }
  await page.getByRole('link', { name: 'View Threat Actor' }).click();
  await expect(page).toHaveURL(/\/intelligence\/threat-actors\?actorId=actor-1$/);
  await expect(page.getByRole('region', { name: 'Cozy Bear' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/indicator-threat-actor-discovery/actor-detail.png', fullPage: true });
});

test('candidate can be confirmed and attributed with its explicit id', async ({ page }) => {
  await indicatorSession(page);
  await page.route(/\/indicators\/indicator-1\/discover-threat-actors$/, route => route.fulfill({ json: { status: 'CANDIDATES', indicatorId: indicator.id, candidates: [candidate], overflow: false } }));
  await page.route(/\/indicators\/indicator-1\/confirm-threat-actor$/, route => route.fulfill({ json: { status: 'CONFIRMED', indicatorId: indicator.id, candidate: { id: candidate.threatActorId, name: candidate.name }, confidence: candidate.score, matchedEvidence: candidate.evidence } }));
  const attributionBodies: unknown[] = [];
  await page.route(/\/indicators\/indicator-1\/attribute-threat-actor$/, route => {
    attributionBodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { status: 'MATCH', indicatorId: indicator.id, candidate: { id: candidate.threatActorId, name: candidate.name }, confidence: candidate.score, matchedEvidence: [], created: true } });
  });
  await openIndicatorDetail(page);
  await page.getByRole('button', { name: 'Discover Threat Actors' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Attribute', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('Indicator sudah terhubung ke Threat Actor Cozy Bear.');
  expect(attributionBodies).toEqual([{ threatActorId: candidate.threatActorId }]);
});

test('indicator detail has no direct attribution control outside candidate confirmation', async ({ page }) => {
  await indicatorSession(page);
  await openIndicatorDetail(page);

  await expect(page.getByRole('button', { name: 'Run attribution' })).toHaveCount(0);
});

test('cancelling confirmation does not attribute the candidate', async ({ page }) => {
  await indicatorSession(page);
  await page.route(/\/indicators\/indicator-1\/discover-threat-actors$/, route => route.fulfill({ json: { status: 'CANDIDATES', indicatorId: indicator.id, candidates: [candidate], overflow: false } }));
  await page.route(/\/indicators\/indicator-1\/confirm-threat-actor$/, route => route.fulfill({ json: { status: 'CONFIRMED', indicatorId: indicator.id, candidate: { id: candidate.threatActorId, name: candidate.name }, confidence: candidate.score, matchedEvidence: candidate.evidence } }));
  let attributionRequests = 0;
  await page.route(/\/indicators\/indicator-1\/attribute-threat-actor$/, route => {
    attributionRequests += 1;
    return route.fulfill({ json: { status: 'matched' } });
  });
  await openIndicatorDetail(page);
  await page.getByRole('button', { name: 'Discover Threat Actors' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();

  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Attribute', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Attribute', exact: true })).toBeVisible();
  expect(attributionRequests).toBe(0);
});

test('attribution error is shown clearly', async ({ page }) => {
  await indicatorSession(page);
  await page.route(/\/indicators\/indicator-1\/discover-threat-actors$/, route => route.fulfill({ json: { status: 'CANDIDATES', indicatorId: indicator.id, candidates: [candidate], overflow: false } }));
  await page.route(/\/indicators\/indicator-1\/confirm-threat-actor$/, route => route.fulfill({ json: { status: 'CONFIRMED', indicatorId: indicator.id, candidate: { id: candidate.threatActorId, name: candidate.name }, confidence: candidate.score, matchedEvidence: candidate.evidence } }));
  await page.route(/\/indicators\/indicator-1\/attribute-threat-actor$/, route => route.fulfill({ status: 409, json: { message: 'Candidate attribution is no longer valid' } }));
  await openIndicatorDetail(page);
  await page.getByRole('button', { name: 'Discover Threat Actors' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Attribute', exact: true }).click();

  await expect(page.getByText('Candidate attribution is no longer valid', { exact: true })).toBeVisible();
});

test('discovery displays no-match state', async ({ page }) => {
  await indicatorSession(page);
  await page.route(/\/indicators\/indicator-1\/discover-threat-actors$/, route => route.fulfill({ json: { status: 'NO_MATCH', indicatorId: indicator.id, candidates: [], overflow: false } }));
  await openIndicatorDetail(page);
  await page.getByRole('button', { name: 'Discover Threat Actors' }).click();
  await expect(page.getByText('No Match', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm & Attribute' })).toHaveCount(0);
  await page.screenshot({ path: '../.omo/evidence/indicator-threat-actor-discovery/no-match.png', fullPage: true });
});

test('discovery reports overflow when more candidates exist', async ({ page }) => {
  await indicatorSession(page);
  await page.route(/\/indicators\/indicator-1\/discover-threat-actors$/, route => route.fulfill({ json: { status: 'CANDIDATES', indicatorId: indicator.id, candidates: [candidate], overflow: true } }));
  await openIndicatorDetail(page);
  await page.getByRole('button', { name: 'Discover Threat Actors' }).click();
  await expect(page.getByRole('note')).toContainText('More candidates are available but are not displayed.');
  await expect(page.getByRole('button', { name: 'Confirm & Attribute' })).toHaveCount(0);
  await page.screenshot({ path: '../.omo/evidence/indicator-threat-actor-discovery/overflow.png', fullPage: true });
});

test('discovery exposes loading and API error states', async ({ page }) => {
  await indicatorSession(page);
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
  await page.route(/\/indicators\/indicator-1\/discover-threat-actors$/, async route => {
    await responseGate;
    await route.fulfill({ status: 503, json: { message: 'Discovery temporarily unavailable' } });
  });
  await openIndicatorDetail(page);

  const request = page.getByRole('button', { name: 'Discover Threat Actors' }).click();
  await expect(page.getByRole('button', { name: 'Discovering...' })).toBeDisabled();
  await expect(page.getByText('Searching existing threat actors...')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/indicator-threat-actor-discovery/loading.png', fullPage: true });
  releaseResponse?.();
  await request;
  await expect(page.getByText('Discovery temporarily unavailable', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/indicator-threat-actor-discovery/error.png', fullPage: true });
});
