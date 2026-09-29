import { expect, test } from '@playwright/test';

const app = process.env.SOURCES_APP_URL || 'http://localhost:3000';
const indicator = { id: 'indicator-1', value: 'example.com', type: 'DOMAIN', severity: 'HIGH', confidence: 90, status: 'ACTIVE', tags: ['phishing'], source: 'analyst', description: 'Suspicious domain', expiresAt: null, tenant: { id: 'tenant-a', name: 'Tenant A' }, intelligenceEntity: null };

test('indicator create, edit, and deactivate use shared overlays', async ({ page }) => {
  const requests: { method: string; url: string; body?: unknown }[] = [];
  await page.route(/\/auth\/me$/, route => route.fulfill({ json: { name: 'QA Admin', email: 'admin@example.test', role: 'ADMIN', moduleAccess: [{ moduleSlug: 'threat-intelligence', accessible: true }] } }));
  await page.route(/\/intelligence\/overview(?:\?.*)?$/, route => route.fulfill({ json: { entities: [] } }));
  await page.route(/\/indicators\?/, route => route.fulfill({ json: { items: [indicator] } }));
  await page.route(/\/indicators(?:\/indicator-1(?:\/deactivate)?)?$/, route => {
    const request = route.request();
    if (request.method() === 'GET') return route.continue();
    requests.push({ method: request.method(), url: request.url(), body: request.postDataJSON() });
    return route.fulfill({ json: {} });
  });

  await page.goto(`${app}/indicators`);
  const createTrigger = page.getByRole('button', { name: '+ Add Indicator' });
  await createTrigger.click();
  const create = page.getByRole('dialog', { name: 'Add Indicator' });
  await expect(create).toBeVisible();
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => create.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= window.innerWidth;
    })).toBe(true);
    await page.screenshot({ path: `../.omo/evidence/threat-intelligence/modal-migration/indicator-create-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '../.omo/evidence/threat-intelligence/modal-migration/dark.png' });
  await create.getByRole('button', { name: 'Close' }).click();
  await page.getByLabel('Tema').selectOption('light');
  await createTrigger.click();
  await page.screenshot({ path: '../.omo/evidence/threat-intelligence/modal-migration/light.png' });
  await create.getByRole('button', { name: 'Close' }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByLabel('Tema').selectOption('system');
  await createTrigger.click();
  await page.screenshot({ path: '../.omo/evidence/threat-intelligence/modal-migration/system-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: '../.omo/evidence/threat-intelligence/modal-migration/system-light.png' });
  await create.getByLabel('Value').fill('new.example');
  await create.getByRole('button', { name: 'Save' }).click();
  await expect(create).toHaveCount(0);
  expect(requests[0]).toMatchObject({ method: 'POST', body: { value: 'new.example', type: 'DOMAIN' } });

  await page.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Indicator' });
  await expect(edit.getByLabel('Value')).toHaveValue('example.com');
  await edit.getByLabel('Description').fill('Updated description');
  await edit.getByRole('button', { name: 'Save' }).click();
  expect(requests[1]).toMatchObject({ method: 'PATCH', body: { description: 'Updated description' } });

  await page.getByRole('button', { name: 'Deactivate' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Deactivate indicator' });
  await expect(confirmation).toContainText('example.com');
  await page.screenshot({ path: '../.omo/evidence/threat-intelligence/modal-migration/confirmation.png' });
  await confirmation.getByRole('button', { name: 'Deactivate' }).click();
  await expect(confirmation).toHaveCount(0);
  expect(requests[2]?.method).toBe('PATCH');
  expect(requests[2]?.url).toContain('/indicator-1/deactivate');
});

test('indicator form blocks duplicate saves, shows server errors, and supports retry', async ({ page }) => {
  let requests = 0;
  let releaseFirst: (() => void) | undefined;
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
  await page.route(/\/auth\/me$/, route => route.fulfill({ json: { name: 'QA Admin', email: 'admin@example.test', role: 'ADMIN', moduleAccess: [{ moduleSlug: 'threat-intelligence', accessible: true }] } }));
  await page.route(/\/intelligence\/overview(?:\?.*)?$/, route => route.fulfill({ json: { entities: [] } }));
  await page.route(/\/indicators\?/, route => route.fulfill({ json: { items: [] } }));
  await page.route('http://localhost:3001/indicators', async route => {
    requests += 1;
    if (requests === 1) {
      await firstResponse;
      await route.fulfill({ status: 503, json: { message: 'Registry temporarily unavailable' } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto(`${app}/indicators`);
  const trigger = page.getByRole('button', { name: '+ Add Indicator' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Add Indicator' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  expect(requests).toBe(0);
  await dialog.getByLabel('Value').fill('new.example');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(requests).toBe(1);
  releaseFirst?.();
  await expect(dialog.getByRole('alert')).toContainText('Registry temporarily unavailable');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(2);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
