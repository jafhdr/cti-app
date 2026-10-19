import { expect, test, type Page } from '@playwright/test';
const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3000';
const cve = { id: 'v-a', cveId: 'CVE-2026-1234', name: 'Portal issue', severity: 'HIGH', cvssScore: 8.1, description: 'Login exposure' };
const finding = { id: 'f-a', applicationId: 'a-a', title: 'Portal vulnerability', description: null, severity: 'HIGH', status: 'OPEN', source: 'MANUAL', category: null, cweId: 'CWE-79', location: null, remediationNote: null, dueDate: null, resolution: null, resolvedAt: null, firstSeenAt: '2026-10-01', lastSeenAt: '2026-10-01', createdAt: '2026-10-01', updatedAt: '2026-10-01', application: { id: 'a-a', name: 'Portal A' } };
type Role = 'ADMIN' | 'USER' | 'SUPER_ADMIN';
async function fixture(page: Page, role: Role, grants: readonly string[]) {
  let linked: typeof cve | null = null; let caseRecord: { id: string; caseNumber: string; status: string } | null = null;
  await page.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.origin === new URL(app).origin) { await route.continue(); return; }
    const send = (body: unknown, status = 200) => route.fulfill({ status, body: body === null ? '' : JSON.stringify(body), contentType: 'application/json', headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } });
    if (url.pathname === '/auth/me') { await send({ id: 'actor', email: 'qa@example.test', role, moduleAccess: [{ moduleId: 'appsec', moduleSlug: 'appsec-posture', moduleName: 'AppSec Posture', accessible: true, featureKeys: ['finding-management'] }, ...grants.map(slug => ({ moduleId: slug, moduleSlug: slug, moduleName: slug === 'threat-intelligence' ? 'Threat Intelligence' : slug === 'case-management' ? 'Case Management' : 'Attack Surface Management', accessible: true, featureKeys: [slug === 'threat-intelligence' ? 'intelligence-hub' : slug === 'case-management' ? 'case-workflow' : 'asset-management'] }))] }); return; }
    if (url.pathname === '/users/tenants') { await send([{ id: 'tenant-a', name: 'Tenant A' }, { id: 'tenant-b', name: 'Tenant B' }]); return; }
    if (url.pathname === '/modules/configuration') { await send(url.searchParams.get('tenantId') === 'tenant-a' ? grants.map(slug => ({ slug, subscriptionActive: true, subscriptionIncluded: true, isActive: true, tenantEnabled: true, features: [{ key: slug === 'threat-intelligence' ? 'intelligence-hub' : slug === 'case-management' ? 'case-workflow' : 'asset-management' }] })) : []); return; }
    if (!url.pathname.startsWith('/appsec/findings/f-a') || (role === 'SUPER_ADMIN' && url.searchParams.get('tenantId') !== 'tenant-a')) { await send({ message: 'Not found' }, 404); return; }
    const suffix = url.pathname.slice('/appsec/findings/f-a'.length);
    if (suffix === '/vulnerabilities/available') { await send({ items: [cve], total: 1, page: 1, limit: 25 }); return; }
    if (suffix === '/vulnerability') { if (req.method() === 'POST') linked = cve; if (req.method() === 'DELETE') linked = null; await send(linked); return; }
    if (suffix === '/exposure') { await send([{ id: 'asset-a', name: 'Portal domain', value: 'portal.example.test', type: 'DOMAIN', status: 'ACTIVE', criticality: 'HIGH' }]); return; }
    if (suffix === '/case') { if (req.method() === 'POST') caseRecord = { id: 'case-a', caseNumber: 'CASE-2026-00001', status: 'OPEN' }; await send(caseRecord); return; }
    await send(finding);
  });
}
test('ADMIN links CVE, reads exposure, creates Case and unlinks', async ({ page }) => {
  await fixture(page, 'ADMIN', ['threat-intelligence', 'attack-surface-management', 'case-management']); await page.goto(`${app}/appsec/findings/f-a`);
  await expect(page.getByText('portal.example.test')).toBeVisible();
  await page.getByLabel('Search CVE').fill('CVE-2026'); await page.getByRole('button', { name: 'Search CVE' }).click();
  await page.getByLabel('Vulnerability').selectOption('v-a'); await page.getByRole('button', { name: 'Link vulnerability' }).click();
  await expect(page.getByText('CVE-2026-1234')).toBeVisible();
  await page.getByRole('button', { name: 'Unlink vulnerability' }).click(); await expect(page.getByText('No linked vulnerability.')).toBeVisible();
  await page.getByRole('button', { name: 'Create Case' }).click(); await expect(page.getByRole('link', { name: /Open Case: CASE-2026-00001/ })).toBeVisible();
});
test('missing modules leave Finding usable without context', async ({ page }) => {
  await fixture(page, 'ADMIN', []); await page.goto(`${app}/appsec/findings/f-a`);
  await expect(page.getByRole('heading', { name: 'Portal vulnerability' })).toBeVisible();
  await expect(page.getByText('portal.example.test')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Case' })).toHaveCount(0);
  await page.screenshot({ path: '../.omo/evidence/appsec8/admin-no-modules.png', fullPage: true });
});
test('USER has read only integration actions', async ({ page }) => {
  await fixture(page, 'USER', ['threat-intelligence', 'case-management']); await page.goto(`${app}/appsec/findings/f-a`);
  await expect(page.getByRole('heading', { name: 'Portal vulnerability' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link vulnerability' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Case' })).toHaveCount(0);
});
test('SUPER_ADMIN tenant switch clears old integration context', async ({ page }) => {
  await fixture(page, 'SUPER_ADMIN', ['threat-intelligence', 'attack-surface-management', 'case-management']);
  await page.goto(`${app}/appsec/findings/f-a`); await page.getByLabel('Tenant AppSec').selectOption('tenant-a');
  await expect(page.getByText('portal.example.test')).toBeVisible();
  await page.getByLabel('Tenant AppSec').selectOption('tenant-b');
  await expect(page.getByText('Finding tidak ditemukan dalam tenant ini.')).toBeVisible();
  await expect(page.getByText('portal.example.test')).toHaveCount(0);
});
test('SUPER_ADMIN hides ASM TI and Case context without tenant entitlements', async ({ page }) => {
  await fixture(page, 'SUPER_ADMIN', ['threat-intelligence', 'attack-surface-management', 'case-management']);
  await page.route('**/appsec/findings/f-a*', route => route.request().url().startsWith(app)
    ? route.continue()
    : route.fulfill({ status: 200, json: finding, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } }));
  await page.goto(`${app}/appsec/findings/f-a`);
  await page.getByLabel('Tenant AppSec').selectOption('tenant-b');
  await expect(page.getByRole('heading', { name: 'Portal vulnerability' })).toBeVisible();
  await expect(page.getByText('portal.example.test')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search CVE' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Case' })).toHaveCount(0);
  await expect(page.getByText('CASE MANAGEMENT')).toHaveCount(0);
  await expect(page.getByText('THREAT INTELLIGENCE')).toHaveCount(0);
  await expect(page.getByText('ATTACK SURFACE MANAGEMENT')).toHaveCount(0);
  await page.screenshot({ path: '../.omo/evidence/appsec8/superadmin-no-entitlement.png', fullPage: true });
});
test('visual QA captures integration states across responsive widths', async ({ page }) => {
  await fixture(page, 'ADMIN', ['threat-intelligence', 'attack-surface-management', 'case-management']);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`${app}/appsec/findings/f-a`);
    await expect(page.getByText('portal.example.test')).toBeVisible();
    await page.screenshot({ path: `../.omo/evidence/appsec5/detail-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
});
test('Case action waits for successful context load and hides on failure', async ({ page }) => {
  await fixture(page, 'ADMIN', ['case-management']);
  await page.route('**/appsec/findings/f-a/case*', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ status: 503, json: { message: 'Case unavailable' }, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } });
  });
  await page.goto(`${app}/appsec/findings/f-a`);
  await expect(page.getByText('Loading investigation case...')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Case' })).toHaveCount(0);
  await expect(page.getByText('Investigation case unavailable.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Case' })).toHaveCount(0);
});
