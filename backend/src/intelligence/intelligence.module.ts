import { Module } from '@nestjs/common';
import { CollectionTasksController } from './collection-tasks.controller';
import { CollectionTasksService } from './collection-tasks.service';
import { TraceabilityController } from './traceability.controller';
import { TraceabilityService } from './traceability.service';
import { RequirementCoverageController } from './requirement-coverage.controller';
import { RequirementCoverageService } from './requirement-coverage.service';
import { EffectivenessMetricsController } from './effectiveness-metrics.controller';
import { EffectivenessMetricsService } from './effectiveness-metrics.service';
import { FeedbackFollowUpsController } from './feedback-follow-ups.controller';
import { FeedbackFollowUpsService } from './feedback-follow-ups.service';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { PirsController } from './pirs.controller';
import { PirsService } from './pirs.service';
import { SirsController } from './sirs.controller';
import { SirsService } from './sirs.service';
import { SirEvidenceService } from './sir-evidence.service';
import { StakeholdersController } from './stakeholders.controller';
import { StakeholdersService } from './stakeholders.service';
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
import { AnalysisReportsController } from './analysis-reports.controller';
import { ReportDisseminationController } from './report-dissemination.controller';
import { ReportDisseminationService } from './report-dissemination.service';
import { AnalysisReportsService } from './analysis-reports.service';
import { ReportsService } from './reports.service';
import { MitreAttackStixClient } from './mitre-attack-stix.client';
import { MitreThreatActorIngestionService } from './mitre-threat-actor-ingestion.service';
import { MitreThreatActorIngestionScheduler } from './mitre-threat-actor-ingestion.scheduler';
import { TelegramWorker } from '../telegram/telegram.worker';
import { IocCandidatesController } from '../telegram/ioc-candidates.controller';
import { IocCandidatesService } from '../telegram/ioc-candidates.service';

@Module({
  imports: [AuthModule],
  controllers: [FeedbackFollowUpsController, AssessmentsController, EffectivenessMetricsController, RequirementCoverageController, TraceabilityController, CollectionTasksController, SirsController, PirsController, StakeholdersController, IntelligenceController, SourcesController, ThreatActorsController, CampaignsController, MitreTechniquesController, MalwareToolsController, VulnerabilitiesController, AnalysisReportsController, ReportDisseminationController, ReportsController, IocCandidatesController],
  providers: [FeedbackFollowUpsService, AssessmentsService, EffectivenessMetricsService, RequirementCoverageService, TraceabilityService, CollectionTasksService, SirEvidenceService, SirsService, PirsService, StakeholdersService, IntelligenceService, SourcesService, ThreatActorsService, CampaignsService, MitreTechniquesService, MalwareToolsService, VulnerabilitiesService, ReportsService, AnalysisReportsService, ReportDisseminationService, MitreAttackStixClient, MitreThreatActorIngestionService, MitreThreatActorIngestionScheduler, IocCandidatesService, TelegramWorker, PrismaService],
  exports: [MitreAttackStixClient],
})
export class IntelligenceModule {}
