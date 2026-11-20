require('reflect-metadata');
const cookieParser = require('cookie-parser');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { AuthModule } = require('./dist/src/auth/auth.module');
const { CorrelationModule } = require('./dist/src/correlation/correlation.module');
const { PlaybookModule } = require('./dist/src/playbooks/playbook.module');

async function main() {
  if (!/^\/cti_soar_qa_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL || '').pathname)
    || process.env.SICTI_ISOLATED_QA !== 'true' || process.env.SICTI_SOAR_QA_ENABLED !== 'true') throw new Error('Isolated SOAR QA configuration required');
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, CorrelationModule, PlaybookModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.enableCors({ origin: 'http://localhost:33010', credentials: true });
  await app.listen(33101, '127.0.0.1');
  process.stdout.write('Phase 3A isolated QA API listening on 33101\n');
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'QA server failed'}\n`); process.exitCode = 1; });
