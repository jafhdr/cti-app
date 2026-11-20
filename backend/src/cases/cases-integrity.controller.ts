import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { CaseTenantGuard } from './case-tenant.guard';
import { CasesEvidenceV2Service } from './cases-evidence-v2.service';
import { CasesReviewV2Service } from './cases-review-v2.service';
import { CloseCaseV2Input, DecideCaseReviewInput, ReopenCaseV2Input, RequestCaseReviewInput, ReviseCaseEvidenceInput } from './case-integrity.types';

@Controller('cases')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard, CaseTenantGuard)
@RequiresModule('case-management')
@RequiresModuleFeature('case-workflow', 'case-v2-integrity')
export class CasesIntegrityController {
  constructor(private readonly evidence: CasesEvidenceV2Service, private readonly review: CasesReviewV2Service) {}

  @Get(':id/integrity')
  @Roles('USER', 'ADMIN', 'SUPER_ADMIN')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.review.get(req.user, id, tenantId);
  }

  @Get(':id/evidence/:evidenceId/revisions')
  @Roles('USER', 'ADMIN', 'SUPER_ADMIN')
  history(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('evidenceId') evidenceId: string, @Query('tenantId') tenantId?: string) {
    return this.evidence.history(req.user, id, evidenceId, tenantId);
  }

  @Post(':id/evidence/:evidenceId/revisions')
  @Roles('USER', 'ADMIN', 'SUPER_ADMIN')
  revise(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('evidenceId') evidenceId: string, @Query('tenantId') tenantId: string | undefined, @Body() input: ReviseCaseEvidenceInput) {
    return this.evidence.revise(req.user, id, evidenceId, tenantId, input);
  }

  @Post(':id/reviews')
  @Roles('ADMIN', 'SUPER_ADMIN')
  request(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId: string | undefined, @Body() input: RequestCaseReviewInput) {
    return this.review.request(req.user, id, tenantId, input);
  }

  @Post(':id/reviews/:reviewId/decision')
  @Roles('ADMIN', 'SUPER_ADMIN')
  decide(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('reviewId') reviewId: string, @Query('tenantId') tenantId: string | undefined, @Body() input: DecideCaseReviewInput) {
    return this.review.decide(req.user, id, reviewId, tenantId, input);
  }

  @Post(':id/closure')
  @Roles('ADMIN', 'SUPER_ADMIN')
  close(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId: string | undefined, @Body() input: CloseCaseV2Input) {
    return this.review.close(req.user, id, tenantId, input);
  }

  @Post(':id/reopen')
  @Roles('ADMIN', 'SUPER_ADMIN')
  reopen(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId: string | undefined, @Body() input: ReopenCaseV2Input) {
    return this.review.reopen(req.user, id, tenantId, input);
  }
}
