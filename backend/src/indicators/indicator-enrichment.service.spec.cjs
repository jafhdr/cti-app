require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { ForbiddenException } = require('@nestjs/common');
const { IndicatorEnrichmentService } = require('../../dist/src/indicators/indicator-enrichment.service.js');
const { IndicatorsController } = require('../../dist/src/indicators/indicators.controller.js');

const user = { sub: 'user-1', role: 'ADMIN', tenantId: 'tenant-1' };

function fixture(indicator, providerResult) {
  const writes = [];
  let calls = 0;
  const prisma = {
    indicator: { findUnique: async () => indicator },
    indicatorEnrichment: {
      create: async ({ data }) => {
        writes.push(data);
        return { id: 'enrichment-1', ...data, createdAt: new Date('2026-09-14T00:00:00.000Z') };
      },
      findMany: async () => writes,
    },
  };
  const client = {
    provider: (type, selectedProvider) => selectedProvider === 'VIRUSTOTAL' ? 'VIRUSTOTAL' : type === 'IP_ADDRESS' ? 'IPWHOIS' : 'CLOUDFLARE_DNS',
    enrich: async (_type, _value, provider) => {
      calls += 1;
      assert.equal(provider, 'VIRUSTOTAL');
      if (providerResult instanceof Error) throw providerResult;
      return providerResult;
    },
  };
  return { prisma, client, writes, calls: () => calls };
}

test('Given a tenant indicator, when enrichment succeeds, then provider context is persisted', async () => {
  const setup = fixture(
    { id: 'indicator-1', tenantId: 'tenant-1', type: 'DOMAIN', value: 'example.com' },
    { provider: 'CLOUDFLARE_DNS', data: { host: 'example.com', records: ['93.184.216.34'] } },
  );
  const service = new IndicatorEnrichmentService(setup.prisma, setup.client);
  const result = await service.run(user, 'indicator-1', { provider: 'VIRUSTOTAL' });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.provider, 'CLOUDFLARE_DNS');
  assert.deepEqual(setup.writes[0].data, { host: 'example.com', records: ['93.184.216.34'] });
  assert.equal(setup.writes[0].tenantId, 'tenant-1');
});

test('Given a provider failure, when enriching, then the failure is persisted and returned', async () => {
  const setup = fixture(
    { id: 'indicator-1', tenantId: 'tenant-1', type: 'IP_ADDRESS', value: '203.0.113.10' },
    new Error('Provider unavailable'),
  );
  const service = new IndicatorEnrichmentService(setup.prisma, setup.client);
  const result = await service.run(user, 'indicator-1', { provider: 'VIRUSTOTAL' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error, 'Provider unavailable');
  assert.equal(setup.writes[0].provider, 'VIRUSTOTAL');
});

test('Given another tenant indicator, when enriching, then access is denied without provider or database writes', async () => {
  const setup = fixture(
    { id: 'indicator-2', tenantId: 'tenant-2', type: 'DOMAIN', value: 'other.example' },
    { provider: 'CLOUDFLARE_DNS', data: {} },
  );
  const service = new IndicatorEnrichmentService(setup.prisma, setup.client);
  await assert.rejects(() => service.run(user, 'indicator-2', { provider: 'VIRUSTOTAL' }), error => error instanceof ForbiddenException);
  assert.equal(setup.calls(), 0);
  assert.equal(setup.writes.length, 0);
});

test('Given the enrichment endpoint, when authorization metadata is inspected, then only administrators may run it', () => {
  const roles = Reflect.getMetadata('roles', IndicatorsController.prototype.enrich);
  assert.deepEqual(roles, ['SUPER_ADMIN', 'ADMIN']);
});
