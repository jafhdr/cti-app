import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { CaseTenantGuard } from './case-tenant.guard';
import { CasesV2Controller } from './cases-v2.controller';
import { CasesV2Service } from './cases-v2.service';
import { CasesWorkflowController } from './cases-workflow.controller';
import { CasesWorkflowService } from './cases-workflow.service';
import { CasesIntegrityController } from './cases-integrity.controller';
import { CaseIntegrityCore } from './case-integrity.core';
import { CasesEvidenceV2Service } from './cases-evidence-v2.service';
import { CasesReviewV2Service } from './cases-review-v2.service';
import { CaseClosedMutationGuard } from './case-closed-mutation.guard';
import { CasesOperationsController } from './cases-operations.controller';
import { CasesOperationsService } from './cases-operations.service';

@Module({
  imports: [AuthModule],
  controllers: [CasesController, CasesV2Controller, CasesWorkflowController, CasesIntegrityController, CasesOperationsController],
  providers: [CasesService, CasesV2Service, CasesWorkflowService, CasesOperationsService, CaseIntegrityCore, CasesEvidenceV2Service, CasesReviewV2Service, CaseTenantGuard, CaseClosedMutationGuard, PrismaService],
  exports: [CasesService],
})
export class CasesModule {}
