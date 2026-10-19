import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { CreateApplicationDto, ListApplicationsDto, TenantQueryDto, UpdateApplicationDto } from './appsec.dto';
import { ApplicationsService } from './applications.service';

@Controller('appsec/applications')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('appsec-posture')
@RequiresModuleFeature('application-inventory')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListApplicationsDto) { return this.applications.list(req.user, query); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TenantQueryDto) { return this.applications.get(req.user, id, query.tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateApplicationDto, @Query() query: TenantQueryDto) { return this.applications.create(req.user, body, query.tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateApplicationDto, @Query() query: TenantQueryDto) { return this.applications.update(req.user, id, body, query.tenantId); }
}
