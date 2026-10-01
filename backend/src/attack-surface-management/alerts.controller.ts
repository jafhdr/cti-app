import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { AsmAlertsService } from './alerts.service';

@Controller('attack-surface/assets/:assetId/alerts')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-management')
export class AsmAlertsController {
  constructor(private readonly alerts: AsmAlertsService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) { return this.alerts.list(req.user, assetId, tenantId); }
  @Get(':alertId') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  detail(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('alertId') alertId: string, @Query('tenantId') tenantId?: string) { return this.alerts.detail(req.user, assetId, alertId, tenantId); }
  @Patch(':alertId/acknowledge') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  acknowledge(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('alertId') alertId: string, @Query('tenantId') tenantId?: string) { return this.alerts.acknowledge(req.user, assetId, alertId, tenantId); }
  @Patch(':alertId/resolve') @Roles('SUPER_ADMIN', 'ADMIN')
  resolve(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('alertId') alertId: string, @Query('tenantId') tenantId?: string) { return this.alerts.resolve(req.user, assetId, alertId, tenantId); }
}
