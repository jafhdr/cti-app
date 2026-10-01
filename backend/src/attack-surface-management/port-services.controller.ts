import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { RecordPortServiceDto } from './port-services.dto';
import { DiscoveryRunsService } from './discovery-runs.service';
import { PortServicesService } from './port-services.service';

@Controller('attack-surface/assets/:assetId/port-services')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-management')
export class PortServicesController {
  constructor(
    private readonly portServices: PortServicesService,
    private readonly discovery: DiscoveryRunsService,
  ) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) {
    return this.portServices.list(req.user, assetId, tenantId);
  }

  @RequiresModuleFeature('asset-discovery')
  @Post('discover')
  @Roles('SUPER_ADMIN', 'ADMIN')
  discover(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) {
    return this.discovery.run(req.user, assetId, tenantId).then(result => ({ ...result.legacySummary, runId: result.id }));
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  record(
    @Req() req: { user: AuthUser },
    @Param('assetId') assetId: string,
    @Body() body: RecordPortServiceDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.portServices.record(req.user, assetId, body, tenantId);
  }
}
