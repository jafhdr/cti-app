import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { AsmV2EvidenceService } from './asm-v2-evidence.service';
import { AsmV2ReviewService } from './asm-v2-review.service';
import { CorrelationDecisionDto } from './asm-v2-review.dto';
import { AsmV2PriorityService } from './asm-v2-priority.service';

class EnrollmentDto {
  @IsBoolean()
  enabled!: boolean;
}

@Controller('attack-surface/v2')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-management')
export class AsmV2EvidenceController {
  constructor(private readonly evidence: AsmV2EvidenceService, private readonly review: AsmV2ReviewService,
    private readonly priority: AsmV2PriorityService) {}

  @Get('assets/:assetId/priority') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  assetPriority(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) {
    return this.priority.evaluate(req.user, assetId, tenantId);
  }

  @Get('review-availability') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  availability(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.review.available(req.user, tenantId);
  }

  @Get('correlation-queue') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  queue(@Req() req: { user: AuthUser }, @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('review') review?: string, @Query('status') status?: string, @Query('confidence') confidence?: string,
    @Query('assetId') assetId?: string, @Query('tenantId') tenantId?: string) {
    return this.review.queue(req.user, page, review, status, confidence, assetId, tenantId);
  }

  @Get('enrollment') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  enrollment(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.evidence.enrollment(req.user, tenantId);
  }

  @Post('enrollment') @Roles('SUPER_ADMIN', 'ADMIN')
  setEnrollment(@Req() req: { user: AuthUser }, @Body() input: EnrollmentDto, @Query('tenantId') tenantId?: string) {
    return this.evidence.setEnrollment(req.user, input.enabled, tenantId);
  }

  @Get('assets/:assetId/correlations') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('tenantId') tenantId?: string) {
    return this.evidence.list(req.user, assetId, page, tenantId);
  }

  @Get('assets/:assetId/correlations/:id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  detail(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.evidence.detail(req.user, assetId, id, tenantId);
  }

  @Get('assets/:assetId/correlations/:id/observations') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  observations(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('id') id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('tenantId') tenantId?: string) {
    return this.evidence.observations(req.user, assetId, id, page, tenantId);
  }

  @Post('assets/:assetId/correlations/:id/activate') @Roles('SUPER_ADMIN', 'ADMIN')
  activate(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.evidence.activate(req.user, assetId, id, tenantId);
  }

  @Get('assets/:assetId/correlations/:id/decisions') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  decisions(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('id') id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('tenantId') tenantId?: string) {
    return this.review.history(req.user, assetId, id, page, tenantId);
  }

  @Post('assets/:assetId/correlations/:id/decisions') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  @RequiresModuleFeature('asset-management', 'asset-correlation-review')
  decide(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('id') id: string,
    @Body() input: CorrelationDecisionDto, @Query('tenantId') tenantId?: string) {
    return this.review.decide(req.user, assetId, id, input, tenantId);
  }
}
