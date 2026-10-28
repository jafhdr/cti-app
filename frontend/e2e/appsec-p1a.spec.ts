import { expect, test, type Page } from '@playwright/test';

const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3100';
type Role = 'ADMIN' | 'USER';
type RecordFinding = {
  id: string; applicationId: string; title: string; description: string | null; severity: string;
  status: string; source: string; category: string | null; cweId: string | null; location: string | null;
  remediationNote: string | null; dueDate: string | null; resolution: string | null; resolvedAt: string | null;
  firstSeenAt: string; lastSeenAt: string; createdAt: string; updatedAt: string;
  workflowVersion: number; revision: number; validationState: string | null; priority: string | null;
  priorityRationale: string | null; assigneeId: string | null;
  application: { readonly id: string; readonly name: string };
};
const now = '2026-10-28T00:00:00.000Z';
async function fixture(page: Page, role: Role, historyCount = 0): Promise<void> {
  const record: RecordFinding = {
    id: 'finding-a', applicationId: 'app-a', title: 'Portal access review', description: 'Review tenant access',
    severity: 'HIGH', status: 'OPEN', source: 'MANUAL', category: null, cweId: null, location: null,
    remediationNote: null, dueDate: null, resolution: null, resolvedAt: null,
    firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
    workflowVersion: historyCount ? 2 : 1, revision: historyCount, validationState: historyCount ? 'VALID' : null, priority: null,
    priorityRationale: null, assigneeId: null, application: { id: 'app-a', name: 'Portal' },
  };
  const events = Array.from({ length: historyCount }, (_, index) => ({ id: String(index), kind: 'VALIDATED', actorId: 'actor', reason: 'Reviewed', createdAt: now }));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === new URL(app).origin) { await route.continue(); return; }
    const path = url.pathname;
    const send = (body: object, status = 200) => route.fulfill({ status, json: body, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } });
    if (path === '/auth/me') { await send({ id: 'actor', email: 'qa@example.test', role, tenantId: 'tenant-a', moduleAccess: [{ moduleId: 'appsec', moduleSlug: 'appsec-posture', moduleName: 'AppSec', accessible: true, featureKeys: ['finding-management'] }] }); return; }
    if (path === '/appsec/findings/finding-a') { await send(record); return; }
    if (path === '/appsec/findings/assignees') { await send([{ id: 'owner-a', name: 'Owner A' }]); return; }
    if (path === '/appsec/findings/finding-a/lifecycle/events') { const pageNumber = Number(url.searchParams.get('page') || '1'); await send({ items: events.slice((pageNumber - 1) * 25, pageNumber * 25), total: events.length, page: pageNumber, limit: 25 }); return; }
    const action = path.match(/^\/appsec\/findings\/finding-a\/lifecycle\/(activate|validate|priority|assign)$/)?.[1];
    if (action && request.method() === 'POST') {
      if (role !== 'ADMIN') { await send({ message: 'Denied' }, 403); return; }
      const body = request.postDataJSON() as { expectedRevision: number; reason?: string; rationale?: string; decision?: string; priority?: string; assigneeId?: string };
      if (body.expectedRevision !== record.revision) { await send({ message: 'Conflict' }, 409); return; }
      if (action === 'activate') { record.workflowVersion = 2; record.validationState = 'PENDING'; }
      if (action === 'validate') record.validationState = body.decision ?? null;
      if (action === 'priority') { record.priority = body.priority ?? null; record.priorityRationale = body.rationale ?? null; }
      if (action === 'assign') record.assigneeId = body.assigneeId ?? null;
      record.revision += 1;
      const event = { id: String(record.revision), kind: action.toUpperCase(), actorId: 'actor', reason: body.reason ?? body.rationale ?? '', createdAt: now };
      events.unshift(event);
      await send({ finding: record, event }, 201);
      return;
    }
    if (path.startsWith('/appsec/findings/finding-a/')) { await send({}); return; }
    await send({});
  });
}

test('ADMIN completes P1-A triage and responsive detail', async ({ page }) => {
  await fixture(page, 'ADMIN');
  await page.goto(`${app}/appsec/findings/finding-a`);
  await expect(page.getByText('Legacy finding')).toBeVisible();
  await page.getByLabel('Triage reason').fill('Start reviewed workflow');
  await page.getByRole('button', { name: 'Activate V2 triage' }).click();
  await expect(page.getByText('PENDING')).toBeVisible();
  await page.getByLabel('Triage reason').fill('Validated with owner');
  await page.getByRole('button', { name: 'Record validation' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'VALID' })).toBeVisible();
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.getByLabel('Triage reason').fill('High impact');
  await page.getByRole('button', { name: 'Set priority' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'HIGH' })).toBeVisible();
  await page.getByLabel('Assignee').selectOption('owner-a');
  await page.getByRole('button', { name: 'Save assignment' }).click();
  await expect(page.locator('.appsec-triage dd').filter({ hasText: 'Owner A' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Action history' })).toBeVisible();
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.locator('.appsec-triage')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/appsec-p1a-${width}.png`, fullPage: true });
  }
});

test('USER sees P1-A summary without mutation controls', async ({ page }) => {
  await fixture(page, 'USER');
  await page.goto(`${app}/appsec/findings/finding-a`);
  await expect(page.getByText('Legacy finding')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate V2 triage' })).toHaveCount(0);
  await expect(page.getByLabel('Triage reason')).toHaveCount(0);
});


test('USER can load every page of permitted P1-A history', async ({ page }) => {
  await fixture(page, 'USER', 26);
  await page.goto(`${app}/appsec/findings/finding-a`);
  await expect(page.locator('.appsec-triage-history li')).toHaveCount(25);
  await page.getByRole('button', { name: 'Load more history' }).click();
  await expect(page.locator('.appsec-triage-history li')).toHaveCount(26);
  await expect(page.getByRole('button', { name: 'Load more history' })).toHaveCount(0);
});
