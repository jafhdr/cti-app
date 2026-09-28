import { expect, test } from '@playwright/test';

const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3000';

test('Case Management menu opens list, detail, and assign modal', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const moduleAccess = [
    { moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: [] },
  ];
  const caseDetail = {
    id: 'case-1', caseNumber: 'CASE-001', title: 'Suspicious login', description: 'Review login activity',
    status: 'OPEN', priority: 'HIGH', severity: 'HIGH', createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z', creator: { id: 'creator', name: 'Analyst', email: 'analyst@example.test' },
    tenant: { id: 'tenant', name: 'QA', slug: 'qa' },
  };

  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'user', email: 'qa@example.test', role: 'ADMIN', moduleAccess } }));
  await page.route('http://localhost:3001/cases?page=*', route => route.fulfill({ json: { items: [caseDetail], total: 1 } }));
  await page.route('http://localhost:3001/cases/case-1', route => route.fulfill({ json: caseDetail }));
  await page.route('http://localhost:3001/cases/case-1/notes', route => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/evidence', route => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/activity', route => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/assignable-users', route => route.fulfill({ json: [{ id: 'assignee', name: 'Responder', email: 'responder@example.test' }] }));

  await page.goto(`${app}/cases`);
  await expect(page).toHaveURL(`${app}/cases`);
  await expect(page.getByRole('button', { name: 'Case Management' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: 'Cases', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: '../.omo/evidence/cases/list-with-navigation.png', fullPage: true });
  await page.getByRole('link', { name: 'CASE-001' }).click();

  await expect(page).toHaveURL(`${app}/cases/case-1`);
  await expect(page.getByRole('heading', { name: 'Suspicious login' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cases', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Change' }).click();
  await expect(page.getByRole('heading', { name: 'Assign Case' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('combobox')).toContainText('Responder');
  await expect(page.getByRole('region', { name: 'Investigation' })).toBeVisible();
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: '../.omo/evidence/cases/detail-with-assign-modal.png', fullPage: true });
});

test('Case List recovers from an API error through Retry', async ({ page }) => {
  const moduleAccess = [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: [] }];
  let attempts = 0;
  let recover = false;
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'user', email: 'qa@example.test', role: 'USER', moduleAccess } }));
  await page.route('http://localhost:3001/cases?page=*', route => {
    attempts += 1;
    return !recover
      ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
      : route.fulfill({ json: { items: [], total: 0 } });
  });

  await page.goto(`${app}/cases`);
  await expect(page.getByText('Failed to fetch', { exact: true })).toBeVisible();
  const beforeRetry = attempts; recover = true;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('No cases found')).toBeVisible();
  expect(attempts).toBeGreaterThan(beforeRetry);
});

test('USER can investigate but cannot create or assign cases', async ({ page }) => {
  const moduleAccess = [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: [] }];
  const caseDetail = { id: 'case-1', caseNumber: 'CASE-001', title: 'Suspicious login', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z', creator: { id: 'creator', name: 'Analyst', email: 'analyst@example.test' }, tenant: { id: 'tenant', name: 'QA', slug: 'qa' } };
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'user', email: 'qa@example.test', role: 'USER', moduleAccess } }));
  await page.route('http://localhost:3001/cases?page=*', route => route.fulfill({ json: { items: [caseDetail], total: 1 } }));
  await page.route('http://localhost:3001/cases/case-1', route => route.fulfill({ json: caseDetail }));
  await page.route('http://localhost:3001/cases/case-1/notes', route => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/evidence', route => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/case-1/activity', route => route.fulfill({ json: [] }));

  await page.goto(`${app}/cases`);
  await expect(page.getByRole('button', { name: 'New Case' })).toHaveCount(0);
  await page.getByRole('link', { name: 'CASE-001' }).click();
  await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Investigation' })).toBeVisible();
});

test('unauthenticated Case route returns to login', async ({ page }) => {
  await page.route('**/auth/me', route => route.fulfill({ status: 401, json: { message: 'Unauthorized' } }));
  await page.goto(`${app}/cases`);
  await expect(page).toHaveURL(`${app}/login`);
});
