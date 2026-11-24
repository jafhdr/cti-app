const { readFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const line = readFileSync('../../backend/.env', 'utf8').split(/\r?\n/).find(row => row.startsWith('DATABASE_URL='));
if (!line) throw new Error('DATABASE_URL missing');
process.env.DATABASE_URL = line.slice(13).replace(/^"|"$/g, '');
const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.$queryRawUnsafe('SELECT current_setting(\'max_connections\')::int AS max, count(*)::int AS used FROM pg_stat_activity');
  const dbs = await prisma.$queryRawUnsafe("SELECT datname FROM pg_database WHERE datname LIKE 'cti_soar_qa_%' ORDER BY datname");
  process.stdout.write(JSON.stringify({ connections: rows[0], disposableQaDatabases: dbs.map(row => row.datname), recommendedQaConnectionBudget: Math.max(0, rows[0].max - rows[0].used - 5) }) + '\n');
})().finally(() => prisma.$disconnect());
