import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { TracePageDto } from './traceability.dto';
import { TraceabilityService } from './traceability.service';

@Controller('intelligence/traceability')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class TraceabilityController {
  constructor(private readonly trace: TraceabilityService) {}

  @Get('sirs/:id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  sir(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TracePageDto) {
    return this.trace.sir(req.user, id, query);
  }

  @Get('tasks/:id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  task(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TracePageDto) {
    return this.trace.task(req.user, id, query);
  }

  @Get('evidence/:id/reports') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  evidenceReports(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TracePageDto) {
    return this.trace.evidenceReports(req.user, id, query);
  }

  @Get('reports/:id') @Roles('SUPER_ADMIN', 'ADMIN')
  report(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TracePageDto) {
    return this.trace.report(req.user, id, query);
  }
}
