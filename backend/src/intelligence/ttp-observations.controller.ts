import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { createTtpObservationSchema, reviewTtpObservationSchema } from './ttp-observations.dto';
import { TtpObservationsService } from './ttp-observations.service';

@Controller('intelligence/ttp-observations')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class TtpObservationsController {
  constructor(private readonly observations: TtpObservationsService) {}

  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  timeline(@Req() req: { user: AuthUser }, @Query('actorId') actorId?: string, @Query('campaignId') campaignId?: string, @Query('tenantId') tenantId?: string) {
    return this.observations.timeline(req.user, { actorId, campaignId, tenantId });
  }

  @Get('evidence-options') @Roles('SUPER_ADMIN', 'ADMIN')
  evidenceOptions(@Req() req: { user: AuthUser }, @Query('actorId') actorId?: string, @Query('campaignId') campaignId?: string, @Query('tenantId') tenantId?: string) {
    return this.observations.evidenceOptions(req.user, { actorId, campaignId, tenantId });
  }

  @Post() @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: unknown, @Query('tenantId') tenantId?: string) {
    const parsed = createTtpObservationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.observations.create(req.user, parsed.data, tenantId);
  }

  @Post(':id/reviews') @Roles('SUPER_ADMIN', 'ADMIN')
  review(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: unknown, @Query('tenantId') tenantId?: string) {
    const parsed = reviewTtpObservationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.observations.review(req.user, id, parsed.data, tenantId);
  }
}
