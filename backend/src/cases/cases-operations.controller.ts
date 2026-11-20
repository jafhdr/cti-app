import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import type { OperationsQuery } from './cases-operations.query';
import { CasesOperationsService } from './cases-operations.service';

@Controller('cases/v2/operations')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('case-management')
@RequiresModuleFeature('case-workflow', 'case-v2-reporting')
@Roles('USER', 'ADMIN', 'SUPER_ADMIN')
export class CasesOperationsController {
  constructor(private readonly operations: CasesOperationsService) {}

  @Get('summary')
  summary(@Req() req: { user: AuthUser }, @Query() query: OperationsQuery) {
    return this.operations.summary(req.user, query);
  }

  @Get('queue')
  queue(@Req() req: { user: AuthUser }, @Query() query: OperationsQuery) {
    return this.operations.queue(req.user, query);
  }
}
