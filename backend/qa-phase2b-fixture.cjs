const { PrismaClient } = require('@prisma/client');
const { readFileSync, writeFileSync } = require('node:fs');

async function main() {
  if (!/^\/cti_phase2b_qa_/.test(new URL(process.env.DATABASE_URL || '').pathname)) throw new Error('Disposable Phase 2B QA database required');
  const file = '../.omo/evidence/sicti-phase2a-browser-fixture.json';
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  const prisma = new PrismaClient();
  try {
    const first = await prisma.mitreTechnique.upsert({ where: { tenantId_externalId: { tenantId: fixture.tenantId, externalId: 'T1059' } }, update: {}, create: { tenantId: fixture.tenantId, externalId: 'T1059', name: 'Command and Scripting Interpreter', tactic: 'Execution', platform: 'Windows' } });
    const next = await prisma.mitreTechnique.upsert({ where: { tenantId_externalId: { tenantId: fixture.tenantId, externalId: 'T1105' } }, update: {}, create: { tenantId: fixture.tenantId, externalId: 'T1105', name: 'Ingress Tool Transfer', tactic: 'Command and Control', platform: 'Windows' } });
    const original = await prisma.sirEvidence.findUniqueOrThrow({ where: { id: fixture.evidenceId }, select: { sirId: true } });
    const sir = await prisma.sir.findUniqueOrThrow({ where: { id: original.sirId }, select: { pirId: true, createdById: true, updatedById: true } });
    const marker = Date.now().toString();
    const secondSir = await prisma.sir.create({ data: { tenantId: fixture.tenantId, pirId: sir.pirId, reference: `SIR-P2B-${marker}`, title: 'Independent QA source', question: 'Was command activity independently observed?', createdById: sir.createdById, updatedById: sir.updatedById } });
    const secondEvidence = await prisma.sirEvidence.create({ data: { tenantId: fixture.tenantId, sirId: secondSir.id, threatActorId: fixture.actorId, relevanceNote: 'Independent synthetic corroboration for QA.', createdById: sir.createdById } });
    const outcomeSir = await prisma.sir.create({ data: { tenantId: fixture.tenantId, pirId: sir.pirId, reference: `SIR-P2B-OUTCOME-${marker}`, title: 'Later independent QA source', question: 'Was the proposed transfer independently observed later?', createdById: sir.createdById, updatedById: sir.updatedById } });
    const outcomeEvidence = await prisma.sirEvidence.create({ data: { tenantId: fixture.tenantId, sirId: outcomeSir.id, threatActorId: fixture.actorId, relevanceNote: 'Independent later synthetic outcome evidence.', createdById: sir.createdById } });
    const extended = { ...fixture, commandId: first.id, transferId: next.id, secondEvidenceId: secondEvidence.id, outcomeEvidenceId: outcomeEvidence.id };
    writeFileSync('../.omo/evidence/sicti-phase2b-browser-fixture.json', JSON.stringify(extended), { mode: 0o600 });
    process.stdout.write('Phase 2B synthetic fixture ready\n');
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'QA fixture failed'}\n`); process.exitCode = 1; });
