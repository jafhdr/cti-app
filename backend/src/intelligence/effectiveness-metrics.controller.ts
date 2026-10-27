import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { EffectivenessMetricsQueryDto } from './effectiveness-metrics.dto';
import { EffectivenessMetricsService } from './effectiveness-metrics.service';

@Controller('intelligence/effectiveness')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class EffectivenessMetricsController {
  constructor(private readonly metrics: EffectivenessMetricsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  get(@Req() req: { user: AuthUser }, @Query() query: EffectivenessMetricsQueryDto) {
    return this.metrics.get(req.user, query);
  }
}
