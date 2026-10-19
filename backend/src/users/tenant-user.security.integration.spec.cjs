const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { chromium, expect } = require('../../../frontend/node_modules/@playwright/test');
const { AuthModule } = require('../../dist/src/auth/auth.module');
const { UsersModule } = require('../../dist/src/users/users.module');
const { TenantsModule } = require('../../dist/src/tenants/tenants.module');

test('tenant status and admin password reset revoke access on live HTTP and PostgreSQL', { timeout: 180000 }, async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, UsersModule, TenantsModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser()); app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const prisma = new PrismaClient();
  const suffix = randomUUID();
  const tenantIds = []; const userIds = [];
  let browser;
  try {
    await app.listen(0, '127.0.0.1');
    const api = `http://localhost:${app.getHttpServer().address().port}`;
    const oldPassword = `Old-${suffix}`; const newPassword = `New-${suffix}`;
    const hash = await bcrypt.hash(oldPassword, 4);
    const root = await prisma.user.create({ data: { name: 'Tenant Security QA Root', email: `root-${suffix}@example.test`, passwordHash: hash, role: 'SUPER_ADMIN' } }); userIds.push(root.id);
    const accounts = [];
    for (const label of ['a', 'b']) {
      const tenant = await prisma.tenant.create({ data: { name: `Tenant Security QA ${label}`, slug: `tenant-security-qa-${label}-${suffix}` } }); tenantIds.push(tenant.id);
      for (const role of ['ADMIN', 'USER']) {
        const user = await prisma.user.create({ data: { name: `Tenant Security QA ${role}`, email: `${label}-${role.toLowerCase()}-${suffix}@example.test`, passwordHash: hash, role, tenantId: tenant.id } });
        accounts.push(user); userIds.push(user.id);
      }
    }
    const [adminA, userA, adminB, userB] = accounts;
    const send = (path, method = 'GET', body, cookie = '') => fetch(api + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = (account, password = oldPassword) => send('/auth/login', 'POST', { email: account.email, password });
    const cookie = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const rootCookie = cookie(await login(root));
    const adminCookie = cookie(await login(adminA));
    const adminBCookie = cookie(await login(adminB));
    const userCookies = [cookie(await login(userA)), cookie(await login(userA))];
    const userBCookie = cookie(await login(userB));
    assert.equal((await send('/auth/me', 'GET', undefined, adminCookie)).status, 200);

    let signalLocked; let releaseLock;
    const locked = new Promise(resolve => { signalLocked = resolve; });
    const unlocked = new Promise(resolve => { releaseLock = resolve; });
    const transition = prisma.$transaction(async tx => {
      await tx.tenant.update({ where: { id: tenantIds[0] }, data: { isActive: false, deactivatedAt: new Date() } });
      signalLocked();
      await unlocked;
    });
    await locked;
    const racingLogin = login(adminA);
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await prisma.authSession.count({ where: { userId: adminA.id } }), 1);
    } finally {
      releaseLock();
    }
    await transition;
    assert.equal((await racingLogin).status, 401, 'login must observe the committed inactive tenant');
    assert.equal(await prisma.authSession.count({ where: { userId: adminA.id } }), 1);
    assert.equal((await send(`/tenants/${tenantIds[0]}/status`, 'PATCH', { isActive: true }, rootCookie)).status, 200);

    assert.equal((await send(`/tenants/${tenantIds[0]}/status`, 'PATCH', { isActive: false }, rootCookie)).status, 200);
    assert.equal((await send('/auth/me', 'GET', undefined, adminCookie)).status, 401);
    assert.equal((await send('/auth/refresh', 'POST', undefined, adminCookie)).status, 401);
    const sessionsBefore = await prisma.authSession.count({ where: { userId: adminA.id } });
    const loginAuditBefore = await prisma.auditLog.count({ where: { userId: adminA.id, action: 'LOGIN' } });
    const denied = await login(adminA);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.getSetCookie().length, 0);
    assert.equal(await prisma.authSession.count({ where: { userId: adminA.id } }), sessionsBefore);
    assert.equal(await prisma.auditLog.count({ where: { userId: adminA.id, action: 'LOGIN' } }), loginAuditBefore);
    assert.equal((await send('/auth/me', 'GET', undefined, userCookies[0])).status, 401);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('http://localhost:3001/**', route => {
      const url = new URL(route.request().url());
      return route.continue({ url: api + url.pathname + url.search });
    });
    await page.goto('http://localhost:3000/login');
    await page.getByLabel('Email address').fill(adminA.email);
    await page.getByLabel('Password', { exact: true }).fill(oldPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Tenant akun ini sudah dinonaktifkan')).toBeVisible();

    assert.equal((await send(`/tenants/${tenantIds[0]}/status`, 'PATCH', { isActive: true }, rootCookie)).status, 200);
    const reactivated = await login(adminA); assert.equal(reactivated.status, 201);
    assert.equal((await send('/auth/me', 'GET', undefined, adminCookie)).status, 200, 'tenant reactivation restores the old unrevoked session');
    assert.equal((await send('/auth/me', 'GET', undefined, cookie(reactivated))).status, 200);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    assert.equal(await page.evaluate(async () => (await fetch('http://localhost:3001/auth/me', { credentials: 'include' })).status), 200);
    await context.close(); await browser.close(); browser = undefined;

    const beforeForeign = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
    const foreignSessions = await prisma.authSession.count({ where: { userId: userB.id, revokedAt: null } });
    const foreignAudit = await prisma.auditLog.count({ where: { action: 'USER_PASSWORD_RESET_BY_ADMIN', userId: adminA.id } });
    assert.equal((await send(`/users/${userB.id}/password`, 'PATCH', { password: newPassword }, adminCookie)).status, 403);
    assert.equal((await send(`/users/${userA.id}/password`, 'PATCH', { password: newPassword }, userCookies[0])).status, 403);
    const afterForeign = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
    assert.equal(afterForeign.passwordHash, beforeForeign.passwordHash);
    assert.equal(afterForeign.sessionVersion, beforeForeign.sessionVersion);
    assert.equal(await prisma.authSession.count({ where: { userId: userB.id, revokedAt: null } }), foreignSessions);
    assert.equal(await prisma.auditLog.count({ where: { action: 'USER_PASSWORD_RESET_BY_ADMIN', userId: adminA.id } }), foreignAudit);
    assert.equal((await send('/auth/me', 'GET', undefined, userBCookie)).status, 200);

    const oldSessions = await prisma.authSession.findMany({ where: { userId: userA.id, revokedAt: null } });
    assert.equal(oldSessions.length, 2);
    const oldVersion = (await prisma.user.findUniqueOrThrow({ where: { id: userA.id } })).sessionVersion;
    assert.equal((await send(`/users/${userA.id}/password`, 'PATCH', { password: newPassword }, adminCookie)).status, 200);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    assert.equal(updated.sessionVersion, oldVersion + 1);
    const revoked = await prisma.authSession.findMany({ where: { id: { in: oldSessions.map(session => session.id) } } });
    assert.equal(revoked.every(session => session.revokedAt !== null), true);
    for (const stale of userCookies) {
      assert.equal((await send('/auth/me', 'GET', undefined, stale)).status, 401);
      assert.equal((await send('/auth/refresh', 'POST', undefined, stale)).status, 401);
    }
    assert.equal((await login(userA)).status, 401);
    const fresh = await login(userA, newPassword); assert.equal(fresh.status, 201);
    assert.equal((await send('/auth/me', 'GET', undefined, cookie(fresh))).status, 200);
    assert.equal((await send(`/users/${adminB.id}/password`, 'PATCH', { password: newPassword }, rootCookie)).status, 200);
    assert.equal((await send('/auth/me', 'GET', undefined, adminBCookie)).status, 401);
    assert.equal((await send('/auth/refresh', 'POST', undefined, adminBCookie)).status, 401);
    assert.equal((await login(adminB, newPassword)).status, 201);
    console.log('live security: inactive and racing login 401/no cookie/no session/no LOGIN audit; tenant reactivation 201; old access/refresh 401; admin reset revoked 2/2 sessions; foreign/USER writes 403/no mutation; SUPER_ADMIN cross-tenant reset 200; browser login active/inactive PASS');
  } finally {
    if (browser) await browser.close();
    await app.close();
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { tenantId: { in: tenantIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.$disconnect();
  }
});
