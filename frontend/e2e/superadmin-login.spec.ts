import { expect, test } from '@playwright/test';

test('super admin can log in through the form', async ({ page }) => {
  const failedResponses: string[] = [];
  page.on('response', (response) => {
    if (!response.ok()) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('http://localhost:3000/login');
  await page.getByLabel('Email address').fill('superadmin@cti.local');
  await page.locator('#password').fill('SuperAdmin123!');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL('http://localhost:3000/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keluar dari Dashboard' })).toBeVisible();
  expect(failedResponses).toEqual([]);
});
