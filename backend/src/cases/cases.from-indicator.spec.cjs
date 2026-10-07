const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');

const { CasesController } = require('../../dist/src/cases/cases.controller.js');
const { CasesService } = require('../../dist/src/cases/cases.service.js');

const actor = { sub: 'admin-1', role: 'ADMIN', tenantId: 'tenant-1' };
const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: '203.0.113.10', type: 'IP_ADDRESS' };

function fakePrisma({ failLink = false, foreignIndicator = false } = {}) {
  const state = { cases: [], links: [], activities: [], audits: [] };
  const tx = {
    case: {
      count: async () => state.cases.length,
      create: async ({ data }) => {
        const record = { id: `case-${state.cases.length + 1}`, ...data };
        state.cases.push(record);
        return record;
      },
    },
    caseIndicator: {
      findUnique: async ({ where }) => state.links.find(link => link.caseId === where.caseId_indicatorId.caseId && link.indicatorId === where.caseId_indicatorId.indicatorId) ?? null,
      create: async ({ data }) => {
        if (failLink) throw new Error('link failed');
        state.links.push(data);
        return data;
      },
    },
    caseActivity: { create: async ({ data }) => { state.activities.push(data); return data; } },
    auditLog: { create: async ({ data }) => { state.audits.push(data); return data; } },
  };

  return {
    state,
    user: { findUnique: async () => ({ id: 'inactive-user', tenantId: indicator.tenantId, isActive: false }) },
    indicator: { findFirst: async ({ where }) => !foreignIndicator && where.id === indicator.id && where.tenantId === indicator.tenantId ? indicator : null },
    $transaction: async operation => {
      const snapshot = structuredClone(state);
      try {
        return await operation(tx);
      } catch (error) {
        state.cases = snapshot.cases;
        state.links = snapshot.links;
        state.activities = snapshot.activities;
        state.audits = snapshot.audits;
        throw error;
      }
    },
  };
}

test('Given a same-tenant Indicator, when a Case is created from it, then the Case and CaseIndicator are created atomically', async () => {
  const prisma = fakePrisma();
  const created = await new CasesService(prisma).createFromIndicator(actor, indicator.id, { title: 'Investigate IOC', priority: 'HIGH', severity: 'CRITICAL' });
  assert.equal(created.title, 'Investigate IOC');
  assert.equal(prisma.state.cases.length, 1);
  assert.deepEqual(prisma.state.links, [{ tenantId: indicator.tenantId, caseId: created.id, indicatorId: indicator.id, createdBy: actor.sub }]);
});

test('Given a foreign-tenant Indicator, when a Case is requested, then no Case is created', async () => {
  const prisma = fakePrisma({ foreignIndicator: true });
  await assert.rejects(() => new CasesService(prisma).createFromIndicator(actor, indicator.id, { title: 'Hidden IOC' }), /Indicator tidak ditemukan/);
  assert.equal(prisma.state.cases.length, 0);
});

test('Given a SUPER_ADMIN tenant workspace, when Indicator tenant matches, then Case is created in that tenant', async () => {
  const prisma = fakePrisma();
  const created = await new CasesService(prisma).createFromIndicator({ sub: 'root', role: 'SUPER_ADMIN' }, indicator.id, { title: 'Selected tenant', tenantId: indicator.tenantId });
  assert.equal(created.tenantId, indicator.tenantId);
  assert.equal(created.status, 'OPEN');
});

test('Given a SUPER_ADMIN tenant workspace, when Indicator belongs elsewhere, then the request is hidden', async () => {
  const prisma = fakePrisma();
  await assert.rejects(() => new CasesService(prisma).createFromIndicator({ sub: 'root', role: 'SUPER_ADMIN' }, indicator.id, { title: 'Wrong tenant', tenantId: 'tenant-2' }), { status: 404 });
  assert.equal(prisma.state.cases.length, 0);
});

test('Given a SUPER_ADMIN without tenant selection, when creating from Indicator, then the request is rejected', async () => {
  const prisma = fakePrisma();
  await assert.rejects(() => new CasesService(prisma).createFromIndicator({ sub: 'root', role: 'SUPER_ADMIN' }, indicator.id, { title: 'No tenant' }), { status: 400 });
});

test('Given an inactive assignee, when creating from Indicator, then no Case is created', async () => {
  const prisma = fakePrisma();
  await assert.rejects(() => new CasesService(prisma).createFromIndicator(actor, indicator.id, { title: 'Incident', assigneeId: 'inactive-user' }), { status: 404 });
  assert.equal(prisma.state.cases.length, 0);
});

test('Given linking fails, when a Case is created from an Indicator, then the transaction rolls back every write', async () => {
  const prisma = fakePrisma({ failLink: true });
  await assert.rejects(() => new CasesService(prisma).createFromIndicator(actor, indicator.id, { title: 'Rollback Case' }), /link failed/);
  assert.deepEqual(prisma.state, { cases: [], links: [], activities: [], audits: [] });
});

test('Given Case creation succeeds, when audit data is inspected, then creation and Indicator linking are both audited', async () => {
  const prisma = fakePrisma();
  await new CasesService(prisma).createFromIndicator(actor, indicator.id, { title: 'Audited Case' });
  assert.deepEqual(prisma.state.audits.map(entry => entry.action), ['CASE_CREATED', 'INDICATOR_CASE_LINKED']);
});

test('Given an unexpected duplicate link, when linking is attempted, then duplicate protection rejects it', async () => {
  const prisma = fakePrisma();
  prisma.state.links.push({ tenantId: indicator.tenantId, caseId: 'case-1', indicatorId: indicator.id, createdBy: actor.sub });
  await assert.rejects(() => new CasesService(prisma).createFromIndicator(actor, indicator.id, { title: 'Duplicate Guard' }), /sudah terhubung/);
});

test('Given the create-from-Indicator route, then Create Case roles and case-management access are enforced', () => {
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.createFromIndicator), ['SUPER_ADMIN', 'ADMIN']);
  assert.equal(Reflect.getMetadata('requiredModule', CasesController), 'case-management');
  assert.deepEqual(
    Reflect.getMetadata('__guards__', CasesController).map(guard => guard.name),
    ['AuthGuard', 'RolesGuard', 'ModuleAccessGuard', 'CaseTenantGuard'],
  );
});
