require('reflect-metadata');
const cookieParser = require('cookie-parser');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const { AuthModule } = require('./dist/src/auth/auth.module');
const { CasesModule } = require('./dist/src/cases/cases.module');
const { MonitoringController } = require('./dist/src/intelligence/monitoring.controller');
const { MonitoringService } = require('./dist/src/intelligence/monitoring.service');
const { MonitoringLinksService } = require('./dist/src/intelligence/monitoring-links.service');
const { MonitoringCollectorService } = require('./dist/src/intelligence/monitoring-collector.service');
const { SourcesController } = require('./dist/src/intelligence/sources.controller');
const { SourcesService } = require('./dist/src/intelligence/sources.service');
const { PrismaService } = require('./dist/src/prisma.service');

async function main() {
  if (new URL(process.env.DATABASE_URL || 'postgresql://invalid@localhost/invalid').pathname !== '/cti_phase4a_qa_20261111'
    || process.env.SICTI_ISOLATED_QA !== 'true' || process.env.SICTI_MONITORING_QA_ENABLED !== 'true') throw new Error('Isolated Phase 4B QA required');
  const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, CasesModule], controllers: [MonitoringController, SourcesController], providers: [MonitoringService, MonitoringLinksService, MonitoringCollectorService, SourcesService, PrismaService] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: 'http://localhost:33014', credentials: true });
  await app.listen(33102, '127.0.0.1');
  process.stdout.write('Phase 4A isolated QA API listening on 33102\n');
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'QA server failed'}\n`); process.exitCode = 1; });
