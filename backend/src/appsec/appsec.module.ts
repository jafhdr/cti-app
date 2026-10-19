import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { AppSecTenantContext } from './tenant-context';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { FindingsController } from './findings.controller';
import { FindingsService } from './findings.service';
import { ApplicationAssetsController } from './application-assets.controller';
import { ApplicationAssetsService } from './application-assets.service';
import { PostureController } from './posture.controller';
import { PostureService } from './posture.service';
import { FindingIntegrationsController } from './finding-integrations.controller';
import { FindingIntegrationsService } from './finding-integrations.service';
import { FindingCaseService } from './finding-case.service';
import { ModuleAccessService } from '../auth/module-access.service';

@Module({
  imports: [AuthModule],
  controllers: [ApplicationsController, ApplicationAssetsController, FindingsController, FindingIntegrationsController, PostureController],
  providers: [PrismaService, ModuleAccessService, AppSecTenantContext, ApplicationsService, ApplicationAssetsService, FindingsService, FindingIntegrationsService, FindingCaseService, PostureService],
})
export class AppSecModule {}
