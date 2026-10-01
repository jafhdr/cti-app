import { test, expect, type Page } from '@playwright/test';

const app = process.env.SOURCES_APP_URL || 'http://localhost:3000';
const evidence = '../.omo/evidence/threat-intelligence/phase2a';
const actor = { id: 'actor-1', aliases: ['APT 29'], motivation: 'Espionage', targetSectors: ['Government'], country: 'Russia', region: 'Eastern Europe', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z', entity: { id: 'entity-1', name: 'Cozy Bear', description: 'Observed intrusion activity.', externalId: 'TA-001', confidence: 92, severity: 'CRITICAL', metadata: null, indicators: [{ id: "ioc-1", name: "evil.example", type: "DOMAIN", severity: "HIGH" }], outgoingRelationships: [{ id: "relation-1", relationshipType: "OPERATES", target: { id: "campaign-1", name: "Operation Phantom", type: "CAMPAIGN", severity: "HIGH" } }], incomingRelationships: [], _count: { indicators: 1, outgoingRelationships: 1, incomingRelationships: 0 } } };
const campaign = { id: 'campaign-1', name: 'Operation Phantom', description: 'Credential theft campaign.', objective: 'Collect credentials', status: 'ACTIVE', severity: 'HIGH', confidence: 88, startDate: '2026-08-01T00:00:00Z', endDate: null, externalId: 'CAM-001', referenceUrl: null, threatActorId: actor.id, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z', threatActor: { id: actor.id, entity: { name: actor.entity.name } }, indicators: [{ indicator: { id: "ioc-1", value: "evil.example", type: "DOMAIN", severity: "HIGH", status: "ACTIVE" } }], mitreTechniques: [], _count: { indicators: 1, mitreTechniques: 0 } };
async function setup(page: Page) {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'admin', email: 'admin@example.test', role: 'ADMIN', tenantId: 'tenant-a', moduleAccess: [{ moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, accessible: true, featureKeys: [] }] } }));
  await page.route('http://localhost:3001/intelligence/threat-actors**', route => route.fulfill({ json: route.request().url().includes('actor-1') ? actor : { items: [actor], total: 1, totalPages: 1 } }));
  await page.route('http://localhost:3001/intelligence/campaigns**', route => route.fulfill({ json: route.request().url().includes('campaign-1') ? campaign : { items: [campaign], total: 1, totalPages: 1 } }));
  await page.route('http://localhost:3001/intelligence/campaigns/relations**', route => route.fulfill({ json: { threatActors: [campaign.threatActor], indicators: campaign.indicators.map(link => link.indicator), mitreTechniques: [] } }));
}
for (const surface of [
  { key: 'actors', url: '/intelligence/threat-actors', item: 'Cozy Bear' },
  { key: 'campaigns', url: '/threat-intelligence/campaigns', item: 'Operation Phantom' },
] as const) {
  test(`${surface.key} theme and responsive evidence`, async ({ page }) => {
    test.setTimeout(90000);
    await setup(page);
    for (const theme of ['dark', 'light'] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${app}${surface.url}`);
      await expect(page.getByRole('button', { name: surface.item })).toBeVisible();
      await page.getByRole('button', { name: theme === 'dark' ? 'Gelap' : 'Terang' }).click();
      await expect(page.locator('html')).toHaveClass(new RegExp(theme));
      await page.screenshot({ path: `${evidence}/${surface.key}-${theme}-1440.png`, fullPage: true });
      await page.getByRole('button', { name: surface.item }).click();
      await expect(page.getByRole('region', { name: surface.item })).toContainText(surface.item);
      await page.screenshot({ path: `${evidence}/${surface.key === 'actors' ? 'actor' : 'campaign'}-detail-${theme}-1440.png`, fullPage: true });
      {
        await page.setViewportSize({ width: 768, height: 900 });
        await page.screenshot({ path: `${evidence}/${surface.key === 'actors' ? 'actor' : 'campaign'}-detail-${theme}-768.png`, fullPage: true });
        await page.setViewportSize({ width: 375, height: 812 });
        await page.screenshot({ path: `${evidence}/${surface.key === 'actors' ? 'actor' : 'campaign'}-detail-${theme === 'dark' ? 'mobile' : 'light-mobile'}-375.png`, fullPage: true });
        await page.getByRole('button', { name: 'Close' }).click();
        await expect(page.getByRole('button', { name: surface.item })).toBeVisible();
        await page.setViewportSize({ width: 768, height: 900 });
        await page.screenshot({ path: `${evidence}/${surface.key}-${theme}-768.png`, fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
        await page.setViewportSize({ width: 375, height: 812 });
        await page.screenshot({ path: `${evidence}/${surface.key}-${theme === 'dark' ? 'mobile' : 'light-mobile'}-375.png`, fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByRole('button', { name: 'Sistem' }).click();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: `${evidence}/${surface.key}-system-dark-375.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveClass(/light/);
    await page.screenshot({ path: `${evidence}/${surface.key}-system-light-375.png`, fullPage: true });
  });
}

test('related actor and campaign navigation uses real relationship IDs', async ({ page }) => {
  await setup(page);
  await page.goto(`${app}/intelligence/threat-actors`);
  await page.getByRole('button', { name: actor.entity.name }).click();
  await page.getByRole('link', { name: campaign.name }).click();
  await expect(page).toHaveURL(/campaignId=campaign-1/);
  await expect(page.getByRole('region', { name: campaign.name })).toBeVisible();
  await page.getByRole('region', { name: campaign.name }).getByRole('link', { name: actor.entity.name }).click();
  await expect(page).toHaveURL(/actorId=actor-1/);
  await expect(page.getByRole('region', { name: actor.entity.name })).toBeVisible();
});

test('actor and campaign search and filters reach existing API', async ({ page }) => {
  await setup(page);
  const urls: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/intelligence/threat-actors?') || request.url().includes('/intelligence/campaigns?')) urls.push(request.url());
  });
  await page.goto(`${app}/intelligence/threat-actors`);
  await page.getByLabel('Search threat actors').fill('Cozy');
  await expect.poll(() => urls.some(url => url.includes('search=Cozy'))).toBeTruthy();
  await page.getByLabel('Filter status').selectOption('ACTIVE');
  await expect.poll(() => urls.some(url => url.includes('status=ACTIVE'))).toBeTruthy();
  await page.goto(`${app}/threat-intelligence/campaigns`);
  await page.getByLabel('Search campaigns').fill('Phantom');
  await expect.poll(() => urls.some(url => url.includes('search=Phantom'))).toBeTruthy();
  await page.getByLabel('Filter severity').selectOption('HIGH');
  await expect.poll(() => urls.some(url => url.includes('severity=HIGH'))).toBeTruthy();
});
