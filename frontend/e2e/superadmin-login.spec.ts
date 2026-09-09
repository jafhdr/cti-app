import { expect, test } from '@playwright/test';

test('super admin can log in through the form', async ({ page }) => {
  const failedResponses: string[] = [];
  page.on('response', (response) => {
    if (!response.ok()) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('http://localhost:3000');
  await page.getByLabel('Email').fill('superadmin@cti.local');
  await page.getByLabel('Password').fill('SuperAdmin123!');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL('http://localhost:3000/dashboard');
  await expect(page.getByText('SUPER_ADMIN', { exact: true })).toBeVisible();
  expect(failedResponses).toEqual([]);
});
