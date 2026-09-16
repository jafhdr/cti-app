import { expect, test } from '@playwright/test';

const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3000';

test('Case Management menu opens list, detail, and assign modal', async ({ page }) => {
  const moduleAccess = [
    { moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, featureKeys: [] },
  ];
  const caseDetail = {
    id: 'case-1', caseNumber: 'CASE-001', title: 'Suspicious login', description: 'Review login activity',
    status: 'OPEN', priority: 'HIGH', severity: 'HIGH', createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z', creator: { id: 'creator', name: 'Analyst', email: 'analyst@example.test' },
    tenant: { id: 'tenant', name: 'QA', slug: 'qa' },
  };

  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'user', email: 'qa@example.test', role: 'USER', moduleAccess } }));
  await page.route('**/api/cases?page=*', route => route.fulfill({ json: { items: [caseDetail], total: 1 } }));
  await page.route('**/api/cases/case-1', route => route.fulfill({ json: caseDetail }));
  await page.route('**/api/cases/case-1/notes', route => route.fulfill({ json: [] }));
  await page.route('**/api/cases/case-1/evidence', route => route.fulfill({ json: [] }));
  await page.route('**/api/cases/case-1/activity', route => route.fulfill({ json: [] }));
  await page.route('**/api/cases/assignable-users', route => route.fulfill({ json: [{ id: 'assignee', name: 'Responder', email: 'responder@example.test' }] }));

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
  await expect(page.getByRole('combobox')).toContainText('Responder');
  await expect(page.getByRole('region', { name: 'Investigation' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/cases/detail-with-assign-modal.png', fullPage: true });
});

test('unauthenticated Case route returns to login', async ({ page }) => {
  await page.route('**/auth/me', route => route.fulfill({ status: 401, json: { message: 'Unauthorized' } }));
  await page.goto(`${app}/cases`);
  await expect(page).toHaveURL(`${app}/`);
});
