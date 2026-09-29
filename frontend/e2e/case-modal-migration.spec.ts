import { expect, test } from '@playwright/test';

const app = process.env.SIDEBAR_APP_URL ?? 'http://localhost:3000';
const evidence = '../.omo/evidence/cases/modal-migration';
const item = { id: 'case-1', caseNumber: 'CASE-001', title: 'Suspicious login', description: 'Review sign-in activity', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', creator: { id: 'creator', name: 'Creator' }, tenant: { id: 'tenant', name: 'QA', slug: 'qa' }, createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z' };

async function fixtures(page: import('@playwright/test').Page) {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'admin', email: 'admin@example.test', role: 'ADMIN', moduleAccess: [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, accessible: true, featureKeys: [] }] } }));
  await page.route('http://localhost:3001/cases?*', route => route.fulfill({ json: { items: [item], total: 1 } }));
  await page.route('http://localhost:3001/cases/case-1', route => route.fulfill({ json: item }));
  for (const suffix of ['notes', 'evidence', 'activity', 'indicators', 'threat-actors', 'campaigns']) await page.route(`http://localhost:3001/cases/case-1/${suffix}`, route => route.fulfill({ json: [] }));
  await page.route('http://localhost:3001/cases/assignable-users', route => route.fulfill({ json: [{ id: 'responder', name: 'Responder', email: 'responder@example.test' }] }));
}

test('New Case uses accessible overlay in all viewport and theme states', async ({ browser }) => {
  for (const width of [1440, 768, 375]) for (const [theme, scheme] of [['dark','dark'], ['light','light'], ['system-dark','dark'], ['system-light','light']] as const) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, colorScheme: scheme });
    await context.addInitScript(value => localStorage.setItem('cti-theme', value), theme.startsWith('system') ? 'system' : theme);
    const page = await context.newPage(); await fixtures(page); await page.goto(`${app}/cases`);
    const trigger = page.getByRole('button', { name: 'New Case' }); await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Create New Case' }); await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    expect(await page.evaluate(() => ({ locked: document.body.style.overflow === 'hidden', isolated: document.querySelector('#__next')?.hasAttribute('inert') ?? Array.from(document.body.children).some(node => node.hasAttribute('inert')), overflow: document.documentElement.scrollWidth > innerWidth }))).toEqual({ locked: true, isolated: true, overflow: false });
    if ((width === 1440 && (theme === 'dark' || theme === 'light')) || (width === 375 && theme === 'dark')) await page.screenshot({ path: `${evidence}/new-case-${theme}-${width}.png` });
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
    await trigger.click(); await page.locator('.cti-overlay').click({ position: { x: 2, y: 2 } }); await expect(dialog).toBeHidden();
    await context.close();
  }
});

test('Case form errors stay open and Evidence drawer retains context', async ({ page }) => {
  await fixtures(page);
  await page.route('http://localhost:3001/cases', route => route.fulfill({ status: 500, json: { message: 'Unavailable' } }));
  await page.goto(`${app}/cases`); await page.getByRole('button', { name: 'New Case' }).click();
  const create = page.getByRole('dialog', { name: 'Create New Case' });
  await create.getByRole('button', { name: 'Create Case' }).click(); await expect(create.getByPlaceholder('Case title')).toBeFocused();
  await create.getByPlaceholder('Case title').fill('Fixture case'); await create.getByRole('button', { name: 'Create Case' }).click();
  await expect(create.getByRole('alert')).toContainText('Failed to create case'); await expect(create).toBeVisible();
  await create.getByRole('button', { name: 'Cancel' }).click();
  await page.goto(`${app}/cases/case-1`); await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Edit case' }).click(); await page.screenshot({ path: `${evidence}/edit-case-375.png` }); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Edit case' })).toBeHidden();
  await page.getByRole('button', { name: 'Change', exact: true }).click(); await page.screenshot({ path: `${evidence}/assign-case-375.png` }); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add Evidence' }).click(); const drawer = page.getByRole('dialog', { name: 'Add Evidence' }); await expect(drawer).toBeVisible();
  await page.screenshot({ path: `${evidence}/evidence-drawer-375.png` });
  await expect(page.getByRole('heading', { name: 'Suspicious login' })).toHaveCount(1);
  await drawer.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Add Indicator' }).click();
  await expect(page.getByRole('dialog', { name: 'Add Indicator' })).toBeVisible();
  await page.screenshot({ path: `${evidence}/relationship-modal-375.png` });
});

test('Create loading blocks duplicate requests and error permits retry', async ({ page }) => {
  await fixtures(page);
  let requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('http://localhost:3001/cases', async route => {
    requests += 1;
    if (requests === 1) { await gate; await route.fulfill({ status: 500, json: { message: 'Unavailable' } }); }
    else await route.fulfill({ status: 201, json: item });
  });
  await page.goto(`${app}/cases`); await page.getByRole('button', { name: 'New Case' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Case' });
  await dialog.getByPlaceholder('Case title').fill('Fixture case');
  await dialog.getByRole('button', { name: 'Create Case' }).click();
  await expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  expect(requests).toBe(1);
  release?.(); await expect(dialog.getByRole('alert')).toContainText('Failed to create case');
  await dialog.getByRole('button', { name: 'Create Case' }).click();
  await expect(dialog).toBeHidden(); expect(requests).toBe(2);
});

test('Edit, Assign, and Evidence errors remain actionable', async ({ page }) => {
  await fixtures(page);
  await page.route('http://localhost:3001/cases/case-1', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, json: { message: 'Unavailable' } }) : route.fulfill({ json: item }));
  await page.route('http://localhost:3001/cases/case-1/assign', route => route.fulfill({ status: 500, json: { message: 'Assignment failed' } }));
  await page.route('http://localhost:3001/cases/case-1/evidence', route => route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { message: 'Evidence failed' } }) : route.fulfill({ json: [] }));
  await page.goto(`${app}/cases/case-1`);
  await page.getByRole('button', { name: 'Edit case' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit case' }); await expect(edit.getByLabel('Title')).toHaveValue(item.title);
  await edit.getByRole('button', { name: 'Save changes' }).click(); await expect(edit.getByRole('alert')).toContainText('Failed to update case');
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const assign = page.getByRole('dialog', { name: 'Assign Case' }); await assign.getByLabel('Select User').selectOption('responder');
  await assign.getByRole('button', { name: 'Assign', exact: true }).click(); await expect(assign.getByRole('alert')).toContainText('Assignment failed');
  await assign.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Add Evidence' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Evidence' }); await drawer.getByLabel('Nama evidence').fill('auth.log'); await drawer.getByLabel('Tipe evidence').fill('log');
  await drawer.getByRole('button', { name: 'Tambah Evidence' }).click(); await expect(drawer.getByRole('alert')).toContainText('Evidence failed');
  await expect(drawer).toBeVisible();
});
