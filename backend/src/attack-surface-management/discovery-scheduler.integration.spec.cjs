const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { DiscoveryScheduler } = require('../../dist/src/attack-surface-management/discovery-scheduler');

test('scheduler skips disabled targets, avoids overlap and continues after a target failure', { timeout: 60000 }, async () => {
  const prisma = new PrismaClient(); const marker = randomUUID(); let tenantId;
  try {
    const tenant = await prisma.tenant.create({ data: { name: `Scheduler QA ${marker}`, slug: `scheduler-qa-${marker}` } }); tenantId = tenant.id;
    await prisma.user.create({ data: { name: 'Scheduler admin', email: `scheduler-${marker}@example.test`, passwordHash: 'unused', role: 'ADMIN', tenantId } });
    const assets = [];
    for (const port of [1, 2, 3]) assets.push(await prisma.asset.create({ data: { tenantId, name: `Asset ${port}`, type: 'IP_ADDRESS', value: `192.0.2.${port}` } }));
    for (let index = 0; index < assets.length; index++) await prisma.asmDiscoverySchedule.create({ data: { tenantId, assetId: assets[index].id, enabled: index !== 1, nextRunAt: new Date(Date.now() - 60_000) } });
    const called = [];
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    const runner = { run: async (_user, assetId) => { called.push(assetId); if (assetId === assets[0].id) { await waiting; throw new Error('Provider failed'); } } };
    const scheduler = new DiscoveryScheduler(prisma, { evaluate: async () => ({ accessible: true }) }, runner);
    const first = scheduler.tick();
    while (called.length === 0) await new Promise(resolve => setTimeout(resolve, 10));
    await scheduler.tick();
    assert.equal(called.length, 1);
    release();
    await first;
    assert.deepEqual(called, [assets[0].id, assets[2].id]);
    called.length = 0;
    await new DiscoveryScheduler(prisma, { evaluate: async () => ({ accessible: false, reason: 'No ASM' }) }, runner).tick();
    assert.equal(called.length, 0);
    await prisma.tenant.update({ where: { id: tenantId }, data: { isActive: false } });
    await new DiscoveryScheduler(prisma, { evaluate: async () => ({ accessible: true }) }, runner).tick();
    assert.equal(called.length, 0);
  } finally { if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }); await prisma.$disconnect(); }
});
