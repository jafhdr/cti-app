import { Controller, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { AlertBackfillService } from './alert-backfill.service';

@Controller('attack-surface/alerts')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-management')
export class AlertBackfillController {
  constructor(private readonly backfill: AlertBackfillService) {}
  @Post('backfill') @Roles('SUPER_ADMIN', 'ADMIN')
  run(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.backfill.run(req.user, tenantId);
  }
}
