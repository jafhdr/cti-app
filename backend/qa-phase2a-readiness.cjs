const { PrismaClient } = require('@prisma/client');

async function main() {
  if (!process.env.DATABASE_URL || !/^\/cti_phase2a_qa_/.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error('Read-only inventory requires a disposable cti_phase2a_qa_* database');
  const prisma = new PrismaClient();
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    const rows = [];
    for (const tenant of tenants) {
      const tenantId = tenant.id;
      const [actors, campaigns, techniques, evidence, observations, confirmed, withIntervals, reviewed] = await Promise.all([
        prisma.threatActor.count({ where: { tenantId } }),
        prisma.campaign.count({ where: { tenantId } }),
        prisma.mitreTechnique.count({ where: { tenantId } }),
        prisma.sirEvidence.count({ where: { tenantId, OR: [{ threatActorId: { not: null } }, { campaignId: { not: null } }] } }),
        prisma.ttpObservation.count({ where: { tenantId } }),
        prisma.ttpObservation.count({ where: { tenantId, status: 'CONFIRMED' } }),
        prisma.ttpObservation.count({ where: { tenantId, timePrecision: { not: 'INSTANT' } } }),
        prisma.ttpObservationReview.count({ where: { tenantId } }),
      ]);
      rows.push({ tenantId, actors, campaigns, techniques, linkedSirEvidence: evidence, observations, confirmedObservations: confirmed, intervalObservations: withIntervals, reviews: reviewed });
    }
    process.stdout.write(`${JSON.stringify({ scope: 'QA_READ_ONLY', tenants: rows }, null, 2)}\n`);
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Inventory failed'}\n`); process.exitCode = 1; });
