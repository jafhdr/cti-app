const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const { IndicatorsService } = require('../../dist/src/indicators/indicators.service.js');
const { IndicatorsController } = require('../../dist/src/indicators/indicators.controller.js');
const { Prisma } = require('@prisma/client');

const actor = { sub: 'user-1', role: 'ADMIN', tenantId: 'tenant-1' };
const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: '203.0.113.10', type: 'IP_ADDRESS' };
const caseRecord = { id: 'case-1', tenantId: 'tenant-1', caseNumber: 'CASE-2026-00001', title: 'Suspicious login', status: 'OPEN', priority: 'HIGH', severity: 'HIGH' };

function fakePrisma() {
  const links = [];
  const activities = [];
  const audits = [];
  const tx = {
    caseIndicator: {
      create: async ({ data }) => {
        const link = { ...data, createdAt: new Date(), case: caseRecord };
        links.push(link);
        return link;
      },
      delete: async ({ where }) => {
        const key = where.caseId_indicatorId;
        const index = links.findIndex((item) => item.caseId === key.caseId && item.indicatorId === key.indicatorId);
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
    indicator: { findUnique: async ({ where }) => where.id === indicator.id ? indicator : null },
    case: {
      findFirst: async ({ where }) => where.id === caseRecord.id && where.tenantId === caseRecord.tenantId ? caseRecord : null,
      findMany: async ({ where }) => where.tenantId === indicator.tenantId ? [caseRecord] : [],
    },
    caseIndicator: {
      findMany: async ({ where }) => links.filter((item) => item.indicatorId === where.indicatorId && item.tenantId === where.tenantId),
      findUnique: async ({ where }) => {
        const key = where.caseId_indicatorId;
        return links.find((item) => item.caseId === key.caseId && item.indicatorId === key.indicatorId) ?? null;
      },
    },
    $transaction: async (operation) => operation(tx),
  };
}

test('Given a same-tenant Case, when it is linked to an Indicator, then the link, activity, and audit are persisted', async () => {
  const prisma = fakePrisma();
  const linked = await new IndicatorsService(prisma).linkCase(actor, indicator.id, caseRecord.id);
  assert.equal(linked.id, caseRecord.id);
  assert.equal(prisma.links.length, 1);
  assert.equal(prisma.activities[0].action, 'INDICATOR_LINKED');
  assert.equal(prisma.audits[0].action, 'INDICATOR_CASE_LINKED');
});

test('Given a linked Case, when related Cases are requested, then it is returned', async () => {
  const prisma = fakePrisma();
  const service = new IndicatorsService(prisma);
  await service.linkCase(actor, indicator.id, caseRecord.id);
  assert.deepEqual((await service.getCases(actor, indicator.id)).map((item) => item.id), [caseRecord.id]);
});

test('Given a search query, when available Cases are requested, then only same-tenant unlinked Cases are queried', async () => {
  const prisma = fakePrisma();
  let receivedWhere;
  prisma.case.findMany = async ({ where }) => { receivedWhere = where; return [caseRecord]; };
  const result = await new IndicatorsService(prisma).getAvailableCases(actor, indicator.id, 'suspicious');
  assert.equal(result[0].id, caseRecord.id);
  assert.equal(receivedWhere.tenantId, indicator.tenantId);
  assert.deepEqual(receivedWhere.indicators.none, { indicatorId: indicator.id });
});

test('Given an existing link, when the same Case is linked again, then no duplicate is created', async () => {
  const prisma = fakePrisma();
  const service = new IndicatorsService(prisma);
  await service.linkCase(actor, indicator.id, caseRecord.id);
  await assert.rejects(() => service.linkCase(actor, indicator.id, caseRecord.id), /sudah terhubung/);
  assert.equal(prisma.links.length, 1);
});

test('Given concurrent duplicate linking, when the database rejects the second create, then a conflict response is returned', async () => {
  const prisma = fakePrisma();
  prisma.caseIndicator.findUnique = async () => null;
  prisma.$transaction = async () => { throw new Prisma.PrismaClientKnownRequestError('duplicate link', { code: 'P2002', clientVersion: '6.14.0' }); };
  await assert.rejects(() => new IndicatorsService(prisma).linkCase(actor, indicator.id, caseRecord.id), (error) => error?.status === 409);
});

test('Given a Case from another tenant, when it is linked, then it is hidden as not found', async () => {
  const prisma = fakePrisma();
  prisma.case.findFirst = async () => null;
  await assert.rejects(() => new IndicatorsService(prisma).linkCase(actor, indicator.id, 'foreign-case'), /Case tidak ditemukan/);
  assert.equal(prisma.links.length, 0);
});

test('Given an Indicator from another tenant, when Related Cases are requested, then its existence is hidden as not found', async () => {
  const prisma = fakePrisma();
  prisma.indicator.findUnique = async () => ({ ...indicator, tenantId: 'tenant-2' });
  await assert.rejects(
    () => new IndicatorsService(prisma).getCases(actor, indicator.id),
    (error) => error?.status === 404 && error?.message === 'Indicator tidak ditemukan',
  );
});

test('Given a linked Case, when it is unlinked, then the link is removed and audit is persisted', async () => {
  const prisma = fakePrisma();
  const service = new IndicatorsService(prisma);
  await service.linkCase(actor, indicator.id, caseRecord.id);
  const result = await service.unlinkCase(actor, indicator.id, caseRecord.id);
  assert.equal(result.success, true);
  assert.equal(prisma.links.length, 0);
  assert.deepEqual(prisma.audits.map((item) => item.action), ['INDICATOR_CASE_LINKED', 'INDICATOR_CASE_UNLINKED']);
});

test('Given Indicator Case routes, then case-management access and mutation roles are enforced', () => {
  assert.equal(Reflect.getMetadata('requiredModule', IndicatorsController.prototype.getCases), 'case-management');
  assert.equal(Reflect.getMetadata('requiredModule', IndicatorsController.prototype.getAvailableCases), 'case-management');
  assert.equal(Reflect.getMetadata('requiredModule', IndicatorsController.prototype.linkCase), 'case-management');
  assert.equal(Reflect.getMetadata('requiredModule', IndicatorsController.prototype.unlinkCase), 'case-management');
  assert.deepEqual(Reflect.getMetadata('roles', IndicatorsController.prototype.getCases), ['SUPER_ADMIN', 'ADMIN', 'USER']);
  assert.deepEqual(Reflect.getMetadata('roles', IndicatorsController.prototype.linkCase), ['SUPER_ADMIN', 'ADMIN']);
  assert.deepEqual(Reflect.getMetadata('roles', IndicatorsController.prototype.unlinkCase), ['SUPER_ADMIN', 'ADMIN']);
});
