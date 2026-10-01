import { Module } from '@nestjs/common';
import { AsmNotificationsController } from './notifications.controller';
import { AsmReportsController } from './reports.controller';
import { AsmAlertsController } from './alerts.controller';
import { AsmAlertsService } from './alerts.service';
import { AlertBackfillController } from './alert-backfill.controller';
import { AlertBackfillService } from './alert-backfill.service';
import { RiskPostureController } from './risk-posture.controller';
import { RiskPostureService } from './risk-posture.service';
import { DiscoveryRunsController } from './discovery-runs.controller';
import { DiscoveryRunsService } from './discovery-runs.service';
import { DiscoveryScheduler } from './discovery-scheduler';
import { FindingsController } from './findings.controller';
import { VulnerabilityCorrelationsController } from './vulnerability-correlations.controller';
import { VulnerabilityCorrelationsService } from './vulnerability-correlations.service';
import { FindingsService } from './findings.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { DiscoveryClient } from './discovery.client';
import { DiscoveryService } from './discovery.service';
import { PortServicesController } from './port-services.controller';
import { PortDiscoveryClient } from './port-discovery.client';
import { PortDiscoveryService } from './port-discovery.service';
import { PortServicesService } from './port-services.service';

@Module({
  imports: [AuthModule],
  controllers: [AsmNotificationsController, AsmReportsController, AssetsController, PortServicesController, FindingsController, VulnerabilityCorrelationsController, DiscoveryRunsController, AsmAlertsController, AlertBackfillController, RiskPostureController],
  providers: [
    AssetsService,
    AsmAlertsService,
    AlertBackfillService,
    RiskPostureService,
    FindingsService,
    VulnerabilityCorrelationsService,
    DiscoveryService,
    DiscoveryRunsService,
    DiscoveryScheduler,
    DiscoveryClient,
    PortDiscoveryService,
    PortDiscoveryClient,
    PortServicesService,
    PrismaService,
  ],
})
export class AttackSurfaceManagementModule {}

