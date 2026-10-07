import { expect, test } from '@playwright/test';

const item = { id: 'case-1', caseNumber: 'CASE-001', title: 'Suspicious login', description: 'Review sign-in activity', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', assignee: { id: 'analyst', name: 'Analyst' }, creator: { id: 'creator', name: 'Creator' }, tenant: { id: 'tenant', name: 'QA', slug: 'qa' }, createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' };
const evidence = '../.omo/evidence/cases/phase1';
const app = process.env.SIDEBAR_APP_URL ?? 'http://localhost:3000';

test('case workspace responsive and functional QA', async ({ page }) => {
  const moduleAccess = [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] }];
  await page.route('**/auth/me', route => route.fulfill({ json: { email: 'qa@example.test', role: 'ADMIN', moduleAccess } }));
  await page.route('http://localhost:3001/cases?*', route => {
    const params = new URL(route.request().url()).searchParams;
    const matches = (!params.get('search') || item.title.toLowerCase().includes(params.get('search')!.toLowerCase())) && (!params.get('status') || params.get('status') === item.status) && (!params.get('priority') || params.get('priority') === item.priority);
    return route.fulfill({ json: { items: matches ? [item] : [], total: matches ? 1 : 0 } });
  });
  await page.route('http://localhost:3001/cases/case-1', route => route.fulfill({ json: item }));
  for (const suffix of ['notes', 'evidence', 'activity', 'indicators', 'threat-actors', 'campaigns']) await page.route(`http://localhost:3001/cases/case-1/${suffix}`, route => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/assignable-users?*', route => route.fulfill({ json: [{ id: 'analyst', name: 'Analyst', email: 'analyst@example.test' }] }));
  for (const theme of ['dark', 'light'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(value => localStorage.setItem('cti-theme', value), theme);
    await page.goto(`${app}/cases`);
    await expect(page.getByRole('link', { name: 'CASE-001', exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/cases-${theme}-1440.png`, fullPage: true });
    await page.getByRole('link', { name: 'CASE-001', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Suspicious login' })).toBeVisible();
    await page.screenshot({ path: `${evidence}/case-detail-${theme}-1440.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(`${app}/cases`);
  await expect(page.getByRole('link', { name: 'CASE-001', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${app}/cases`);
  await expect(page.getByRole('link', { name: /Open case/ }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/cases-mobile-375.png`, fullPage: true });
  await page.getByRole('link', { name: /Open case/ }).last().click();
  await page.waitForURL('**/cases/case-1');
  await expect(page.getByRole('heading', { name: 'Suspicious login', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/case-detail-mobile-375.png`, fullPage: true });
  await page.getByRole('button', { name: 'Edit case' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit case' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.goto(`${app}/cases`);
  await page.getByRole('textbox', { name: 'Search cases' }).fill('missing');
  await expect(page.getByText('No cases found')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('link', { name: /Open case/ }).last()).toBeVisible();
  await page.getByLabel('Status').selectOption('CLOSED');
  await expect(page.getByText('No cases found')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Priority').selectOption('LOW');
  await expect(page.getByText('No cases found')).toBeVisible();
});

test('case create, edit, and assignment use supported API operations', async ({ page }) => {
  const moduleAccess = [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] }];
  let created = false;
  let edited = false;
  let assigned = false;
  await page.route('**/auth/me', route => route.fulfill({ json: { email: 'qa@example.test', role: 'ADMIN', moduleAccess } }));
  await page.route('http://localhost:3001/cases?*', route => route.fulfill({ json: { items: [item], total: 1 } }));
  await page.route('http://localhost:3001/cases', route => {
    const body: { title: string; description: string; priority: string } = route.request().postDataJSON();
    created = body.title === 'Fixture case' && body.description === 'QA only' && body.priority === 'CRITICAL';
    return route.fulfill({ json: item });
  });
  await page.route('http://localhost:3001/cases/case-1', route => {
    if (route.request().method() === 'PATCH') {
      const body: { title: string; status: string; priority: string } = route.request().postDataJSON();
      edited = body.title === 'Updated case' && body.status === 'IN_PROGRESS' && body.priority === 'CRITICAL';
    }
    return route.fulfill({ json: item });
  });
  for (const suffix of ['notes', 'evidence', 'activity', 'indicators', 'threat-actors', 'campaigns']) await page.route(`http://localhost:3001/cases/case-1/${suffix}`, route => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/assignable-users?*', route => route.fulfill({ json: [{ id: 'responder', name: 'Responder', email: 'responder@example.test' }] }));
  await page.route('http://localhost:3001/cases/case-1/assign', route => {
    const body: { assigneeId: string } = route.request().postDataJSON();
    assigned = body.assigneeId === 'responder';
    return route.fulfill({ json: item });
  });
  await page.goto(`${app}/cases`);
  await page.getByRole('button', { name: 'New Case' }).click();
  await page.getByPlaceholder('Case title').fill('Fixture case');
  await page.getByPlaceholder('Case description').fill('QA only');
  await page.getByRole('dialog', { name: 'Create New Case' }).getByLabel('Priority').selectOption('CRITICAL');
  await page.getByRole('button', { name: 'Create Case' }).click();
  await expect(page.getByRole('heading', { name: 'Create New Case' })).toHaveCount(0);
  expect(created).toBe(true);
  await page.getByRole('link', { name: 'CASE-001', exact: true }).click();
  await page.waitForURL('**/cases/case-1');
  await page.getByRole('button', { name: 'Edit case' }).click();
  await page.getByRole('dialog', { name: 'Edit case' }).getByLabel('Title').fill('Updated case');
  await page.getByRole('dialog', { name: 'Edit case' }).getByLabel('Status').selectOption('IN_PROGRESS');
  await page.getByRole('dialog', { name: 'Edit case' }).getByLabel('Priority').selectOption('CRITICAL');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit case' })).toHaveCount(0);
  expect(edited).toBe(true);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByRole('dialog', { name: 'Assign Case' }).getByLabel('Select User').selectOption('responder');
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Assign Case' })).toHaveCount(0);
  expect(assigned).toBe(true);
});

test('system theme follows dark and light preference on Case Management', async ({ page }) => {
  const moduleAccess = [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: ['case-workflow'] }];
  await page.route('**/auth/me', route => route.fulfill({ json: { email: 'qa@example.test', role: 'USER', moduleAccess } }));
  await page.route('http://localhost:3001/cases?*', route => route.fulfill({ json: { items: [item], total: 1 } }));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('cti-theme', 'system'));
  await page.goto(`${app}/cases`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
