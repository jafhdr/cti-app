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

@Module({
  imports: [AuthModule],
  controllers: [IntelligenceController, SourcesController, ThreatActorsController, CampaignsController, MitreTechniquesController],
  providers: [IntelligenceService, SourcesService, ThreatActorsService, CampaignsService, MitreTechniquesService, PrismaService],
})
export class IntelligenceModule {}
