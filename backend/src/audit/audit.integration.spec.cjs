const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { Test } = require('@nestjs/testing');
const { PrismaClient } = require('@prisma/client');
const { ConfigModule } = require('@nestjs/config');
const cookieParser = require('cookie-parser');
const { chromium, expect } = require('../../../frontend/node_modules/@playwright/test');
const { AuditModule } = require('../../dist/src/audit/audit.module');
const { createAccessToken } = require('../auth/integration-session.cjs');

test('audit actions, tenant scope, pagination and browser', { timeout: 120000 }, async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuditModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false }); app.use(cookieParser()); app.enableCors({ origin: true, credentials: true });
  const prisma = new PrismaClient(); const suffix = randomUUID();
  const tenantIds = []; const userIds = []; let browser;
  try {
    await app.listen(0, '127.0.0.1');
    const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    for (const name of ['Alpha', 'Beta']) tenantIds.push((await prisma.tenant.create({ data: { name, slug: `audit-${suffix}-${name.toLowerCase()}` } })).id);
    for (const [role, tenantId] of [['ADMIN', tenantIds[0]], ['ADMIN', tenantIds[1]], ['SUPER_ADMIN', null], ['USER', tenantIds[0]]]) {
      const user = await prisma.user.create({ data: { name: role, email: `audit-${randomUUID()}@example.test`, passwordHash: 'qa-fixture', role, tenantId } }); userIds.push(user.id);
    }
    const actions = ['LOGIN', 'MODULE_TENANT_ACCESS_UPDATED', 'SUBSCRIPTION_UPDATED', 'ASM_ALERT_CREATED', 'TI_INDICATOR_CREATED', 'CASE_CREATED', 'APPSEC_FINDING_CREATED'];
    for (const action of actions) await prisma.auditLog.create({ data: { userId: userIds[0], tenantId: tenantIds[0], action, createdAt: new Date('2026-01-01') } });
    await prisma.auditLog.create({ data: { userId: userIds[1], tenantId: tenantIds[1], action: 'FOREIGN_ONLY' } });
    const tokens = await Promise.all(userIds.map(id => createAccessToken(prisma, id, process.env.JWT_ACCESS_SECRET)));
    const get = (path, token) => fetch(api + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal((await get('/audit-logs/actions')).status, 401);
    assert.equal((await get('/audit-logs/actions', tokens[3])).status, 403);
    assert.deepEqual(await (await get(`/audit-logs/actions?tenantId=${tenantIds[1]}`, tokens[0])).json(), actions.slice().sort());
    assert.deepEqual(await (await get(`/audit-logs/actions?tenantId=${tenantIds[1]}`, tokens[2])).json(), ['FOREIGN_ONLY']);
    for (const action of actions) {
      const body = await (await get(`/audit-logs?action=${action}`, tokens[0])).json(); assert.equal(body.total, 1); assert.equal(body.items[0].action, action);
    }
    for (const [key, values] of [['page', ['', 'NaN', 'Infinity', '-1', '0', '100001']], ['limit', ['', 'NaN', 'Infinity', '-1', '0', '101']]]) {
      for (const value of values) assert.equal((await get(`/audit-logs?${key}=${encodeURIComponent(value)}`, tokens[0])).status, 400);
    }
    const first = await (await get('/audit-logs?page=1&limit=4', tokens[0])).json();
    const second = await (await get('/audit-logs?page=2&limit=4', tokens[0])).json();
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 7);
    assert.equal((await get('/audit-logs', tokens[3])).status, 403);
    assert.equal((await fetch(api + '/audit-logs', { method: 'POST', headers: { Authorization: `Bearer ${tokens[0]}` } })).status, 404);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantIds[0] } }), 7);
    await prisma.auditLog.createMany({ data: Array.from({ length: 26 }, () => ({ userId: userIds[0], tenantId: tenantIds[0], action: 'LOGIN' })) });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies([{ name: 'access_token', value: tokens[0], domain: 'localhost', path: '/' }]);
    const page = await context.newPage();
    await page.route('http://localhost:3001/**', async route => { const url = new URL(route.request().url()); const response = await fetch(api + url.pathname + url.search, { headers: { Authorization: `Bearer ${tokens[0]}` } }); await route.fulfill({ status: response.status, contentType: response.headers.get('content-type') || 'application/json', body: await response.text(), headers: { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true' } }); });
    const evidence = resolve('../.omo/evidence/audit-logs-v1-remediation'); mkdirSync(evidence, { recursive: true });
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://localhost:3000/audit-logs');
      await expect(page.locator('#action-filter option[value="ASM_ALERT_CREATED"]')).toHaveCount(1, { timeout: 30000 });
      const next = page.getByRole('button', { name: /Selanjutnya/ }); await expect(next).toBeVisible();
      assert.equal(await next.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), true, `pagination clipped at ${width}`);
      await page.screenshot({ path: `${evidence}/admin-${width}.png`, fullPage: true });
    }
    await page.locator('#action-filter').selectOption('ASM_ALERT_CREATED');
    await expect(page.getByText(/Menampilkan 1 dari total/)).toBeVisible();
    assert.equal(await page.locator('#action-filter').inputValue(), 'ASM_ALERT_CREATED');
    await page.screenshot({ path: `${evidence}/admin-filtered-1280.png`, fullPage: true });
  } finally {
    if (browser) await browser.close();
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.$disconnect(); await app.close();
  }
});
