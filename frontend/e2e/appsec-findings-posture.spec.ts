import { expect, test, type Page } from '@playwright/test';

const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3000';
type Role = 'USER' | 'ADMIN' | 'SUPER_ADMIN';
type RecordFinding = { id: string; applicationId: string; title: string; description: string | null; severity: string; status: string; source: string; category: string | null; cweId: string | null; location: string | null; remediationNote: string | null; dueDate: string | null; resolution: string | null; resolvedAt: string | null; firstSeenAt: string; lastSeenAt: string; createdAt: string; updatedAt: string; application: { id: string; name: string } };
const now = '2026-10-01T00:00:00.000Z';
function finding(id: string, applicationId: string, applicationName: string, title: string): RecordFinding { return { id, applicationId, title, description: 'Review access control', severity: 'CRITICAL', status: 'OPEN', source: 'MANUAL', category: 'Access control', cweId: 'CWE-79', location: '/login', remediationNote: 'Review permissions', dueDate: now, resolution: null, resolvedAt: null, firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now, application: { id: applicationId, name: applicationName } }; }
async function fixture(page: Page, role: Role, features: readonly string[], initial = true): Promise<void> {
  const records: Record<string, RecordFinding[]> = { 'tenant-a': initial ? [finding('finding-a', 'app-a', 'Portal A', 'Critical login finding')] : [], 'tenant-b': [finding('finding-b', 'app-b', 'Portal B', 'Tenant B finding')] };
  const names: Record<string, { id: string; name: string }[]> = { 'tenant-a': [{ id: 'app-a', name: 'Portal A' }], 'tenant-b': [{ id: 'app-b', name: 'Portal B' }] };
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === new URL(app).origin) { await route.continue(); return; }
    const path = url.pathname; const tenant = role === 'SUPER_ADMIN' ? url.searchParams.get('tenantId') : 'tenant-a';
    const send = (body: object, status = 200) => route.fulfill({ status, json: body, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } });
    if (path === '/auth/me') { await send({ id: 'actor', email: 'qa@example.test', role, tenantId: role === 'SUPER_ADMIN' ? null : 'tenant-a', moduleAccess: [{ moduleId: 'appsec', moduleSlug: 'appsec-posture', moduleName: 'AppSec Posture', accessible: true, featureKeys: features }] }); return; }
    if (path === '/users/tenants') { await send([{ id: 'tenant-a', name: 'Tenant A' }, { id: 'tenant-b', name: 'Tenant B' }]); return; }
    if (!path.startsWith('/appsec')) { await route.continue(); return; }
    if (!tenant) { await send({ message: 'Tenant wajib' }, 400); return; }
    const list = records[tenant] ?? []; const options = names[tenant] ?? [];
    if (path === '/appsec/posture') {
      const isA = tenant === 'tenant-a'; const total = options.length; const count = list.length;
      await send({ applications: { total, active: total }, findings: { total: count, active: count, resolved: 0 }, severity: { critical: count, high: 0, medium: 0, low: 0 }, status: { open: count, inProgress: 0, resolved: 0, acceptedRisk: 0, falsePositive: 0 }, applicationsWithActiveFindings: count ? 1 : 0, topApplications: count ? [{ applicationId: options[0].id, name: options[0].name, criticality: isA ? 'HIGH' : 'MEDIUM', activeFindings: count, criticalFindings: count, highFindings: 0 }] : [] }); return;
    }
    if (path === '/appsec/findings/applications') { await send(options); return; }
    if (path === '/appsec/findings' && request.method() === 'GET') {
      const search = url.searchParams.get('search')?.toLowerCase() ?? '';
      const filtered = list.filter(item => item.title.toLowerCase().includes(search) && (!url.searchParams.get('applicationId') || item.applicationId === url.searchParams.get('applicationId')) && (!url.searchParams.get('severity') || item.severity === url.searchParams.get('severity')) && (!url.searchParams.get('status') || item.status === url.searchParams.get('status')));
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      await send({ items: filtered.slice((pageNumber - 1) * 10, pageNumber * 10), total: filtered.length, page: pageNumber, limit: 10 }); return;
    }
    if (path === '/appsec/findings' && request.method() === 'POST') {
      const body = request.postDataJSON(); const item = { ...finding(`finding-${list.length + 1}`, body.applicationId, options.find(option => option.id === body.applicationId)?.name ?? '—', body.title), ...body, source: 'MANUAL', status: 'OPEN', resolution: null, resolvedAt: null }; list.unshift(item); await send(item, 201); return;
    }
    if (path.startsWith('/appsec/findings/')) {
      const item = list.find(value => value.id === path.split('/')[3]); if (!item) { await send({ message: 'Not found' }, 404); return; }
      if (request.method() === 'PATCH') { const body = request.postDataJSON(); Object.assign(item, body, body.status === 'OPEN' ? { resolution: null, resolvedAt: null } : body.status && ['RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE'].includes(body.status) ? { resolvedAt: now } : {}); await send(item); return; }
      await send(item); return;
    }
    await send({ message: 'Not found' }, 404);
  });
}

test('Overview shows live aggregates, distributions and top Application', async ({ page }) => {
  await fixture(page, 'USER', ['posture-overview']); await page.goto(`${app}/appsec`);
  await expect(page.getByRole('heading', { name: 'Application posture' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'AppSec posture metrics' })).toContainText('Critical Findings');
  await expect(page.getByRole('heading', { name: 'Findings by Severity' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Findings by Status' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Top Applications with Active Findings' })).toBeVisible();
  await expect(page.getByText('Portal A')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Portal A' })).toHaveCount(0);
});

test('Overview shows empty Finding state without USER create CTA', async ({ page }) => {
  await fixture(page, 'USER', ['posture-overview'], false); await page.goto(`${app}/appsec`);
  await expect(page.getByText('No findings recorded')).toBeVisible();
  await expect(page.getByRole('button', { name: /create/i })).toHaveCount(0);
});

test('USER reads Finding and cannot mutate', async ({ page }) => {
  await fixture(page, 'USER', ['finding-management']); await page.goto(`${app}/appsec/findings`);
  await expect(page.getByRole('link', { name: 'Critical login finding' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create finding' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Critical login finding' }).click();
  await expect(page.getByText('Review permissions')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Portal A' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit finding' })).toHaveCount(0);
});

test('ADMIN creates edits resolves and reopens a manual Finding', async ({ page }) => {
  await fixture(page, 'ADMIN', ['finding-management', 'application-inventory']); await page.goto(`${app}/appsec/findings`);
  await page.getByRole('button', { name: 'Create finding' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Application *').selectOption('app-a');
  await dialog.getByLabel('Title *').fill('Manual exposure');
  await dialog.getByLabel('Severity *').selectOption('HIGH');
  await dialog.getByRole('button', { name: 'Create finding' }).click();
  await expect(page.getByRole('link', { name: 'Manual exposure' })).toBeVisible();
  await page.getByRole('link', { name: 'Manual exposure' }).click();
  await expect(page.getByRole('main').getByRole('link', { name: 'Portal A' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit finding' }).click();
  await dialog.getByLabel('Remediation note').fill('Rotate credentials');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Rotate credentials')).toBeVisible();
  await page.getByLabel('Change status').selectOption('RESOLVED');
  await page.getByRole('button', { name: 'Update status' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Resolution wajib' })).toBeVisible();
  await page.getByLabel('Resolution').fill('Fixed and verified');
  await page.getByRole('button', { name: 'Update status' }).click();
  await expect(page.getByText('Fixed and verified')).toBeVisible();
  await expect(page.getByLabel('Change status').locator('option')).toHaveCount(2);
  await page.getByLabel('Change status').selectOption('OPEN');
  await page.getByRole('button', { name: 'Update status' }).click();
  await expect(page.getByText('Finding reopened. Active resolution cleared.')).toBeVisible();
  await expect(page.getByText('Fixed and verified')).toHaveCount(0);
});

test('Finding filters and pagination follow API', async ({ page }) => {
  await fixture(page, 'ADMIN', ['finding-management']); await page.goto(`${app}/appsec/findings`);
  await page.getByLabel('Filter severity').selectOption('LOW');
  await expect(page.getByText('No findings found')).toBeVisible();
  await page.getByLabel('Filter severity').selectOption('CRITICAL');
  await expect(page.getByRole('link', { name: 'Critical login finding' })).toBeVisible();
  await page.getByLabel('Search findings').fill('absent');
  await expect(page.getByText('No findings found')).toBeVisible();
  await expect(page.getByText('Page 1 of 1')).toBeVisible();
});

for (const [features] of [
  [['posture-overview'], '/appsec'],
  [['application-inventory'], '/appsec/applications'],
  [['finding-management'], '/appsec/findings'],
  [['posture-overview', 'application-inventory', 'finding-management'], 'all'],
] as const) {
  test(`feature gate ${features.join('+')}`, async ({ page }) => {
    const granted: readonly string[] = features;
    await fixture(page, 'USER', granted);
    for (const [path, feature] of [['/appsec', 'posture-overview'], ['/appsec/applications', 'application-inventory'], ['/appsec/findings', 'finding-management']] as const) {
      await page.goto(`${app}${path}`);
      if (path === '/appsec' && !granted.includes('posture-overview')) {
        await expect(page).toHaveURL(`${app}${granted.includes('application-inventory') ? '/appsec/applications' : '/appsec/findings'}`);
        continue;
      }
      if (granted.includes(feature)) await expect(page.getByRole('alert').filter({ hasText: 'Akses AppSec' })).toHaveCount(0);
      else await expect(page.getByRole('alert').filter({ hasText: 'Akses AppSec' })).toBeVisible();
    }
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    if (await nav.getByRole('button', { name: 'AppSec Posture' }).getAttribute('aria-expanded') !== 'true') await nav.getByRole('button', { name: 'AppSec Posture' }).click();
    for (const [name, key] of [['Overview', 'posture-overview'], ['Applications', 'application-inventory'], ['Findings', 'finding-management']] as const) await expect(nav.getByRole('link', { name })).toHaveCount(granted.includes(key) ? 1 : 0);
  });
}

test('AppSec root denies access when no usable feature exists', async ({ page }) => {
  await fixture(page, 'USER', ['advanced-chart']); await page.goto(`${app}/appsec`);
  await expect(page.getByRole('alert').filter({ hasText: 'Akses AppSec' })).toBeVisible();
  await expect(page).toHaveURL(`${app}/appsec`);
});

test('SUPER_ADMIN tenant switch clears Overview and Finding detail', async ({ page }) => {
  await fixture(page, 'SUPER_ADMIN', ['posture-overview', 'finding-management']); await page.goto(`${app}/appsec`);
  await expect(page.getByText('Pilih tenant untuk membuka AppSec.')).toBeVisible();
  await page.getByLabel('Tenant AppSec').selectOption('tenant-a');
  await expect(page.getByText('Portal A')).toBeVisible();
  await page.goto(`${app}/appsec/findings/finding-a`);
  await expect(page.getByRole('heading', { name: 'Critical login finding' })).toBeVisible();
  await page.getByLabel('Tenant AppSec').selectOption('tenant-b');
  await expect(page.getByText('Finding tidak ditemukan dalam tenant ini.')).toBeVisible();
  await page.goto(`${app}/appsec/findings`);
  await expect(page.getByRole('link', { name: 'Tenant B finding' })).toBeVisible();
  await expect(page.getByText('Critical login finding')).toHaveCount(0);
  await page.goto(`${app}/appsec`);
  await expect(page.getByText('Portal B')).toBeVisible();
  await expect(page.getByText('Portal A')).toHaveCount(0);
});

test('visual QA captures Overview, Findings and detail at three widths', async ({ page }) => {
  await fixture(page, 'ADMIN', ['posture-overview', 'application-inventory', 'finding-management']);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${app}/appsec`);
    await expect(page.getByRole('heading', { name: 'Findings by Severity' })).toBeVisible();
    await page.screenshot({ path: `../.omo/evidence/appsec4/overview-${width}.png`, fullPage: true });
    await page.goto(`${app}/appsec/findings`);
    await expect(page.getByRole('link', { name: 'Critical login finding' })).toBeVisible();
    await page.screenshot({ path: `../.omo/evidence/appsec4/findings-${width}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Critical login finding' }).click();
    await expect(page.getByRole('heading', { name: 'Resolution and next steps' })).toBeVisible();
    await page.screenshot({ path: `../.omo/evidence/appsec4/detail-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
});

test('visual QA captures create, empty and error states', async ({ page }) => {
  await fixture(page, 'ADMIN', ['posture-overview', 'finding-management'], false);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`${app}/appsec/findings`);
  await expect(page.getByText('No findings found')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/appsec4/empty-375.png', fullPage: true });
  await page.getByRole('button', { name: 'Create finding' }).click();
  await expect(page.getByRole('dialog', { name: 'Create finding' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/appsec4/create-375.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.route('**/appsec/posture*', route => route.fulfill({ status: 500, json: { message: 'Service unavailable' }, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } }));
  await page.goto(`${app}/appsec`);
  await expect(page.getByRole('alert').filter({ hasText: 'Layanan sedang bermasalah' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/appsec4/error-375.png', fullPage: true });
});

test('Overview distinguishes a tenant without Applications', async ({ page }) => {
  await fixture(page, 'USER', ['posture-overview']);
  await page.route('**/appsec/posture*', route => route.fulfill({ json: { applications: { total: 0, active: 0 }, findings: { total: 0, active: 0, resolved: 0 }, severity: { critical: 0, high: 0, medium: 0, low: 0 }, status: { open: 0, inProgress: 0, resolved: 0, acceptedRisk: 0, falsePositive: 0 }, applicationsWithActiveFindings: 0, topApplications: [] }, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } }));
  await page.goto(`${app}/appsec`);
  await expect(page.getByText('No applications yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Applications' })).toHaveCount(0);
});

test('Findings pagination requests and shows the second page', async ({ page }) => {
  await fixture(page, 'USER', ['finding-management']);
  await page.route('**/appsec/findings?*', route => {
    const requested = new URL(route.request().url());
    const pageNumber = Number(requested.searchParams.get('page') ?? 1);
    const make = (index: number) => finding(`finding-${index}`, 'app-a', 'Portal A', `Finding ${index}`);
    return route.fulfill({ json: { items: pageNumber === 1 ? Array.from({ length: 10 }, (_, index) => make(index + 1)) : [make(11)], total: 11, page: pageNumber, limit: 10 }, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } });
  });
  await page.goto(`${app}/appsec/findings`);
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Finding 11' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Finding 1', exact: true })).toHaveCount(0);
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
});
