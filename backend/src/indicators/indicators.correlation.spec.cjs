require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { NotFoundException } = require('@nestjs/common');
const { IndicatorsService } = require('../../dist/src/indicators/indicators.service.js');

const user = { sub: 'user-1', role: 'ADMIN', tenantId: 'tenant-1' };

function prismaFor(indicator, candidates = []) {
  const updates = [];
  const audits = [];
  return {
    updates,
    audits,
    indicator: {
      findUnique: async () => indicator,
      update: async ({ data }) => {
        updates.push(data);
        return { ...indicator, ...data };
      },
    },
    threatActor: { findMany: async () => candidates },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data);
        return data;
      },
    },
  };
}

test('Given one campaign-backed actor, when correlating, then it links the indicator', async () => {
  const prisma = prismaFor(
    { id: 'indicator-1', tenantId: 'tenant-1', intelligenceEntityId: null },
    [{ id: 'actor-1', entityId: 'entity-1', entity: { name: 'APT One' }, campaigns: [{ id: 'campaign-1' }], intelligenceReports: [] }],
  );
  const service = new IndicatorsService(prisma);

  const result = await service.correlateThreatActor(user, 'indicator-1');

  assert.deepEqual(result, {
    status: 'matched',
    indicatorId: 'indicator-1',
    threatActor: { id: 'actor-1', name: 'APT One' },
    basis: ['campaign'],
    created: true,
  });
  assert.deepEqual(prisma.updates, [{ intelligenceEntityId: 'entity-1' }]);
  assert.equal(prisma.audits[0].action, 'INDICATOR_THREAT_ACTOR_CORRELATED');
});

test('Given no relation-backed actor, when correlating, then it returns no match without a write', async () => {
  const prisma = prismaFor({ id: 'indicator-1', tenantId: 'tenant-1', intelligenceEntityId: null });
  const service = new IndicatorsService(prisma);

  const result = await service.correlateThreatActor(user, 'indicator-1');

  assert.deepEqual(result, { status: 'no_match', indicatorId: 'indicator-1', reason: 'NO_VALID_CANDIDATE' });
  assert.equal(prisma.updates.length, 0);
  assert.equal(prisma.audits.length, 0);
});

test('Given an indicator in another tenant, when correlating, then the resource is hidden', async () => {
  const prisma = prismaFor({ id: 'indicator-2', tenantId: 'tenant-2', intelligenceEntityId: null });
  const service = new IndicatorsService(prisma);

  await assert.rejects(
    () => service.correlateThreatActor(user, 'indicator-2'),
    error => error instanceof NotFoundException,
  );
  assert.equal(prisma.updates.length, 0);
});
