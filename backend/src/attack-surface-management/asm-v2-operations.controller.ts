import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { AsmV2OperationsService } from './asm-v2-operations.service';
import { OperationsAssetsQueryDto } from './asm-v2-operations.dto';

@Controller('attack-surface/v2/operations')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-management')
export class AsmV2OperationsController {
  constructor(private readonly operations: AsmV2OperationsService) {}

  @Get('summary') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  summary(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.operations.summary(req.user, tenantId);
  }

  @Get('assets') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  assets(@Req() req: { user: AuthUser }, @Query() query: OperationsAssetsQueryDto) {
    return this.operations.assets(req.user, query);
  }
}
