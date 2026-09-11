import { test, expect } from '@playwright/test';
const app = process.env.SOURCES_APP_URL || 'http://localhost:3000';
const empty = { threatActors: [], campaigns: [], indicators: [], malwareTools: [], vulnerabilities: [], sources: [] } as const;
const report = { id: 'report-1', title: 'APT Quarterly Assessment', summary: 'Analysis of active adversary operations and priority defensive actions.', content: 'Executive findings and technical evidence.', reportType: 'STRATEGIC', tlp: 'AMBER', status: 'PUBLISHED', publishedAt: '2026-09-10T00:00:00Z', createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z', ...empty, _count: { threatActors: 0, campaigns: 0, indicators: 0, malwareTools: 0, vulnerabilities: 0, sources: 0 } } as const;
test('capture intelligence reports desktop and mobile', async ({ page }) => {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'user', email: 'analyst@example.test', role: 'ADMIN', tenantId: 'tenant-a', moduleAccess: [{ moduleSlug: 'threat-intelligence', assigned: true }] } }));
  await page.route('**/intelligence/reports**', route => route.fulfill({ json: route.request().url().endsWith('/relations') ? empty : { items: [report], total: 1, totalPages: 1 } }));
  await page.goto(`${app}/threat-intelligence/reports`); await expect(page.getByLabel('Search reports')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/intelligence-reports/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: '../.omo/evidence/intelligence-reports/mobile.png', fullPage: true });
});
