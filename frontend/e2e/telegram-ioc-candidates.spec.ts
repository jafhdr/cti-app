import { expect, test, type Page, type Route } from '@playwright/test';

const app = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const candidate = {
  id: 'candidate-1', type: 'DOMAIN', rawValue: 'evil[.]example', normalizedValue: 'evil.example', confidence: 80, status: 'PENDING', createdAt: '2026-09-18T05:00:00.000Z',
  intelligenceSource: { id: 'source-1', name: 'Telegram SOC Feed' },
  observations: [{ id: 'observation-1', telegramStagingMessage: { messageId: '77', channelTitle: 'SOC Alerts', channelUsername: 'soc_alerts', messageUrl: 'https://t.me/soc_alerts/77', messageTimestamp: '2026-09-18T04:55:00.000Z' } }],
} as const;

async function session(page: Page): Promise<void> {
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'admin', email: 'admin@example.test', role: 'ADMIN', tenantId: 'tenant-a', moduleAccess: [{ moduleId: 'intel', moduleSlug: 'threat-intelligence', moduleName: 'Threat Intelligence', assigned: true, featureKeys: [] }] } }));
}

test('Telegram candidate can be reviewed and approved', async ({ page }) => {
  await session(page); let items = [candidate]; let action = '';
  await page.route('**/intelligence/ioc-candidates**', async (route: Route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: items });
    action = route.request().url(); items = []; return route.fulfill({ json: { status: 'APPROVED', candidateId: candidate.id, indicatorId: 'indicator-42', indicatorCreated: true } });
  });
  await page.goto(`${app}/threat-intelligence/ioc-candidates`);
  await expect(page.getByText('evil.example')).toBeVisible(); await expect(page.getByText('SOC Alerts')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/telegram-ioc-candidates/pending-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => action).toContain('/candidate-1/approve'); await expect(page.getByText('Candidate approved. Indicator baru dibuat.')).toBeVisible(); await expect(page.getByRole('link', { name: 'Indicator indicator-42' })).toBeVisible(); await expect(page.getByText('No pending candidates')).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/telegram-ioc-candidates/approved-new-desktop.png', fullPage: true });
});

test('Telegram candidate approval reports an existing indicator link', async ({ page }) => {
  await session(page);
  await page.route('**/intelligence/ioc-candidates**', route => route.request().method() === 'GET' ? route.fulfill({ json: [candidate] }) : route.fulfill({ json: { status: 'APPROVED', candidateId: candidate.id, indicatorId: 'indicator-existing', indicatorCreated: false } }));
  await page.goto(`${app}/threat-intelligence/ioc-candidates`); await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Candidate approved. Indicator existing digunakan.')).toBeVisible(); await expect(page.getByRole('link', { name: 'Indicator indicator-existing' })).toBeVisible();
  await page.screenshot({ path: '../.omo/evidence/telegram-ioc-candidates/approved-existing-desktop.png', fullPage: true });
});

test('Telegram candidate can be rejected', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await session(page); let action = '';
  await page.route('**/intelligence/ioc-candidates**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [candidate] });
    action = route.request().url(); return route.fulfill({ json: { ...candidate, status: 'REJECTED' } });
  });
  await page.goto(`${app}/threat-intelligence/ioc-candidates`); await expect(page.getByText('evil.example')).toBeVisible(); await page.screenshot({ path: '../.omo/evidence/telegram-ioc-candidates/pending-mobile.png', fullPage: true }); await page.getByRole('button', { name: 'Reject' }).click();
  await expect.poll(() => action).toContain('/candidate-1/reject'); await expect(page.getByText('No pending candidates')).toBeVisible();
});

test('Candidate review exposes loading, error retry, and empty states', async ({ page }) => {
  await session(page); let attempts = 0;
  await page.route('**/intelligence/ioc-candidates**', route => { attempts += 1; return attempts === 1 ? route.fulfill({ status: 500, json: { message: 'Temporary failure' } }) : route.fulfill({ json: [] }); });
  await page.goto(`${app}/threat-intelligence/ioc-candidates`); await expect(page.getByRole('alert').filter({ hasText: 'Temporary failure' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click(); await expect(page.getByText('No pending candidates')).toBeVisible();
});
