const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ConfigService } = require('@nestjs/config');

const eligibleTenantWhere = {
  isActive: true,
  subscription: { status: { in: ['TRIAL', 'ACTIVE'] }, renewalAt: { gt: assertDate } },
  moduleSettings: { some: { isEnabled: true, module: { slug: 'threat-intelligence', isActive: true } } },
};

function assertDate(value) {
  return value instanceof Date;
}

function scheduler({ intervalMinutes, tenants = [], ingest = async () => ({ total: 0, created: 0, updated: 0, failed: 0 }) } = {}) {
  const intervals = [];
  const prisma = {
    tenant: {
      findMany: async query => {
        assert.equal(query.where.isActive, eligibleTenantWhere.isActive);
        assert.deepEqual(query.where.subscription.status, eligibleTenantWhere.subscription.status);
        assert.equal(eligibleTenantWhere.subscription.renewalAt.gt(query.where.subscription.renewalAt.gt), true);
        assert.deepEqual(query.where.moduleSettings, eligibleTenantWhere.moduleSettings);
        return tenants;
      },
    },
  };
  const registry = { addInterval: (name, interval) => intervals.push({ name, interval }) };
  const { MitreThreatActorIngestionScheduler } = require('../../dist/src/intelligence/mitre-threat-actor-ingestion.scheduler.js');
  return {
    instance: new MitreThreatActorIngestionScheduler(
      new ConfigService(intervalMinutes ? { MITRE_ATTACK_SYNC_INTERVAL_MINUTES: String(intervalMinutes) } : {}),
      registry,
      prisma,
      { ingest },
    ),
    intervals,
  };
}

test('Given no interval override, when the scheduler boots, then it registers a 24-hour interval', () => {
  const { instance, intervals } = scheduler();
  instance.onApplicationBootstrap();
  assert.equal(intervals[0].name, 'mitre-attack-sync');
  assert.equal(intervals[0].interval._idleTimeout, 1440 * 60_000);
  clearInterval(intervals[0].interval);
});

test('Given an interval override, when the scheduler boots, then it uses the configured minutes', () => {
  const { instance, intervals } = scheduler({ intervalMinutes: 30 });
  instance.onApplicationBootstrap();
  assert.equal(intervals[0].interval._idleTimeout, 30 * 60_000);
  clearInterval(intervals[0].interval);
});

test('Given eligible tenants, when synchronization runs, then ingestion runs once per tenant as its active admin', async () => {
  const calls = [];
  const tenants = [
    { id: 'tenant-1', users: [{ id: 'admin-1', role: 'ADMIN' }] },
    { id: 'tenant-2', users: [{ id: 'admin-2', role: 'ADMIN' }] },
  ];
  const { instance } = scheduler({ tenants, ingest: async user => { calls.push(user); return { total: 1, created: 1, updated: 0, failed: 0 }; } });
  await instance.run();
  assert.deepEqual(calls, [
    { sub: 'admin-1', tenantId: 'tenant-1', role: 'ADMIN' },
    { sub: 'admin-2', tenantId: 'tenant-2', role: 'ADMIN' },
  ]);
});

test('Given synchronization is running, when another tick starts, then the overlapping execution is skipped', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const tenants = [{ id: 'tenant-1', users: [{ id: 'admin-1', role: 'ADMIN' }] }];
  const { instance } = scheduler({ tenants, ingest: async () => { calls += 1; await blocked; return { total: 1, created: 1, updated: 0, failed: 0 }; } });
  const first = instance.run();
  await new Promise(resolve => setImmediate(resolve));
  await instance.run();
  release();
  await first;
  assert.equal(calls, 1);
});
