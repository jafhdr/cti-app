const { PrismaClient } = require('@prisma/client');

async function main() {
  const name = process.env.QA_DB_NAME;
  if (!/^cti_phase4a_qa_[a-z0-9]+$/.test(name || '')) throw new Error('Phase 4A QA database guard failed');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.QA_ADMIN_URL } } });
  try {
    const existing = await prisma.$queryRawUnsafe('SELECT 1 FROM pg_database WHERE datname = $1', name);
    if (existing.length === 0) await prisma.$executeRawUnsafe(`CREATE DATABASE ${name}`);
    console.log('Phase 4A QA database ready');
  } finally { await prisma.$disconnect(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
