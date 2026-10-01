import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { RiskPostureService } from './risk-posture.service';

@Controller('attack-surface/assets/:assetId/risk-posture')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-management')
export class RiskPostureController {
  constructor(private readonly posture: RiskPostureService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  history(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) {
    return this.posture.history(req.user, assetId, tenantId);
  }
}
