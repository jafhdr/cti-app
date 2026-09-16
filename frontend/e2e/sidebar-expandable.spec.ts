import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3000';
const access = [
  { moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, featureKeys: ['read'] },
  { moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management', assigned: true, featureKeys: [] },
  { moduleId: 'appsec', moduleSlug: 'appsec-posture', moduleName: 'AppSec Posture', assigned: true, featureKeys: [] },
];

async function session(page: Page, role: 'USER' | 'ADMIN' = 'USER'): Promise<void> {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'sidebar-test', name: 'Sidebar QA', email: 'qa@example.test', role, tenant: { id: 'tenant', name: 'QA', slug: 'qa' }, moduleAccess: access } }));
  await page.route('**/dashboard/summary', route => route.fulfill({ json: { dashboardMode: 'PERSONAL', tenantName: 'QA', indicators: 0, highRiskIndicators: 0, activeAlerts: 0, openCases: 0, users: 0, myIndicatorsCreated: 0, sources: 0, campaigns: 0, subscription: { plan: 'QA', status: 'ACTIVE' }, recentActivity: [], tenantOverview: [] } }));
  await page.route('**/intelligence/overview', route => route.fulfill({ json: { entities: [], relationships: [] } }));
}

test('modules expand independently and remain collapsed by default', async ({ page }) => {
  await session(page);
  await page.goto(`${app}/dashboard`);
  const threatIntelligence = page.getByRole('button', { name: 'Threat Intelligence' });
  const caseManagement = page.getByRole('button', { name: 'Case Management' });
  await expect(threatIntelligence).toHaveAttribute('aria-expanded', 'false');
  await expect(caseManagement).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('link', { name: 'Indicators', exact: true })).toBeHidden();
  await page.screenshot({ path: '../.omo/evidence/sidebar/collapsed-desktop.png', fullPage: true });
  await threatIntelligence.click();
  await expect(threatIntelligence).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: 'Indicators', exact: true })).toBeVisible();
  await expect(caseManagement).toHaveAttribute('aria-expanded', 'false');
  await caseManagement.click();
  await expect(page.getByRole('link', { name: 'Cases', exact: true })).toHaveAttribute('href', '/cases');
  await expect(threatIntelligence).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: '../.omo/evidence/sidebar/expanded-desktop.png', fullPage: true });
});

test('active submenu automatically expands its module', async ({ page }) => {
  await session(page);
  await page.goto(`${app}/threat-intelligence/threat-actors`);
  await expect(page.getByRole('button', { name: 'Threat Intelligence' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: 'Threat Actors', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('active administration page expands Administration only', async ({ page }) => {
  await session(page, 'ADMIN');
  await page.goto(`${app}/users`);
  await expect(page.getByRole('button', { name: 'Administration' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: 'User Management', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Threat Intelligence' })).toHaveAttribute('aria-expanded', 'false');
});

test('expandable sidebar remains usable on mobile', async ({ page }) => {
  await session(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app}/dashboard`);
  const threatIntelligence = page.getByRole('button', { name: 'Threat Intelligence' });
  await threatIntelligence.click();
  await expect(page.getByRole('link', { name: 'Intelligence Hub', exact: true })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/sidebar/expanded-mobile.png', fullPage: true });
});
