require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { ForbiddenException } = require('@nestjs/common');
const { ThreatActorAttributionService } = require('../../dist/src/indicators/threat-actor-attribution.service.js');

const user = { sub: 'user-1', role: 'ADMIN', tenantId: 'tenant-1' };

function actor(id, name, options = {}) {
  return {
    id, entityId: `entity-${id}`, aliases: options.aliases || [], motivation: null,
    targetSectors: [], country: null, region: null,
    entity: { tenantId: options.entityTenantId || 'tenant-1', name, description: options.description || null, externalId: options.externalId || null, metadata: options.metadata || null, indicators: options.indicators || [] },
    campaigns: options.campaign ? [{ id: `campaign-${id}` }] : [],
    intelligenceReports: options.report ? [{ reportId: `report-${id}` }] : [],
  };
}

function prismaFor(indicator, candidates = [], enrichments = [], options = {}) {
  const updates = [];
  const audits = [];
  const actorQueries = [];
  const transactionCalls = [];
  const transactionClient = {
    threatActor: { findFirst: async () => options.changedCandidate ? null : { entityId: candidates[0]?.entityId } },
    indicator: { update: async ({ data }) => { updates.push(data); return { ...indicator, ...data }; } },
    auditLog: { create: async ({ data }) => { if (options.auditFailure) throw new Error('audit failed'); audits.push(data); return data; } },
  };
  return {
    updates, audits, actorQueries, transactionCalls,
    indicator: { findUnique: async () => indicator },
    indicatorEnrichment: { findMany: async () => enrichments },
    threatActor: { findMany: async args => { actorQueries.push(args); return candidates; }, findFirst: async () => options.linkedActor || null },
    $transaction: async callback => {
      transactionCalls.push(true);
      const updateCount = updates.length;
      try { return await callback(transactionClient); }
      catch (error) { updates.splice(updateCount); throw error; }
    },
  };
}

test('Given one strongly supported candidate, when attribution runs, then it creates the existing entity relation', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'evil.example', type: 'DOMAIN', tags: ['phishing'], source: 'MISP', intelligenceSource: { name: 'MISP', provider: 'MISP' }, intelligenceEntityId: null };
  const prisma = prismaFor(indicator, [actor('actor-1', 'APT One', { campaign: true })]);
  const result = await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
  assert.equal(result.status, 'MATCH');
  assert.equal(result.candidate.name, 'APT One');
  assert.equal(result.confidence, 70);
  assert.deepEqual(result.matchedEvidence, [{ kind: 'CAMPAIGN', value: 'campaign-actor-1', weight: 70 }]);
  assert.deepEqual(prisma.updates, [{ intelligenceEntityId: 'entity-actor-1' }]);
});

test('Given no relevant actor, when attribution runs, then it returns NO_MATCH without writing', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'clean.example', type: 'DOMAIN', tags: [], source: null, intelligenceSource: null, intelligenceEntityId: null };
  const prisma = prismaFor(indicator, [actor('actor-1', 'Unrelated Actor')]);
  const result = await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
  assert.deepEqual(result, { status: 'NO_MATCH', indicatorId: indicator.id, confidence: 0, matchedEvidence: [], candidates: [] });
  assert.equal(prisma.updates.length, 0);
});

test('Given multiple strong candidates, when attribution runs, then it returns AMBIGUOUS without writing', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'evil.example', type: 'DOMAIN', tags: [], source: null, intelligenceSource: null, intelligenceEntityId: null };
  const prisma = prismaFor(indicator, [actor('actor-1', 'APT One', { campaign: true }), actor('actor-2', 'APT Two', { report: true })]);
  const result = await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
  assert.equal(result.status, 'AMBIGUOUS');
  assert.deepEqual(result.candidates.map(candidate => candidate.name), ['APT One', 'APT Two']);
  assert.equal(prisma.updates.length, 0);
});

test('Given an indicator from another tenant, when attribution runs, then access is forbidden', async () => {
  const prisma = prismaFor({ id: 'indicator-2', tenantId: 'tenant-2', value: 'evil.example', type: 'DOMAIN', tags: [], source: null, intelligenceSource: null, intelligenceEntityId: null });
  await assert.rejects(() => new ThreatActorAttributionService(prisma).attribute(user, 'indicator-2'), error => error instanceof ForbiddenException);
  assert.equal(prisma.updates.length, 0);
});

test('Given enrichment that only matches free text, when attribution runs, then it is not evidence', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'evil.example', type: 'DOMAIN', tags: [], source: null, intelligenceSource: null, intelligenceEntityId: null };
  const prisma = prismaFor(indicator, [actor('actor-1', 'APT One', { description: 'Infrastructure hosted in Jakarta' })], [{ provider: 'IPWHOIS', data: { location: { city: 'Jakarta' } } }]);
  const result = await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(result.confidence, 0);
  assert.equal(prisma.updates.length, 0);
});

test('Given one fact repeated across evidence sources, when attribution runs, then the fact is counted once', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'clean.example', type: 'DOMAIN', tags: ['MISP', 'misp'], source: 'MISP', intelligenceSource: { name: 'MISP', provider: 'MISP' }, intelligenceEntityId: null };
  const prisma = prismaFor(indicator, [actor('actor-1', 'Actor', { aliases: ['misp'] })], [{ provider: 'MISP', data: { source: 'misp' } }]);
  const result = await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(result.confidence, 20);
  assert.equal(result.matchedEvidence.length, 1);
  assert.equal(prisma.updates.length, 0);
});

test('Given the exact IOC is repeated as a tag, when attribution runs, then the canonical IOC fact is counted once', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'Evil.Example.', type: 'DOMAIN', tags: ['evil.example'], source: null, intelligenceSource: null, intelligenceEntityId: null };
  const prisma = prismaFor(indicator, [actor('actor-1', 'Actor', { aliases: ['evil.example'], indicators: [{ type: 'DOMAIN', value: 'evil.example' }] })]);
  const result = await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
  assert.equal(result.status, 'MATCH');
  assert.equal(result.confidence, 70);
  assert.equal(result.matchedEvidence.length, 1);
});

test('Given a substring collision, when attribution runs, then it does not treat free text as IOC evidence', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'apt', type: 'DOMAIN', tags: ['apt'], source: null, intelligenceSource: null, intelligenceEntityId: null };
  const prisma = prismaFor(indicator, [actor('actor-1', 'Captain Nebula', { aliases: ['captain'] })]);
  const result = await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(result.confidence, 0);
  assert.equal(prisma.updates.length, 0);
});

for (const [type, observed, stored] of [
  ['IP_ADDRESS', '192.0.2.10', '192.0.2.10'],
  ['FILE_HASH', 'AABBCCDDEEFF0011', 'aabbccddeeff0011'],
  ['DOMAIN', 'Example.COM.', 'example.com'],
  ['URL', 'HTTPS://Example.COM:443/a/../b#fragment', 'https://example.com/b'],
  ['EMAIL', 'Analyst@Example.COM', 'analyst@example.com'],
]) {
  test(`Given a normalized exact ${type}, when attribution runs, then it matches the structured actor IOC`, async () => {
    const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: observed, type, tags: [], source: null, intelligenceSource: null, intelligenceEntityId: null };
    const prisma = prismaFor(indicator, [actor('actor-1', 'Actor', { indicators: [{ type, value: stored }] })]);
    const result = await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
    assert.equal(result.status, 'MATCH');
    assert.equal(result.confidence, 70);
  });
}

test('Given a candidate whose entity belongs to another tenant, when attribution runs, then it does not create a relation', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'evil.example', type: 'DOMAIN', tags: [], source: null, intelligenceSource: null, intelligenceEntityId: null };
  const prisma = prismaFor(indicator, [actor('actor-1', 'Actor', { campaign: true, entityTenantId: 'tenant-2' })]);
  const result = await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(prisma.updates.length, 0);
});

test('Given an existing relation, when attribution runs, then it reports dedicated existing-relation evidence without writing', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'evil.example', type: 'DOMAIN', tags: [], source: null, intelligenceSource: null, intelligenceEntityId: 'entity-actor-1' };
  const linkedActor = { id: 'actor-1', entityId: 'entity-actor-1', entity: { name: 'Actor' } };
  const prisma = prismaFor(indicator, [], [], { linkedActor });
  const result = await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
  assert.equal(result.status, 'MATCH');
  assert.deepEqual(result.matchedEvidence, [{ kind: 'EXISTING_RELATION', value: 'entity-actor-1', weight: 100 }]);
  assert.equal(prisma.transactionCalls.length, 0);
});

test('Given audit persistence fails, when attribution runs, then the relation update is rolled back by the transaction', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'evil.example', type: 'DOMAIN', tags: [], source: null, intelligenceSource: null, intelligenceEntityId: null };
  const prisma = prismaFor(indicator, [actor('actor-1', 'Actor', { campaign: true })], [], { auditFailure: true });
  await assert.rejects(() => new ThreatActorAttributionService(prisma).attribute(user, indicator.id), /audit failed/);
  assert.equal(prisma.transactionCalls.length, 1);
  assert.equal(prisma.updates.length, 0);
});

test('Given candidates are queried, when attribution runs, then candidate and nested relation reads are bounded and entity tenant is constrained', async () => {
  const indicator = { id: 'indicator-1', tenantId: 'tenant-1', value: 'evil.example', type: 'DOMAIN', tags: [], source: null, intelligenceSource: null, intelligenceEntityId: null };
  const prisma = prismaFor(indicator);
  await new ThreatActorAttributionService(prisma).attribute(user, indicator.id);
  const query = prisma.actorQueries[0];
  assert.equal(query.take, 101);
  assert.equal(query.select.campaigns.take, 1);
  assert.equal(query.select.intelligenceReports.take, 1);
  assert.equal(query.select.entity.select.indicators.take, 100);
  assert.equal(query.where.entity.tenantId, 'tenant-1');
});
