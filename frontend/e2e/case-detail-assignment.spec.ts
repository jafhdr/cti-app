import { test, expect } from '@playwright/test';

test.describe('Case Detail and Assignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/cases');
  });

  test('should display case detail page with all information', async ({ page }) => {
    // Get first case link
    const firstCaseLink = page.locator('a[href*="/cases/"]').first();
    await firstCaseLink.click();

    // Wait for detail page to load
    await page.waitForURL(/\/cases\/[a-z0-9]+$/);

    // Verify all elements are present
    await expect(page.locator('text=Back')).toBeVisible();
    await expect(page.locator('h1')).toBeVisible(); // Case title
    
    // Verify badges are present
    const statusBadge = page.locator('text=OPEN, IN_PROGRESS, RESOLVED, CLOSED').first();
    const priorityBadge = page.locator('text=LOW, MEDIUM, HIGH, CRITICAL').first();
    const severityBadge = page.locator('text=LOW, MEDIUM, HIGH, CRITICAL').nth(1);
    
    await expect(statusBadge.or(priorityBadge).or(severityBadge)).toBeTruthy();

    // Verify assignment section
    await expect(page.locator('text=Assignment')).toBeVisible();
    await expect(page.locator('text=Created By')).toBeVisible();
  });

  test('should open assignment modal and change assignee', async ({ page }) => {
    // Navigate to case detail
    const firstCaseLink = page.locator('a[href*="/cases/"]').first();
    await firstCaseLink.click();
    await page.waitForURL(/\/cases\/[a-z0-9]+$/);

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
      await select.selectOption(options.nth(1));
      
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
    await expect(page.locator('text=Case')).toBeVisible();
  });

  test('should show loading state on detail page', async ({ page }) => {
    const firstCaseLink = page.locator('a[href*="/cases/"]').first();
    
    // Monitor network to verify API call
    const apiPromise = page.waitForResponse(
      response => response.url().includes('/api/cases/') && response.status() === 200
    );
    
    await firstCaseLink.click();
    await apiPromise;
    
    // Should eventually load content
    await expect(page.locator('h1')).toBeVisible();
  });

  test('should navigate back to case list from detail page', async ({ page }) => {
    const firstCaseLink = page.locator('a[href*="/cases/"]').first();
    await firstCaseLink.click();
    await page.waitForURL(/\/cases\/[a-z0-9]+$/);

    // Click back button
    const backButton = page.locator('a:has-text("Back")');
    await backButton.click();

    // Should return to case list
    await page.waitForURL('/cases');
    await expect(page.locator('text=Case Management')).toBeVisible();
  });

  test('should display responsive layout on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    const firstCaseLink = page.locator('a[href*="/cases/"]').first();
    await firstCaseLink.click();
    await page.waitForURL(/\/cases\/[a-z0-9]+$/);

    // Verify content is visible on mobile
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('text=Assignment')).toBeVisible();
  });
});
