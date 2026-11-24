const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const database = new URL(process.env.DATABASE_URL).pathname;
  assert.match(database, /^\/cti_unified_qa_[a-z0-9]+$/);
  assert.equal(process.env.SICTI_ISOLATED_QA, 'true');
  assert.equal(process.env.SICTI_UNIFIED_QA_ENABLED, 'true');

  const state = JSON.parse(readFileSync('qa-sict39-state.json', 'utf8'));
  const prisma = new PrismaClient();
  try {
    const correlation = await prisma.threatCorrelation.findFirstOrThrow({
      where: { alertId: state.alertId, tenantId: state.tenantId },
      include: { event: true },
    });
    const reader = await prisma.user.findFirstOrThrow({ where: { tenantId: state.tenantId, role: 'USER' } });
    const outsider = await prisma.user.findFirstOrThrow({
      where: {
        tenantId: { not: state.tenantId },
        role: 'ADMIN',
        email: { startsWith: 'outsider-' },
        moduleAccess: { some: { featureKeys: { has: 'indicator-management' } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const initiator = await prisma.user.findUniqueOrThrow({ where: { id: state.adminId } });
    const approver = await prisma.user.findUniqueOrThrow({ where: { id: state.approverId } });
    const fixture = {
      tenantId: state.tenantId,
      otherTenantId: outsider.tenantId,
      initiator: { id: initiator.id, email: initiator.email },
      approver: { id: approver.id, email: approver.email },
      reader: { id: reader.id, email: reader.email },
      outsider: { id: outsider.id, email: outsider.email },
      alertId: state.alertId,
      caseId: state.caseId,
      domain: correlation.event.observableValue,
    };
    assert.match(fixture.domain, /\.test$/);
    mkdirSync('../.omo/evidence', { recursive: true });
    writeFileSync('../.omo/evidence/sicti-phase3b-qa-fixture.json', JSON.stringify(fixture), { mode: 0o600 });
    process.stdout.write(JSON.stringify({ alertId: fixture.alertId, caseId: fixture.caseId, source: 'worker-correlation' }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
