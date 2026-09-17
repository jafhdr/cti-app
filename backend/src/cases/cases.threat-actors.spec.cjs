const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const { CasesService } = require('../../dist/src/cases/cases.service.js');
const { CasesController } = require('../../dist/src/cases/cases.controller.js');

const actor = { sub: 'user-1', role: 'ADMIN', tenantId: 'tenant-1' };
const baseCase = { id: 'case-1', tenantId: 'tenant-1', caseNumber: 'CASE-1' };
const threatActor = {
  id: 'actor-1', tenantId: 'tenant-1', aliases: ['APT Example'], motivation: 'Espionage', targetSectors: ['Finance'], country: 'ID', region: 'SEA', status: 'ACTIVE',
  entity: { id: 'entity-1', name: 'Example Group', description: 'Tracked group', externalId: 'G9999', confidence: 80, severity: 'HIGH' },
};

function fakePrisma() {
  const links = [];
  const activities = [];
  const audits = [];
  const tx = {
    caseThreatActor: {
      create: async ({ data }) => {
        const link = { ...data, createdAt: new Date(), threatActor };
        links.push(link);
        return link;
      },
      delete: async ({ where }) => {
        const key = where.caseId_threatActorId;
        const index = links.findIndex((item) => item.caseId === key.caseId && item.threatActorId === key.threatActorId);
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
    threatActor: {
      findFirst: async ({ where }) => threatActor.id === where.id && threatActor.tenantId === where.tenantId ? threatActor : null,
      findMany: async ({ where }) => where.tenantId === baseCase.tenantId ? [threatActor] : [],
    },
    caseThreatActor: {
      findMany: async ({ where }) => links.filter((item) => item.caseId === where.caseId && item.tenantId === where.tenantId),
      findUnique: async ({ where }) => {
        const key = where.caseId_threatActorId;
        return links.find((item) => item.caseId === key.caseId && item.threatActorId === key.threatActorId) ?? null;
      },
    },
    $transaction: async (operation) => operation(tx),
  };
}

test('Given an existing same-tenant threat actor, when linked, then relation, activity, and audit are persisted', async () => {
  const prisma = fakePrisma();
  const linked = await new CasesService(prisma).linkThreatActor(actor, baseCase.id, threatActor.id);
  assert.equal(linked.id, threatActor.id);
  assert.equal(prisma.links.length, 1);
  assert.equal(prisma.activities[0].action, 'THREAT_ACTOR_LINKED');
  assert.equal(prisma.audits[0].action, 'CASE_THREAT_ACTOR_LINKED');
});

test('Given a linked threat actor, when the list is requested, then its profile is returned', async () => {
  const prisma = fakePrisma();
  const service = new CasesService(prisma);
  await service.linkThreatActor(actor, baseCase.id, threatActor.id);
  assert.deepEqual((await service.getThreatActors(actor, baseCase.id)).map((item) => item.id), [threatActor.id]);
});

test('Given a linked threat actor, when unlinked, then relation is removed and activity and audit are persisted', async () => {
  const prisma = fakePrisma();
  const service = new CasesService(prisma);
  await service.linkThreatActor(actor, baseCase.id, threatActor.id);
  assert.deepEqual(await service.unlinkThreatActor(actor, baseCase.id, threatActor.id), { success: true });
  assert.equal(prisma.links.length, 0);
  assert.deepEqual(prisma.activities.map((item) => item.action), ['THREAT_ACTOR_LINKED', 'THREAT_ACTOR_UNLINKED']);
  assert.deepEqual(prisma.audits.map((item) => item.action), ['CASE_THREAT_ACTOR_LINKED', 'CASE_THREAT_ACTOR_UNLINKED']);
});

test('Given a search term, when available threat actors are requested, then tenant and search filters are applied', async () => {
  const prisma = fakePrisma();
  let capturedWhere;
  prisma.threatActor.findMany = async ({ where }) => { capturedWhere = where; return [threatActor]; };
  const result = await new CasesService(prisma).getAvailableThreatActors(actor, baseCase.id, 'example');
  assert.equal(result[0].id, threatActor.id);
  assert.equal(capturedWhere.tenantId, baseCase.tenantId);
  assert.equal(capturedWhere.cases.none.caseId, baseCase.id);
  assert.equal(capturedWhere.OR[0].entity.name.contains, 'example');
});

test('Given a threat actor in another tenant or missing, when linked, then it is hidden as not found', async () => {
  const prisma = fakePrisma();
  prisma.threatActor.findFirst = async () => null;
  await assert.rejects(() => new CasesService(prisma).linkThreatActor(actor, baseCase.id, 'foreign-or-missing'), /Threat Actor tidak ditemukan/);
  assert.equal(prisma.activities.length, 0);
  assert.equal(prisma.audits.length, 0);
});

test('Given an existing relation, when linked again, then no duplicate is created', async () => {
  const prisma = fakePrisma();
  const service = new CasesService(prisma);
  await service.linkThreatActor(actor, baseCase.id, threatActor.id);
  await assert.rejects(() => service.linkThreatActor(actor, baseCase.id, threatActor.id), /sudah terhubung/);
  assert.equal(prisma.links.length, 1);
});

test('Given Case Threat Actor routes, then module access and mutation roles are enforced', () => {
  assert.equal(Reflect.getMetadata('requiredModule', CasesController), 'case-management');
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.getThreatActors), ['SUPER_ADMIN', 'ADMIN', 'USER']);
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.getAvailableThreatActors), ['SUPER_ADMIN', 'ADMIN', 'USER']);
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.linkThreatActor), ['SUPER_ADMIN', 'ADMIN']);
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.unlinkThreatActor), ['SUPER_ADMIN', 'ADMIN']);
});
