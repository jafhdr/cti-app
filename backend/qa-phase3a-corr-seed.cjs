const { PrismaClient } = require('@prisma/client');

async function main() {
  if (!/^\/cti_corr_qa_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL || '').pathname)) throw new Error('Disposable correlation QA database required');
  const prisma = new PrismaClient();
  try {
    await prisma.appModule.upsert({ where: { slug: 'threat-intelligence' }, update: {}, create: {
      slug: 'threat-intelligence', name: 'Threat Intelligence', description: 'Correlation QA', category: 'CTI',
      features: { create: { key: 'indicator-management', name: 'Indicator Management' } },
    } });
    process.stdout.write('Correlation QA module seeded\n');
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'QA seed failed'}\n`); process.exitCode = 1; });
