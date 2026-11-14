require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ScheduleModule } = require('@nestjs/schedule');
const { CorrelationModule } = require('./dist/src/correlation/correlation.module');

async function main() {
  if (!/^\/cti_corr_qa_/.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error('QA database required');
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot(), CorrelationModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  process.stdout.write('WORKER_READY\n');
  process.on('SIGTERM', () => { void app.close().finally(() => process.exit(0)); });
  process.stdin.resume();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
