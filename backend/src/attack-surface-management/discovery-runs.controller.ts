import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { UpdateDiscoveryScheduleDto } from './discovery-runs.dto';
import { DiscoveryRunsService } from './discovery-runs.service';

@Controller('attack-surface/assets/:assetId/discovery')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-discovery')
export class DiscoveryRunsController {
  constructor(private readonly runs: DiscoveryRunsService) {}
  @Get('schedule') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  schedule(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) { return this.runs.schedule(req.user, assetId, tenantId); }
  @Patch('schedule') @Roles('SUPER_ADMIN', 'ADMIN')
  updateSchedule(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Body() body: UpdateDiscoveryScheduleDto, @Query('tenantId') tenantId?: string) { return this.runs.updateSchedule(req.user, assetId, body.enabled, body.intervalMinutes, tenantId); }
  @Get('runs') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) { return this.runs.runs(req.user, assetId, tenantId); }
  @Get('runs/:runId') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  detail(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('runId') runId: string, @Query('tenantId') tenantId?: string) { return this.runs.detail(req.user, assetId, runId, tenantId); }
  @Get('changes') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  changes(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) { return this.runs.changes(req.user, assetId, tenantId); }
  @Post('runs') @Roles('SUPER_ADMIN', 'ADMIN')
  run(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) { return this.runs.run(req.user, assetId, tenantId); }
}
