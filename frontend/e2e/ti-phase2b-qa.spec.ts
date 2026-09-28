import { expect, test, type Page } from '@playwright/test';
const evidence = '../.omo/evidence/threat-intelligence/phase2b';
const item = { id: 'one', name: 'Community Observatory', title: 'Quarterly Assessment', externalId: 'T1059', summary: 'Observed activity', content: 'Verified observations', sourceType: 'COMMUNITY', provider: 'Community', description: 'Verified', url: null, reliability: 'B', confidence: 80, tlp: 'AMBER', status: 'ACTIVE', reportType: 'STRATEGIC', tactic: 'Execution', platform: 'Windows', lastSyncAt: null, publishedAt: null, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', threatActors: [], campaigns: [], indicators: [], malwareTools: [], vulnerabilities: [], sources: [], _count: { campaigns: 0 } };
async function setup(page: Page) {
 await page.route('**/auth/me', route => route.fulfill({ json: { id: 'admin', email: 'admin@example.test', role: 'ADMIN', tenantId: 'tenant-a', moduleAccess: [{ moduleSlug: 'threat-intelligence', assigned: true, accessible: true, featureKeys: [] }] } }));
 await page.route('http://localhost:3001/intelligence/sources**', route => route.fulfill({ json: { items: [item], total: 1, totalPages: 1 } }));
 await page.route('http://localhost:3001/intelligence/reports**', route => route.fulfill({ json: route.request().url().endsWith('/relations') ? { threatActors: [], campaigns: [], indicators: [], malwareTools: [], vulnerabilities: [], sources: [] } : route.request().url().endsWith('/one') ? { ...item, status: 'PUBLISHED' } : { items: [{ ...item, status: 'PUBLISHED' }], total: 1, totalPages: 1 } }));
 await page.route('http://localhost:3001/intelligence/mitre-techniques**', route => route.fulfill({ json: route.request().url().endsWith('/one') ? { ...item, name: 'Command and Scripting Interpreter' } : { items: [{ ...item, name: 'Command and Scripting Interpreter' }], total: 1, totalPages: 1 } }));
 await page.route('**/indicators/feed-status**', route => route.fulfill({ json: { tenantId: 'tenant-a', scheduler: { enabled: true, intervalMinutes: 60, nextSyncAt: null }, providers: [{ provider: 'URLHAUS', name: 'URLhaus', status: 'ACTIVE', lastSyncAt: null, received: 12, created: 10, updated: 2, error: null }] } }));
 await page.route('**/audit-logs**', route => route.fulfill({ json: { items: [], total: 0 } }));
}
for (const target of [
 { slug: 'sources', path: '/intelligence/sources', label: 'Community Observatory' },
 { slug: 'feeds', path: '/threat-intelligence/feeds', label: 'URLhaus' },
 { slug: 'reports', path: '/threat-intelligence/reports', label: 'Quarterly Assessment' },
 { slug: 'mitre', path: '/threat-intelligence/mitre-attack', label: 'T1059' },
]) test(`${target.slug} responsive and theme`, async ({ page }) => {
 await setup(page);
 for (const state of [{ theme: 'dark', width: 1440, suffix: 'dark-1440' }, { theme: 'light', width: 1440, suffix: 'light-1440' }, { theme: 'dark', width: 768, suffix: 'tablet-768' }, { theme: 'dark', width: 375, suffix: 'mobile-375' }]) {
  await page.setViewportSize({ width: state.width, height: 900 });
  await page.addInitScript(theme => localStorage.setItem('cti-theme', theme), state.theme);
  await page.goto(`http://localhost:3000${target.path}`);
  await expect(page.getByText(target.label, { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/${target.slug}-${state.suffix}.png`, fullPage: true });
 }
});

test('system preference follows dark and light OS settings', async ({ page }) => {
 await setup(page);
 await page.addInitScript(() => localStorage.setItem('cti-theme', 'system'));
 for (const scheme of ['dark', 'light'] as const) {
  await page.emulateMedia({ colorScheme: scheme });
  for (const path of ['/intelligence/sources', '/threat-intelligence/feeds', '/threat-intelligence/reports', '/threat-intelligence/mitre-attack']) {
   await page.goto(`http://localhost:3000${path}`);
   await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
  }
 }
});

test('source, report and technique details stay usable', async ({ page }) => {
 await setup(page);
 await page.goto('http://localhost:3000/intelligence/sources');
 await page.getByRole('button', { name: 'Community Observatory' }).click();
 await expect(page.getByRole('region', { name: 'Community Observatory' })).toBeVisible();
 await page.goto('http://localhost:3000/threat-intelligence/reports');
 await page.getByRole('button', { name: 'Quarterly Assessment' }).click();
 await expect(page.getByText('Verified observations')).toBeVisible();
 await page.goto('http://localhost:3000/threat-intelligence/mitre-attack');
 await page.getByRole('button', { name: 'Execution' }).click();
 await expect(page.getByLabel('Search MITRE techniques')).toHaveValue('Execution');
 await page.getByRole('button', { name: 'T1059' }).click();
 await expect(page.getByRole('region', { name: 'Command and Scripting Interpreter' })).toBeVisible();
});

test('feed sync reports the returned result', async ({ page }) => {
 await setup(page);
 let calls = 0;
 await page.route('**/indicators/feed-sync', route => { calls += 1; return route.fulfill({ json: { results: [{ provider: 'URLHAUS', status: 'SYNCED', created: 3, updated: 2, skipped: 0, received: 5 }], totals: { created: 3, updated: 2, skipped: 0, received: 5 } } }); });
 await page.goto('http://localhost:3000/threat-intelligence/feeds');
 await page.getByRole('button', { name: 'Sync Now' }).click();
 await expect(page.getByText(/Sync selesai.*3 dibuat, 2 diperbarui/)).toBeVisible();
 expect(calls).toBe(1);
});

test('source creation sends only the configured form fields', async ({ page }) => {
 await setup(page);
 let created = false;
 await page.route('http://localhost:3001/intelligence/sources', async route => {
  if (route.request().method() !== 'POST') return route.continue();
  const body: unknown = route.request().postDataJSON();
  expect(body).toMatchObject({ name: 'New Observatory', provider: 'Community' });
  created = true;
  await route.fulfill({ json: item });
 });
 await page.goto('http://localhost:3000/intelligence/sources');
 await page.getByRole('button', { name: '+ Add source' }).click();
 const panel = page.getByRole('region', { name: 'Add source' });
 await panel.getByLabel('Name').fill('New Observatory');
 await panel.getByLabel('Provider').fill('Community');
 await panel.getByRole('button', { name: 'Save source' }).click();
 await expect(page.getByText('Source berhasil dibuat.')).toBeVisible();
 expect(created).toBe(true);
});

test('report creation submits editorial content', async ({ page }) => {
 await setup(page);
 let submitted = false;
 await page.route('http://localhost:3001/intelligence/reports', async route => {
  if (route.request().method() !== 'POST') return route.continue();
  expect(route.request().postDataJSON()).toMatchObject({ title: 'New Assessment', summary: 'Executive findings', content: 'Verified evidence' });
  submitted = true;
  await route.fulfill({ json: item });
 });
 await page.goto('http://localhost:3000/threat-intelligence/reports');
 await page.getByRole('button', { name: '+ Add report' }).click();
 const form = page.getByRole('region', { name: 'Report form' });
 await form.getByLabel('Title').fill('New Assessment');
 await form.getByLabel('Summary').fill('Executive findings');
 await form.getByLabel('Content').fill('Verified evidence');
 await form.getByRole('button', { name: 'Save report' }).click();
 await expect(page.getByText('Report berhasil disimpan.')).toBeVisible();
 expect(submitted).toBe(true);
});

test('MITRE technique creation submits the entered tactic', async ({ page }) => {
 await setup(page);
 let submitted = false;
 await page.route('http://localhost:3001/intelligence/mitre-techniques', async route => {
  if (route.request().method() !== 'POST') return route.continue();
  expect(route.request().postDataJSON()).toMatchObject({ externalId: 'T1566', name: 'Phishing', tactic: 'Initial Access', platform: 'Windows' });
  submitted = true;
  await route.fulfill({ json: item });
 });
 await page.goto('http://localhost:3000/threat-intelligence/mitre-attack');
 await page.getByRole('button', { name: '+ Add technique' }).click();
 const form = page.getByRole('region', { name: 'Create technique' });
 await form.getByLabel('External ID').fill('T1566');
 await form.getByLabel('Name').fill('Phishing');
 await form.getByLabel('Tactic').fill('Initial Access');
 await form.getByLabel('Platform').fill('Windows');
 await form.getByRole('button', { name: 'Save technique' }).click();
 await expect(page.getByText('MITRE technique berhasil dibuat.')).toBeVisible();
 expect(submitted).toBe(true);
});
