const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const { CasesService } = require('../../dist/src/cases/cases.service.js');
const { CasesController } = require('../../dist/src/cases/cases.controller.js');
const { Prisma } = require('@prisma/client');

const actor = { sub: 'user-1', role: 'ADMIN', tenantId: 'tenant-1' };
const baseCase = { id: 'case-1', tenantId: 'tenant-1', caseNumber: 'CASE-1' };
const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: '203.0.113.10', type: 'IP_ADDRESS', severity: 'HIGH', status: 'ACTIVE', tags: ['c2'], source: 'Feed' };

function fakePrisma() {
  const links = [];
  const activities = [];
  const audits = [];
  const tx = {
    caseIndicator: {
      create: async ({ data }) => {
        const link = { ...data, createdAt: new Date(), indicator };
        links.push(link);
        return link;
      },
      delete: async ({ where }) => {
        const index = links.findIndex((item) => item.caseId === where.caseId_indicatorId.caseId && item.indicatorId === where.caseId_indicatorId.indicatorId);
        return links.splice(index, 1)[0];
      },
    },
    caseActivity: { create: async ({ data }) => { activities.push(data); return data; } },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  return {
    links,
    activities,
    audits,
    case: { findFirst: async ({ where }) => where.id === baseCase.id && (!where.tenantId || where.tenantId === baseCase.tenantId) ? baseCase : null },
    indicator: {
      findFirst: async ({ where }) => indicator.id === where.id && indicator.tenantId === where.tenantId ? indicator : null,
      findMany: async ({ where }) => where.tenantId === baseCase.tenantId && !where.cases?.none ? [indicator] : [],
    },
    caseIndicator: {
      findMany: async ({ where }) => links.filter((item) => item.caseId === where.caseId && item.tenantId === where.tenantId),
      findUnique: async ({ where }) => links.find((item) => item.caseId === where.caseId_indicatorId.caseId && item.indicatorId === where.caseId_indicatorId.indicatorId) ?? null,
    },
    $transaction: async (operation) => operation(tx),
  };
}

test('Given an existing same-tenant indicator, when it is linked, then the relation, activity, and audit are persisted', async () => {
  const prisma = fakePrisma();
  const linked = await new CasesService(prisma).linkIndicator(actor, baseCase.id, indicator.id);
  assert.equal(linked.id, indicator.id);
  assert.equal(prisma.links.length, 1);
  assert.equal(prisma.activities[0].action, 'INDICATOR_LINKED');
  assert.equal(prisma.audits[0].action, 'CASE_INDICATOR_LINKED');
});

test('Given a linked indicator, when linked indicators are requested, then the existing indicator record is returned', async () => {
  const prisma = fakePrisma();
  const service = new CasesService(prisma);
  await service.linkIndicator(actor, baseCase.id, indicator.id);
  assert.deepEqual((await service.getIndicators(actor, baseCase.id)).map((item) => item.id), [indicator.id]);
});

test('Given a linked indicator, when it is unlinked, then the relation is removed and activity and audit are persisted', async () => {
  const prisma = fakePrisma();
  const service = new CasesService(prisma);
  await service.linkIndicator(actor, baseCase.id, indicator.id);
  const result = await service.unlinkIndicator(actor, baseCase.id, indicator.id);
  assert.equal(result.success, true);
  assert.equal(prisma.links.length, 0);
  assert.deepEqual(prisma.activities.map((item) => item.action), ['INDICATOR_LINKED', 'INDICATOR_UNLINKED']);
  assert.deepEqual(prisma.audits.map((item) => item.action), ['CASE_INDICATOR_LINKED', 'CASE_INDICATOR_UNLINKED']);
});

test('Given an indicator in another tenant, when it is linked, then it is hidden as not found', async () => {
  const prisma = fakePrisma();
  prisma.indicator.findFirst = async () => null;
  await assert.rejects(() => new CasesService(prisma).linkIndicator(actor, baseCase.id, 'foreign-indicator'), /Indicator tidak ditemukan/);
  assert.equal(prisma.links.length, 0);
});

test('Given a non-existent indicator, when it is linked, then it is rejected without audit or activity', async () => {
  const prisma = fakePrisma();
  await assert.rejects(() => new CasesService(prisma).linkIndicator(actor, baseCase.id, 'missing'), /Indicator tidak ditemukan/);
  assert.equal(prisma.activities.length, 0);
  assert.equal(prisma.audits.length, 0);
});

test('Given an existing relation, when the same indicator is linked again, then no duplicate relation is created', async () => {
  const prisma = fakePrisma();
  const service = new CasesService(prisma);
  await service.linkIndicator(actor, baseCase.id, indicator.id);
  await assert.rejects(() => service.linkIndicator(actor, baseCase.id, indicator.id), /sudah terhubung/);
  assert.equal(prisma.links.length, 1);
});

test('Given concurrent duplicate linking, when the database rejects the second create, then a conflict response is returned', async () => {
  const prisma = fakePrisma();
  prisma.caseIndicator.findUnique = async () => null;
  prisma.$transaction = async () => { throw new Prisma.PrismaClientKnownRequestError('duplicate link', { code: 'P2002', clientVersion: '6.14.0' }); };
  await assert.rejects(() => new CasesService(prisma).linkIndicator(actor, baseCase.id, indicator.id), (error) => error?.status === 409);
});

test('Given Case Indicator routes, then module access and mutation roles remain enforced', () => {
  assert.equal(Reflect.getMetadata('requiredModule', CasesController), 'case-management');
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.getIndicators), ['SUPER_ADMIN', 'ADMIN', 'USER']);
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.linkIndicator), ['SUPER_ADMIN', 'ADMIN']);
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.unlinkIndicator), ['SUPER_ADMIN', 'ADMIN']);
});
