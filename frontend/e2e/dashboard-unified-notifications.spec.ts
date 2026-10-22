import { expect, test, type Page } from '@playwright/test';
const app = process.env.SIDEBAR_APP_URL || 'http://localhost:3000';
const summary = { dashboardMode: 'TENANT_ADMIN', tenantName: 'QA', indicators: 1, highRiskIndicators: 1, activeAlerts: 1, openCases: 1, users: 3, myIndicatorsCreated: 0, sources: 1, campaigns: 0, subscription: { plan: 'Team', status: 'ACTIVE' }, activityAvailable: true, recentActivity: [], tenantOverview: [] };
async function setup(page: Page, root = false) {
  const state = { mode: 'mixed', read: false, waiting: false, release: () => {}, holdRead: false, readWaiting: false, readRelease: () => {} };
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin === new URL(app).origin) return route.continue();
    const send = (json: object, status = 200) => route.fulfill({ status, json, headers: { 'access-control-allow-origin': new URL(app).origin, 'access-control-allow-credentials': 'true' } });
    if (u.pathname === '/auth/me') return send({ id: 'qa', name: 'QA Admin', role: root ? 'SUPER_ADMIN' : 'ADMIN', tenant: root ? null : { id: 'a', name: 'QA' }, moduleAccess: [] });
    if (u.pathname === '/dashboard/summary') return send({ ...summary, dashboardMode: root ? 'GLOBAL' : 'TENANT_ADMIN' });
    if (u.pathname === '/users/tenants') return send([{ id: 'a', name: 'Tenant A' }, { id: 'b', name: 'Tenant B' }]);
    if (u.pathname.endsWith('/read')) {
      if (state.holdRead) await new Promise<void>(resolve => { state.readRelease = resolve; state.readWaiting = true; });
      state.read = true; return send({ id: 'shared:case', readAt: '2026-10-19T00:00:00Z', route: '/cases/qa' });
    }
    if (u.pathname === '/dashboard/notifications') {
      const tenant = u.searchParams.get('tenantId') || 'a';
      if (state.mode === 'hold' && tenant === 'a') await new Promise<void>(resolve => { state.release = resolve; state.waiting = true; });
      if (state.mode === 'denied') return send({ message: 'Denied' }, 403);
      if (state.mode === 'error') return send({ message: 'Unavailable' }, 503);
      return send({ items: state.mode === 'empty' ? [] : ['ASM', 'Case', 'AppSec', 'TI'].map((source, i) => ({ id: `shared:${i}`, sourceModule: source, type: 'QA', title: `${source} notice ${tenant}${state.mode === 'pagination' ? ` page ${u.searchParams.get('page')}` : ''}`, preview: 'Safe preview', severity: i === 3 ? null : 'HIGH', createdAt: '2026-10-19T00:00:00Z', readAt: state.read ? '2026-10-19T00:00:00Z' : null, route: '/cases/qa' })), unreadCount: state.mode === 'empty' || state.read ? 0 : 4, hasMore: state.mode === 'pagination' && u.searchParams.get('page') === '1', partialFailures: state.mode === 'partial' ? ['TI'] : [] });
    }
    return send({ items: [] });
  });
  return state;
}

test('Mixed Bell supports read state, keyboard, errors and retry', async ({ page }) => {
  const state = await setup(page); await page.goto(`${app}/dashboard`);
  const bell = page.getByRole('button', { name: /Notifications/ }); await expect(bell).toHaveAccessibleName('Notifications, 4 belum dibaca'); await bell.click();
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  for (const source of ['ASM', 'Case', 'AppSec', 'TI']) await expect(dialog.getByRole('link', { name: `${source} notice a` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tutup notifikasi' })).toBeFocused();
  await expect(dialog).toHaveAttribute('aria-modal', 'false');
  await page.keyboard.press('Shift+Tab'); await expect(bell).toBeFocused();
  await dialog.getByRole('button', { name: 'Mark as read' }).first().click(); await expect(bell).toHaveAccessibleName('Notifications');
  await expect(dialog.getByRole('button', { name: 'Tutup notifikasi' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(bell).toBeFocused();
  state.mode = 'empty'; await bell.click(); await expect(dialog).toContainText('Belum ada notifikasi.');
  await page.keyboard.press('Escape'); state.mode = 'partial'; await bell.click(); await expect(dialog).toContainText('Sebagian sumber belum tersedia');
  await page.keyboard.press('Escape'); state.mode = 'denied'; await bell.click(); await expect(dialog).toContainText('Akses notifikasi tidak tersedia.'); await expect(dialog.getByRole('link')).toHaveCount(0); await expect(bell).toHaveAccessibleName('Notifications');
  await page.keyboard.press('Escape'); state.mode = 'error'; await bell.click(); await expect(dialog.getByRole('alert')).toBeVisible();
  state.mode = 'mixed'; await dialog.getByRole('button', { name: 'Coba lagi' }).click(); await expect(dialog.getByRole('link').first()).toBeVisible();
});

test('Concurrent read and pagination keeps the selected page', async ({ page }) => {
  const state = await setup(page); state.mode = 'pagination'; state.holdRead = true;
  await page.goto(`${app}/dashboard`);
  await page.getByRole('button', { name: /Notifications/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await dialog.getByRole('button', { name: 'Mark as read' }).first().click();
  await expect.poll(() => state.readWaiting).toBe(true);
  await dialog.getByRole('button', { name: 'Berikutnya' }).click();
  await expect(dialog.getByRole('link', { name: 'Case notice a page 2' })).toBeVisible();
  state.readRelease();
  await expect(dialog.getByRole('button', { name: 'Tutup notifikasi' })).toBeFocused();
  await expect(dialog).toContainText('Halaman 2');
  await expect(dialog.getByRole('link', { name: 'Case notice a page 2' })).toBeVisible();
});

test('Tenant change discards an older in-flight response', async ({ page }) => {
  const state = await setup(page, true); state.mode = 'hold'; await page.goto(`${app}/dashboard`);
  const picker = page.getByRole('combobox', { name: 'Tenant Search dan Notifications' }); await picker.selectOption('a');
  await expect.poll(() => state.waiting).toBe(true); await picker.selectOption('b'); state.release(); state.mode = 'mixed';
  await page.getByRole('button', { name: /Notifications/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Case notice b'); await expect(page.getByRole('dialog')).not.toContainText('notice a');
});

test('Authorized notification link uses the safe destination', async ({ page }) => {
  await setup(page);
  await page.goto(`${app}/dashboard`);
  await page.getByRole('button', { name: /Notifications/ }).click();
  await page.getByRole('dialog', { name: 'Notifications' }).getByRole('link', { name: 'Case notice a' }).click();
  await expect(page).toHaveURL(/\/cases\/qa$/);
});

test('Bell remains usable at mobile, tablet and desktop in both themes', async ({ page }) => {
  const state = await setup(page); state.mode = 'pagination';
  for (const width of [375, 768, 1280]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${app}/dashboard`);
    await page.evaluate(value => { localStorage.setItem('cti-theme', value); }, theme);
    await page.reload();
    const bell = page.getByRole('button', { name: /Notifications/ });
    await bell.click();
    const dialog = page.getByRole('dialog', { name: 'Notifications' });
    await expect(dialog).toHaveAttribute('aria-modal', 'false');
    await expect(dialog.getByRole('link', { name: 'Case notice a page 1' })).toBeVisible();
    const colors = await dialog.locator('li').first().evaluate(item => ({ background: getComputedStyle(item).backgroundColor, text: getComputedStyle(item.querySelector('a')!).color }));
    const contrast = await dialog.locator('li').first().evaluate(item => {
      const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(channel => Number(channel) * (value.startsWith('color(srgb') ? 255 : 1));
      const luminance = (rgb: number[]) => rgb.map(channel => {
        const value = channel / 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      const backgroundColor = getComputedStyle(item).backgroundColor;
      const alpha = backgroundColor.startsWith('rgba') ? Number((backgroundColor.match(/[\d.]+/g) ?? [])[3]) : 1;
      const surface = item.closest('.dashboard-bell-popover');
      if (!surface) throw new Error('Bell surface missing');
      const surfaceRgb = parse(getComputedStyle(surface).backgroundColor);
      const background = luminance(parse(backgroundColor).map((channel, index) => channel * alpha + surfaceRgb[index] * (1 - alpha)));
      return [item.querySelector('a'), item.querySelector('.dashboard-notice-preview'), item.querySelector('button')]
        .filter((node): node is Element => node instanceof Element)
        .map(node => {
          const foreground = luminance(parse(getComputedStyle(node).color));
          return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
        });
    });
    for (const [index, ratio] of contrast.entries()) expect(ratio, `${width}px ${theme} Bell text ${index} ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(4.5);
    await dialog.getByRole('button', { name: 'Berikutnya' }).click();
    await expect(dialog.getByRole('link', { name: 'Case notice a page 2' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Berikutnya' })).toBeDisabled();
    await page.screenshot({ path: `../docs/audits/db23-bell-${width}-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(bell).toBeFocused();
    await bell.click(); await bell.click();
    await expect(dialog).toHaveCount(0);
  }
});
