const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const { NestFactory } = require('@nestjs/core');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require('./dist/src/app.module.js');

process.env.JWT_ACCESS_SECRET = 'case-v2-p1d-qa-access-secret';
process.env.JWT_REFRESH_SECRET = 'case-v2-p1d-qa-refresh-secret';
const prisma = new PrismaClient();
const marker = `p1d-${Date.now()}`;
const password = 'CaseQaPass123!';

async function setup(label) {
  const tenant = await prisma.tenant.create({ data: { name: `${label} ${marker}`, slug: `${label}-${marker}` } });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name: `${label} analyst`, email: `${label}-${marker}@example.test`, passwordHash, role: 'ADMIN', tenantId: tenant.id } });
  const team = await prisma.subscriptionPackage.findUniqueOrThrow({ where: { name: 'Team' } });
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, packageId: team.id, billingCycle: 'YEARLY', priceMonthly: team.priceMonthly, priceYearly: team.priceYearly, status: 'ACTIVE', renewalAt: new Date(Date.now()+365*86400000) } });
  const module = await prisma.appModule.findUniqueOrThrow({ where: { slug: 'case-management' }, include: { features: true } });
  const setting = await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id, isEnabled: true } });
  await prisma.moduleRoleAccess.create({ data: { tenantModuleId: setting.id, role: 'ADMIN', isAllowed: true } });
  await prisma.userModuleAccess.create({ data: { userId: user.id, tenantId: tenant.id, moduleId: module.id, featureKeys: module.features.map(f => f.key) } });
  return { tenant, user };
}

async function main() {
  const a = await setup('a');
  const b = await setup('b');
  const now = Date.now();
  const create = (tenant, user, suffix, status, dueAt, assigneeId = null) => prisma.case.create({ data: { tenantId: tenant.id, caseNumber: `${marker}-${suffix}`, title: `QA ${suffix}`, createdBy: user.id, status, dueAt, assigneeId, createdAt: new Date(now-86400000) } });
  const open = await create(a.tenant, a.user, 'open', 'OPEN', new Date(now-3600000), a.user.id);
  const progressing = await create(a.tenant, a.user, 'progress', 'IN_PROGRESS', new Date(now+86400000));
  const resolved = await create(a.tenant, a.user, 'resolved', 'RESOLVED', null);
  const closed = await create(a.tenant, a.user, 'closed', 'CLOSED', null);
  await create(b.tenant, b.user, 'foreign', 'OPEN', new Date(now-3600000));
  await prisma.caseActivity.create({ data: { tenantId: a.tenant.id, caseId: resolved.id, action: 'CASE_STATUS_CHANGED', metadata: { toStatus: 'RESOLVED' }, createdAt: new Date(now-3600000) } });
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const call = async (path, cookie) => { const response = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} }); return { status: response.status, body: await response.json() }; };
  const login = async email => { const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }); assert.equal(response.status, 201); return response.headers.get('set-cookie').split(';')[0]; };
  try {
    const cookieA = await login(a.user.email);
    const cookieB = await login(b.user.email);
    const root = await login('superadmin@cti.local');
    const path = '/cases/v2/operations/summary';
    process.env.CASE_V2_REPORTING_ENABLED = 'false';
    assert.equal((await call(path, cookieA)).status, 403);
    process.env.CASE_V2_REPORTING_ENABLED = 'true';
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path, root)).status, 400);
    const summary = await call(path, cookieA);
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.deepEqual(summary.body.counts, { total: 4, OPEN: 1, IN_PROGRESS: 1, RESOLVED: 1, CLOSED: 1 });
    assert.equal(summary.body.overdue.count, 1);
    assert.equal(summary.body.overdue.approachingSevenDays, 1);
    assert.equal(summary.body.overdue.missingDue, 0);
    assert.equal(summary.body.workload.byAssignee.find(x => x.assigneeId === null).count, 1);
    assert.equal(summary.body.resolution.first.samples, 1);
    assert.equal(summary.body.origins.LEGACY_UNKNOWN, 4);
    assert.equal(summary.body.limitations.missingFirstClosure, 1);
    assert.equal((await call(path, cookieB)).body.counts.total, 1);
    assert.equal((await call(`${path}?tenantId=${b.tenant.id}`, cookieA)).status, 404);
    assert.equal((await call(`${path}?tenantId=${a.tenant.id}`, root)).body.counts.total, 4);
    assert.equal((await call(`${path}?status=OPEN`, cookieA)).body.counts.total, 1);
    assert.equal((await call(`${path}?origin=LEGACY_UNKNOWN`, cookieA)).body.counts.total, 4);
    assert.equal((await call(`${path}?assigneeId=unassigned`, cookieA)).body.counts.total, 3);
    assert.equal((await call(`${path}?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z`, cookieA)).status, 200);
    assert.equal((await call(`${path}?from=2027-01-01T00:00:00Z&to=2026-01-01T00:00:00Z`, cookieA)).status, 400);
    const queue = await call('/cases/v2/operations/queue?queue=OVERDUE', cookieA);
    assert.equal(queue.status, 200, JSON.stringify(queue.body));
    assert.equal(queue.body.total, 1);
    assert.equal(queue.body.items[0].id, open.id);
    assert.equal((await call('/cases/v2/operations/queue?queue=APPROACHING', cookieA)).body.items[0].id, progressing.id);
    assert.equal((await call('/cases/v2/operations/queue?limit=1&page=2', cookieA)).body.items.length, 1);
    assert.equal((await call('/cases/v2/operations/queue?limit=101', cookieA)).status, 400);
    assert.equal((await prisma.case.count({ where: { tenantId: a.tenant.id } })), 4);
    console.log(JSON.stringify({ verdict: 'PASS', tenantA: a.tenant.id, tenantB: b.tenant.id, adminEmail: a.user.email, caseId: open.id, checks: 27 }));
  } finally { await app.close(); await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
