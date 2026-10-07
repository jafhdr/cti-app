const assert = require('node:assert/strict');
const test = require('node:test');
const { CasesService } = require('../../dist/src/cases/cases.service.js');

const user = { sub: 'admin-1', role: 'ADMIN', tenantId: 'tenant-1' };

function fixture() {
  let record = { id: 'case-1', tenantId: user.tenantId, caseNumber: 'CASE-1', title: 'Incident', status: 'OPEN' };
  const activities = [];
  const prisma = {
    tenant: { findUnique: async () => ({ id: user.tenantId }) },
    user: { findUnique: async () => ({ id: 'inactive-user', tenantId: user.tenantId, isActive: false }) },
    case: {
      count: async () => 0,
      findFirst: async () => record,
      create: async ({ data }) => { record = { ...record, ...data }; return record; },
      update: async ({ data }) => { record = { ...record, ...data }; return record; },
    },
    auditLog: { create: async () => ({}) },
    caseActivity: { create: async ({ data }) => { activities.push(data); return data; } },
  };
  prisma.$transaction = async operation => operation(prisma);
  return { service: new CasesService(prisma), activities, current: () => record };
}

test('Given a client supplied final status, when creating a Case, then it starts OPEN', async () => {
  const { service, current } = fixture();
  await service.create(user, { title: 'Incident', status: 'CLOSED' });
  assert.equal(current().status, 'OPEN');
});

for (const [from, to] of [
  ['OPEN', 'IN_PROGRESS'],
  ['IN_PROGRESS', 'RESOLVED'],
  ['RESOLVED', 'CLOSED'],
  ['RESOLVED', 'IN_PROGRESS'],
]) {
  test(`Given ${from}, when status changes to ${to}, then activity records the transition`, async () => {
    const { service, activities } = fixture();
    const path = from === 'RESOLVED' ? ['IN_PROGRESS', 'RESOLVED'] : from === 'IN_PROGRESS' ? ['IN_PROGRESS'] : [];
    for (const status of path) await service.update(user, 'case-1', { status });
    activities.length = 0;
    await service.update(user, 'case-1', { status: to });
    const transition = activities.filter(item => item.action === 'CASE_STATUS_CHANGED');
    assert.equal(transition.length, 1);
    assert.deepEqual(transition[0].metadata, { fromStatus: from, toStatus: to });
    assert.equal(transition[0].actorId, user.sub);
  });
}

for (const [from, to] of [['OPEN', 'CLOSED'], ['CLOSED', 'IN_PROGRESS'], ['IN_PROGRESS', 'OPEN']]) {
  test(`Given ${from}, when status changes to ${to}, then the transition is rejected`, async () => {
    const { service, activities, current } = fixture();
    const path = from === 'CLOSED' ? ['IN_PROGRESS', 'RESOLVED', 'CLOSED'] : from === 'IN_PROGRESS' ? ['IN_PROGRESS'] : [];
    for (const status of path) await service.update(user, 'case-1', { status });
    activities.length = 0;
    await assert.rejects(() => service.update(user, 'case-1', { status: to }), { status: 400 });
    assert.equal(current().status, from);
    assert.equal(activities.length, 0);
  });
}

test('Given unchanged status, when a Case is edited, then no status event is written', async () => {
  const { service, activities } = fixture();
  await service.update(user, 'case-1', { status: 'OPEN', title: 'Updated' });
  assert.equal(activities.filter(item => item.action === 'CASE_STATUS_CHANGED').length, 0);
});

test('Given an inactive assignee, when a Case is created or edited, then assignment is rejected', async () => {
  const { service, current } = fixture();
  await assert.rejects(() => service.create(user, { title: 'Incident', assigneeId: 'inactive-user' }), { status: 404 });
  await assert.rejects(() => service.update(user, 'case-1', { assigneeId: 'inactive-user' }), { status: 404 });
  assert.equal(current().assigneeId, undefined);
});
