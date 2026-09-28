import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { IocCandidatesService } from './ioc-candidates.service';

@Controller('intelligence/ioc-candidates')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('indicator-management')
export class IocCandidatesController {
  constructor(private readonly candidates: IocCandidatesService) {}

  @Get() @Roles('SUPER_ADMIN', 'ADMIN')
  list(@Req() request: { readonly user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.candidates.listPending(request.user, tenantId); }

  @Patch(':id/approve') @Roles('SUPER_ADMIN', 'ADMIN')
  approve(@Req() request: { readonly user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.candidates.approve(request.user, id, tenantId); }

  @Patch(':id/reject') @Roles('SUPER_ADMIN', 'ADMIN')
  reject(@Req() request: { readonly user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.candidates.reject(request.user, id, tenantId); }
}
