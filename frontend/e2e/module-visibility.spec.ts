import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3000';
const modules = [
  { moduleId: 'asm', moduleSlug: 'attack-surface-management', moduleName: 'Attack Surface Management' },
  { moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence' },
  { moduleId: 'case', moduleSlug: 'case-management', moduleName: 'Case Management' },
] as const;

async function session(page: Page, accessible: boolean, role: 'ADMIN' | 'USER' = 'ADMIN'): Promise<void> {
  await page.route('**/auth/me', route => route.fulfill({ json: {
    id: 'visibility-test', email: 'qa@example.test', role, tenantId: 'tenant-a',
    moduleAccess: modules.map(module => ({ ...module, assigned: role === 'USER' && accessible, accessible, featureKeys: [] })),
  } }));
  await page.route('**/dashboard/summary', route => route.fulfill({ json: { dashboardMode: 'PERSONAL', tenantName: 'QA', indicators: 0, highRiskIndicators: 0, activeAlerts: 0, openCases: 0, users: 0, myIndicatorsCreated: 0, sources: 0, campaigns: 0, subscription: { plan: 'QA', status: 'ACTIVE' }, recentActivity: [], tenantOverview: [] } }));
  await page.route('**/intelligence/overview', route => route.fulfill({ json: { entities: [], relationships: [] } }));
}

for (const role of ['ADMIN', 'USER'] as const) {
  for (const accessible of [true, false]) {
    test(`${role} sees only effective module access ${accessible}`, async ({ page }) => {
      await session(page, accessible, role);
      await page.goto(`${app}/dashboard`);
      for (const name of ['Attack Surface Management', 'Threat Intelligence', 'Case Management']) {
        await expect(page.getByRole('button', { name, exact: true })).toHaveCount(accessible ? 1 : 0);
      }
    });
  }
}

test('denied modules block direct routes', async ({ page }) => {
  await session(page, false);
  await page.goto(`${app}/attack-surface/assets`);
  await expect(page.getByText('Access denied')).toBeVisible();
  await page.goto(`${app}/cases`);
  await expect(page.getByText('Anda tidak memiliki akses ke modul Case Management.')).toBeVisible();
  await page.goto(`${app}/threat-intelligence`);
  await expect(page.getByText('Anda tidak memiliki akses ke modul Threat Intelligence.')).toBeVisible();
});
