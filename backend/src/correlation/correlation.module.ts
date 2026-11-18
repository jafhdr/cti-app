import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CasesModule } from '../cases/cases.module';
import { CorrelationCaseService } from './correlation-case.service';
import { PrismaService } from '../prisma.service';
import { CorrelationController } from './correlation.controller';
import { CorrelationService } from './correlation.service';
import { CorrelationConnectorService } from './correlation-connector.service';
import { CorrelationQueueService } from './correlation-queue.service';
import { CorrelationCredentialsService } from './correlation-credentials.service';
import { CorrelationCredentialsController, CorrelationMachineController } from './correlation-credentials.controller';

@Module({ imports: [AuthModule, CasesModule], controllers: [CorrelationController, CorrelationCredentialsController, CorrelationMachineController], providers: [PrismaService, CorrelationService, CorrelationCaseService, CorrelationConnectorService, CorrelationQueueService, CorrelationCredentialsService] })
export class CorrelationModule {}
