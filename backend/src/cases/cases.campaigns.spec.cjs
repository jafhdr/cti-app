const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const { CasesService } = require('../../dist/src/cases/cases.service.js');
const { CasesController } = require('../../dist/src/cases/cases.controller.js');

const actor = { sub: 'user-1', role: 'ADMIN', tenantId: 'tenant-1' };
const baseCase = { id: 'case-1', tenantId: 'tenant-1', caseNumber: 'CASE-1' };
const campaign = { id: 'campaign-1', tenantId: 'tenant-1', name: 'Operation Example', description: 'Tracked campaign', objective: 'Credential theft', status: 'ACTIVE', severity: 'HIGH', confidence: 80, externalId: 'C9999', threatActor: { entity: { name: 'Example Group' } } };

function fakePrisma() {
  const links = [];
  const activities = [];
  const audits = [];
  const tx = {
    caseCampaign: {
      create: async ({ data }) => { const link = { ...data, createdAt: new Date(), campaign }; links.push(link); return link; },
      delete: async ({ where }) => { const key = where.caseId_campaignId; const index = links.findIndex((item) => item.caseId === key.caseId && item.campaignId === key.campaignId); return links.splice(index, 1)[0]; },
    },
    caseActivity: { create: async ({ data }) => { activities.push(data); return data; } },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  return {
    links, activities, audits,
    case: { findFirst: async ({ where }) => where.id === baseCase.id && (!where.tenantId || where.tenantId === baseCase.tenantId) ? baseCase : null },
    campaign: {
      findFirst: async ({ where }) => campaign.id === where.id && campaign.tenantId === where.tenantId ? campaign : null,
      findMany: async ({ where }) => where.tenantId === baseCase.tenantId ? [campaign] : [],
    },
    caseCampaign: {
      findMany: async ({ where }) => links.filter((item) => item.caseId === where.caseId && item.tenantId === where.tenantId),
      findUnique: async ({ where }) => { const key = where.caseId_campaignId; return links.find((item) => item.caseId === key.caseId && item.campaignId === key.campaignId) ?? null; },
    },
    $transaction: async (operation) => operation(tx),
  };
}

test('Given an existing same-tenant campaign, when linked, then relation, activity, and audit are persisted', async () => {
  const prisma = fakePrisma();
  const linked = await new CasesService(prisma).linkCampaign(actor, baseCase.id, campaign.id);
  assert.equal(linked.id, campaign.id); assert.equal(prisma.links.length, 1);
  assert.equal(prisma.activities[0].action, 'CAMPAIGN_LINKED'); assert.equal(prisma.audits[0].action, 'CASE_CAMPAIGN_LINKED');
});

test('Given a linked campaign, when listed and then unlinked, then the relation and audit trail are correct', async () => {
  const prisma = fakePrisma(); const service = new CasesService(prisma);
  await service.linkCampaign(actor, baseCase.id, campaign.id);
  assert.deepEqual((await service.getCampaigns(actor, baseCase.id)).map((item) => item.id), [campaign.id]);
  assert.deepEqual(await service.unlinkCampaign(actor, baseCase.id, campaign.id), { success: true });
  assert.equal(prisma.links.length, 0); assert.equal(prisma.activities[1].action, 'CAMPAIGN_UNLINKED'); assert.equal(prisma.audits[1].action, 'CASE_CAMPAIGN_UNLINKED');
});

test('Given a search term, when available campaigns are requested, then tenant, exclusion, and search filters are applied', async () => {
  const prisma = fakePrisma(); let capturedWhere;
  prisma.campaign.findMany = async ({ where }) => { capturedWhere = where; return [campaign]; };
  assert.equal((await new CasesService(prisma).getAvailableCampaigns(actor, baseCase.id, 'operation'))[0].id, campaign.id);
  assert.equal(capturedWhere.tenantId, baseCase.tenantId); assert.equal(capturedWhere.cases.none.caseId, baseCase.id); assert.equal(capturedWhere.OR[0].name.contains, 'operation');
});

test('Given a foreign or missing campaign, when linked, then it is hidden as not found', async () => {
  const prisma = fakePrisma(); prisma.campaign.findFirst = async () => null;
  await assert.rejects(() => new CasesService(prisma).linkCampaign(actor, baseCase.id, 'foreign-or-missing'), /Campaign tidak ditemukan/);
  assert.equal(prisma.activities.length, 0); assert.equal(prisma.audits.length, 0);
});

test('Given an existing campaign relation, when linked again, then no duplicate is created', async () => {
  const prisma = fakePrisma(); const service = new CasesService(prisma);
  await service.linkCampaign(actor, baseCase.id, campaign.id);
  await assert.rejects(() => service.linkCampaign(actor, baseCase.id, campaign.id), /sudah terhubung/);
  assert.equal(prisma.links.length, 1);
});

test('Given Case Campaign routes, then module access and mutation roles are enforced', () => {
  assert.equal(Reflect.getMetadata('requiredModule', CasesController), 'case-management');
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.getCampaigns), ['SUPER_ADMIN', 'ADMIN', 'USER']);
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.getAvailableCampaigns), ['SUPER_ADMIN', 'ADMIN', 'USER']);
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.linkCampaign), ['SUPER_ADMIN', 'ADMIN']);
  assert.deepEqual(Reflect.getMetadata('roles', CasesController.prototype.unlinkCampaign), ['SUPER_ADMIN', 'ADMIN']);
});
