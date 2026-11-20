const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const legacy = await prisma.caseActivity.findFirstOrThrow({ where: { action: 'CASE_V2_ORIGIN_CREATED' }, orderBy: { createdAt: 'asc' } });
  assert.equal(legacy.metadata.requestId, undefined);
  assert.equal(legacy.metadata.revision, undefined);
  await assert.rejects(prisma.caseActivity.update({ where: { id: legacy.id }, data: { action: 'TAMPERED' } }));
  await assert.rejects(prisma.caseActivity.delete({ where: { id: legacy.id } }));
  const after = await prisma.caseActivity.findUniqueOrThrow({ where: { id: legacy.id } });
  assert.deepEqual(after.metadata, legacy.metadata);
  console.log(JSON.stringify({ verdict: 'PASS', oldEventPreserved: true, updateDenied: true, deleteDenied: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
