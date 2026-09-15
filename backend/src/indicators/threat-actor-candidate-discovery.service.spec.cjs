require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { ForbiddenException } = require('@nestjs/common');
const { ThreatActorAttributionService } = require('../../dist/src/indicators/threat-actor-attribution.service.js');

const user = { sub: 'user-1', role: 'ADMIN', tenantId: 'tenant-1' };

function actor(id, options = {}) {
  return {
    id,
    entityId: `entity-${id}`,
    aliases: options.aliases || [],
    targetSectors: [],
    entity: {
      tenantId: options.entityTenantId || 'tenant-1',
      name: options.name || id,
      externalId: null,
      metadata: null,
      indicators: options.indicators || [],
    },
    campaigns: options.campaignIds?.map(campaignId => ({ id: campaignId })) || [],
    intelligenceReports: options.reportIds?.map(reportId => ({ reportId })) || [],
  };
}

function prismaFor(indicator, actors = [], enrichments = [], sources = []) {
  const actorQueries = [];
  const sourceQueries = [];
  const writes = [];
  return {
    actorQueries,
    sourceQueries,
    writes,
    indicator: {
      findUnique: async () => indicator,
      update: async input => { writes.push(input); },
      create: async input => { writes.push(input); },
    },
    intelligenceSource: {
      findFirst: async query => {
        sourceQueries.push(query);
        return sources.find(source => source.id === query.where.id && source.tenantId === query.where.tenantId) || null;
      },
    },
    indicatorEnrichment: { findMany: async () => enrichments },
    threatActor: {
      findMany: async query => {
        actorQueries.push(query);
        return actors.filter(item => item.entity.tenantId === query.where.tenantId);
      },
      create: async input => { writes.push(input); },
    },
    auditLog: { create: async input => { writes.push(input); } },
  };
}

function indicator(overrides = {}) {
  return {
    id: 'indicator-1', tenantId: 'tenant-1', value: 'evil.example', type: 'DOMAIN',
    tags: [], source: null, intelligenceSource: null, intelligenceEntityId: null,
    ...overrides,
  };
}

test('Given an exact structured indicator, when discovery runs, then the actor is returned without writes', async () => {
  const prisma = prismaFor(indicator(), [actor('actor-1', { name: 'Exact Actor', indicators: [{ type: 'DOMAIN', value: 'EVIL.EXAMPLE.' }] })]);

  const result = await new ThreatActorAttributionService(prisma).discover(user, 'indicator-1');

  assert.equal(result.status, 'CANDIDATES');
  assert.deepEqual(result.candidates[0], {
    threatActorId: 'actor-1', name: 'Exact Actor', score: 70, confidence: 'HIGH',
    evidence: [{ type: 'EXACT_INDICATOR', value: 'evil.example' }],
  });
  assert.equal(prisma.writes.length, 0);
});

test('Given a campaign relation, when discovery runs, then campaign evidence produces a candidate', async () => {
  const prisma = prismaFor(indicator(), [actor('actor-1', { campaignIds: ['campaign-1'] })]);
  const result = await new ThreatActorAttributionService(prisma).discover(user, 'indicator-1');
  assert.deepEqual(result.candidates[0].evidence, [{ type: 'CAMPAIGN', value: 'campaign-1' }]);
});

test('Given a report relation, when discovery runs, then report evidence produces a candidate', async () => {
  const prisma = prismaFor(indicator(), [actor('actor-1', { reportIds: ['report-1'] })]);
  const result = await new ThreatActorAttributionService(prisma).discover(user, 'indicator-1');
  assert.deepEqual(result.candidates[0].evidence, [{ type: 'INTELLIGENCE_REPORT', value: 'report-1' }]);
});

test('Given no related actor, when discovery runs, then NO_MATCH is returned', async () => {
  const result = await new ThreatActorAttributionService(prismaFor(indicator())).discover(user, 'indicator-1');
  assert.deepEqual(result, { status: 'NO_MATCH', indicatorId: 'indicator-1', candidates: [], overflow: false });
});

test('Given a cross-tenant actor, when discovery runs, then it cannot appear', async () => {
  const prisma = prismaFor(indicator(), [actor('actor-2', { entityTenantId: 'tenant-2', campaignIds: ['campaign-2'] })]);
  const result = await new ThreatActorAttributionService(prisma).discover(user, 'indicator-1');
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(prisma.actorQueries[0].where.tenantId, 'tenant-1');
  assert.equal(prisma.actorQueries[0].where.entity.tenantId, 'tenant-1');
});

test('Given discovery queries candidates, when it runs, then only active actors are requested', async () => {
  const prisma = prismaFor(indicator());
  await new ThreatActorAttributionService(prisma).discover(user, 'indicator-1');
  assert.equal(prisma.actorQueries[0].where.status, 'ACTIVE');
});

test('Given duplicate canonical evidence, when discovery scores it, then the score is not doubled', async () => {
  const current = indicator({ value: 'Evil.Example.', tags: ['evil.example'] });
  const prisma = prismaFor(current, [actor('actor-1', { aliases: ['EVIL.EXAMPLE'], indicators: [{ type: 'DOMAIN', value: 'evil.example' }] })]);
  const result = await new ThreatActorAttributionService(prisma).discover(user, 'indicator-1');
  assert.equal(result.candidates[0].score, 70);
  assert.equal(result.candidates[0].evidence.length, 1);
});

test('Given only a substring collision, when discovery runs, then it does not produce a candidate', async () => {
  const prisma = prismaFor(indicator({ value: 'apt.example' }), [actor('actor-1', { aliases: ['apt'], indicators: [{ type: 'DOMAIN', value: 'capt.example' }] })]);
  const result = await new ThreatActorAttributionService(prisma).discover(user, 'indicator-1');
  assert.equal(result.status, 'NO_MATCH');
});

test('Given an indicator from another tenant, when discovery runs, then access is forbidden', async () => {
  const prisma = prismaFor(indicator({ tenantId: 'tenant-2' }));
  await assert.rejects(() => new ThreatActorAttributionService(prisma).discover(user, 'indicator-1'), error => error instanceof ForbiddenException);
});

test('Given a cross-tenant intelligence source, when discovery runs, then the source cannot affect score or evidence', async () => {
  const current = indicator({
    intelligenceSourceId: 'source-foreign',
    intelligenceSource: { name: 'Foreign source', provider: 'FOREIGN_PROVIDER' },
  });
  const candidate = actor('actor-1', { aliases: ['foreign_provider'], campaignIds: ['campaign-1'] });
  const prisma = prismaFor(current, [candidate], [], [{ id: 'source-foreign', tenantId: 'tenant-2', name: 'Foreign source', provider: 'FOREIGN_PROVIDER' }]);

  const result = await new ThreatActorAttributionService(prisma).discover(user, 'indicator-1');

  assert.equal(result.candidates[0].score, 70);
  assert.deepEqual(result.candidates[0].evidence, [{ type: 'CAMPAIGN', value: 'campaign-1' }]);
  assert.deepEqual(prisma.sourceQueries[0].where, { id: 'source-foreign', tenantId: 'tenant-1' });
});

test('Given more than 100 candidates, when discovery runs, then it returns 100 and marks overflow', async () => {
  const candidates = Array.from({ length: 101 }, (_, index) => actor(`actor-${String(index).padStart(3, '0')}`, { campaignIds: [`campaign-${index}`] }));
  const prisma = prismaFor(indicator(), candidates);

  const result = await new ThreatActorAttributionService(prisma).discover(user, 'indicator-1');

  assert.equal(result.candidates.length, 100);
  assert.equal(result.overflow, true);
  assert.equal(prisma.actorQueries[0].take, 101);
});

test('Given at most 100 tied candidates, when discovery runs, then ordering is stable and result is exhaustive', async () => {
  const candidates = [actor('actor-b', { name: 'Same', campaignIds: ['campaign-b'] }), actor('actor-a', { name: 'Same', campaignIds: ['campaign-a'] })];
  const prisma = prismaFor(indicator(), candidates);

  const result = await new ThreatActorAttributionService(prisma).discover(user, 'indicator-1');

  assert.deepEqual(result.candidates.map(candidate => candidate.threatActorId), ['actor-a', 'actor-b']);
  assert.equal(result.overflow, false);
  assert.deepEqual(prisma.actorQueries[0].orderBy, [{ updatedAt: 'desc' }, { id: 'asc' }]);
});
