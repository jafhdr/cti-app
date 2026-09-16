import { Module } from '@nestjs/common';
import { IntelligenceController } from './intelligence.controller';
import { IntelligenceService } from './intelligence.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';
import { ThreatActorsController } from './threat-actors.controller';
import { ThreatActorsService } from './threat-actors.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { MitreTechniquesController } from './mitre-techniques.controller';
import { MitreTechniquesService } from './mitre-techniques.service';
import { MalwareToolsController } from './malware-tools.controller';
import { MalwareToolsService } from './malware-tools.service';
import { VulnerabilitiesController } from './vulnerabilities.controller';
import { VulnerabilitiesService } from './vulnerabilities.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { MitreAttackStixClient } from './mitre-attack-stix.client';
import { MitreThreatActorIngestionService } from './mitre-threat-actor-ingestion.service';
import { MitreThreatActorIngestionScheduler } from './mitre-threat-actor-ingestion.scheduler';

@Module({
  imports: [AuthModule],
  controllers: [IntelligenceController, SourcesController, ThreatActorsController, CampaignsController, MitreTechniquesController, MalwareToolsController, VulnerabilitiesController, ReportsController],
  providers: [IntelligenceService, SourcesService, ThreatActorsService, CampaignsService, MitreTechniquesService, MalwareToolsService, VulnerabilitiesService, ReportsService, MitreAttackStixClient, MitreThreatActorIngestionService, MitreThreatActorIngestionScheduler, PrismaService],
  exports: [MitreAttackStixClient],
})
export class IntelligenceModule {}
