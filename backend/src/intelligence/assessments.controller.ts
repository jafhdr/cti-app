import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { AssessmentHistoryQueryDto, EvidenceAssessmentDto, SourceAssessmentDto } from './assessments.dto';
import { AssessmentsService } from './assessments.service';

@Controller('intelligence/assessments')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get('sources/:id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  sourceHistory(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: AssessmentHistoryQueryDto) { return this.assessments.sourceHistory(req.user, id, query); }
  @Post('sources/:id') @Roles('SUPER_ADMIN', 'ADMIN')
  assessSource(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: SourceAssessmentDto, @Query('tenantId') tenantId?: string) { return this.assessments.assessSource(req.user, id, body, tenantId); }

  @Get('sirs/:sirId/evidence/:id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  evidenceHistory(@Req() req: { user: AuthUser }, @Param('sirId') sirId: string, @Param('id') id: string, @Query() query: AssessmentHistoryQueryDto) { return this.assessments.evidenceHistory(req.user, sirId, id, query); }
  @Post('sirs/:sirId/evidence/:id') @Roles('SUPER_ADMIN', 'ADMIN')
  assessEvidence(@Req() req: { user: AuthUser }, @Param('sirId') sirId: string, @Param('id') id: string, @Body() body: EvidenceAssessmentDto, @Query('tenantId') tenantId?: string) { return this.assessments.assessEvidence(req.user, sirId, id, body, tenantId); }
}
