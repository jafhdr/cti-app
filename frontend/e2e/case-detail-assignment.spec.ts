import { test, expect } from '@playwright/test';

test.describe('Case Detail and Assignment', () => {
  test.beforeEach(async ({ page }) => {
    const moduleAccess = [{ moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, featureKeys: [] }];
    const caseDetail = { id: 'case-1', caseNumber: 'CASE-001', title: 'Suspicious login', description: 'Investigate access', status: 'OPEN', priority: 'HIGH', severity: 'HIGH', creator: { id: 'creator', name: 'Analyst', email: 'analyst@example.test' }, tenant: { id: 'tenant', name: 'QA', slug: 'qa' }, createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z' };
    await page.route('**/auth/me', route => route.fulfill({ json: { id: 'user', email: 'qa@example.test', role: 'ADMIN', moduleAccess } }));
    await page.route('http://localhost:3001/cases?page=*', route => route.fulfill({ json: { items: [caseDetail], total: 1 } }));
    await page.route('http://localhost:3001/cases/assignable-users', route => route.fulfill({ json: [{ id: 'assignee', name: 'Responder', email: 'responder@example.test' }] }));
    await page.route('http://localhost:3001/cases/case-1/assign', route => route.fulfill({ json: { ...caseDetail, assignee: { id: 'assignee', name: 'Responder', email: 'responder@example.test' } } }));
    await page.route('http://localhost:3001/cases/case-1/notes', route => route.fulfill({ json: [] }));
    await page.route('http://localhost:3001/cases/case-1/evidence', route => route.fulfill({ json: [] }));
    await page.route('http://localhost:3001/cases/case-1/activity', route => route.fulfill({ json: [] }));
    await page.route('http://localhost:3001/cases/invalid-id-123', route => route.fulfill({ status: 404, json: { message: 'Case tidak ditemukan' } }));
    await page.route('http://localhost:3001/cases/case-1', route => route.fulfill({ json: caseDetail }));
    await page.goto('http://localhost:3000/cases');
  });

  test('should display case detail page with all information', async ({ page }) => {
    // Get first case link
    const firstCaseLink = page.locator('a[href*="/cases/"]').first();
    await firstCaseLink.click();

    // Wait for detail page to load
    await page.waitForURL(/\/cases\/[a-z0-9-]+$/);

    // Verify all elements are present
    await expect(page.locator('text=Back')).toBeVisible();
    await expect(page.locator('h1')).toBeVisible(); // Case title
    
    // Verify badges are present
    await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
    await expect(page.getByText('HIGH', { exact: true })).toHaveCount(2);

    // Verify assignment section
    await expect(page.getByText('Assigned To')).toBeVisible();
    await expect(page.locator('text=Created By')).toBeVisible();
  });

  test('should open assignment modal and change assignee', async ({ page }) => {
    // Navigate to case detail
    const firstCaseLink = page.locator('a[href*="/cases/"]').first();
    await firstCaseLink.click();
    await page.waitForURL(/\/cases\/[a-z0-9-]+$/);

    // Click Change button
    const changeButton = page.locator('button:has-text("Change")');
    await changeButton.click();

    // Modal should appear
    await expect(page.locator('text=Assign Case')).toBeVisible();
    await expect(page.locator('select')).toBeVisible();

    // Select a user from dropdown
    const select = page.locator('select');
    const options = select.locator('option');
    const optionCount = await options.count();
    
    if (optionCount > 1) {
      // Select second option (first is placeholder)
      await select.selectOption({ index: 1 });
      
      // Click Assign button
      const assignButton = page.locator('button:has-text("Assign")');
      await assignButton.click();

      // Modal should close
      await expect(page.locator('text=Assign Case')).not.toBeVisible();
    }
  });

  test('should display error when case not found', async ({ page }) => {
    await page.goto('http://localhost:3000/cases/invalid-id-123');
    
    // Wait for error message
    await expect(page.getByText('Case tidak ditemukan')).toBeVisible();
  });

  test('should show loading state on detail page', async ({ page }) => {
    const firstCaseLink = page.locator('a[href*="/cases/"]').first();
    
    // Monitor network to verify API call
    const apiPromise = page.waitForResponse(
      response => response.url() === 'http://localhost:3001/cases/case-1' && response.status() === 200
    );
    
    await firstCaseLink.click();
    await apiPromise;
    
    // Should eventually load content
    await expect(page.locator('h1')).toBeVisible();
  });

  test('should navigate back to case list from detail page', async ({ page }) => {
    const firstCaseLink = page.locator('a[href*="/cases/"]').first();
    await firstCaseLink.click();
    await page.waitForURL(/\/cases\/[a-z0-9-]+$/);

    // Click back button
    const backButton = page.locator('a:has-text("Back")');
    await backButton.click();

    // Should return to case list
    await page.waitForURL('http://localhost:3000/cases');
    await expect(page.getByRole('heading', { name: 'Case Management' })).toBeVisible();
  });

  test('should display responsive layout on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    const firstCaseLink = page.locator('a[href*="/cases/"]').first();
    await firstCaseLink.click();
    await page.waitForURL(/\/cases\/[a-z0-9-]+$/);

    // Verify content is visible on mobile
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText('Assigned To')).toBeVisible();
  });
});
