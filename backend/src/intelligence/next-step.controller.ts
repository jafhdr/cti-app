import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { createNextStepRunSchema, reviewNextStepSchema } from './next-step.dto';
import { NextStepService } from './next-step.service';

@Controller('intelligence/next-step-runs')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class NextStepController {
  constructor(private readonly nextSteps: NextStepService) {}

  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query('actorId') actorId?: string, @Query('campaignId') campaignId?: string, @Query('tenantId') tenantId?: string) {
    return this.nextSteps.list(req.user, { actorId, campaignId, tenantId });
  }

  @Post() @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: unknown, @Query('tenantId') tenantId?: string) {
    const parsed = createNextStepRunSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.nextSteps.create(req.user, parsed.data, tenantId);
  }

  @Post('candidates/:id/reviews') @Roles('SUPER_ADMIN', 'ADMIN')
  review(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: unknown, @Query('tenantId') tenantId?: string) {
    const parsed = reviewNextStepSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.nextSteps.review(req.user, id, parsed.data, tenantId);
  }
}
