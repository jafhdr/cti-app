const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { CasesOperationsService } = require('./dist/src/cases/cases-operations.service');
const prisma = new PrismaClient();
process.env.CASE_V2_REPORTING_ENABLED = 'true';

async function main() {
  const tenantId = process.env.CASE_QA_TENANT_ID;
  if (!tenantId) throw new Error('QA tenant required');
  const actorId = (await prisma.user.findFirstOrThrow({ where: { tenantId }, select: { id: true } })).id;
  const marker = `perf-${Date.now()}`;
  const now = Date.now();
  await prisma.case.createMany({ data: Array.from({ length: 500 }, (_, i) => ({ tenantId, caseNumber: `${marker}-${i}`, title: `Synthetic performance ${i}`, createdBy: actorId, status: i % 2 ? 'OPEN' : 'IN_PROGRESS', dueAt: i % 3 ? new Date(now-3600000) : null, createdAt: new Date(now-(i+1)*3600000) })) });
  const service = new CasesOperationsService(prisma);
  const user = { role: 'SUPER_ADMIN', sub: actorId };
  const measures = [];
  for (let i=0;i<5;i++) {
    const start = performance.now();
    const summary = await service.summary(user, { tenantId });
    measures.push(Math.round(performance.now()-start));
    assert.ok(summary.counts.total >= 500);
    assert.ok(summary.aging.open.p90Hours !== null);
    assert.equal(summary.workload.tasks.TODO, 0);
  }
  const start = performance.now();
  const queue = await service.queue(user, { tenantId, queue: 'OVERDUE', page: '1', limit: '25' });
  const queueMs = Math.round(performance.now()-start);
  assert.equal(queue.items.length, 25);
  console.log(JSON.stringify({ cases: 500, summaryMs: measures, queueMs, boundedRows: queue.items.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
