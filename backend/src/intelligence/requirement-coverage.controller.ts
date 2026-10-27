import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { ListCoverageDto } from './requirement-coverage.dto';
import { RequirementCoverageService } from './requirement-coverage.service';

@Controller('intelligence/coverage')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class RequirementCoverageController {
  constructor(private readonly coverage: RequirementCoverageService) {}
  @Get('sirs') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListCoverageDto) { return this.coverage.list(req.user, query); }
  @Get('sirs/:id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.coverage.get(req.user, id, tenantId); }
}
