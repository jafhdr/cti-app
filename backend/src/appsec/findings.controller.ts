import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { CreateFindingDto, ListFindingsDto, TenantQueryDto, UpdateFindingDto } from './appsec.dto';
import { FindingsService } from './findings.service';

@Controller('appsec/findings')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('appsec-posture')
@RequiresModuleFeature('finding-management')
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListFindingsDto) { return this.findings.list(req.user, query); }
  @Get('applications') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  applicationOptions(@Req() req: { user: AuthUser }, @Query() query: TenantQueryDto) { return this.findings.applicationOptions(req.user, query.tenantId); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TenantQueryDto) { return this.findings.get(req.user, id, query.tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateFindingDto, @Query() query: TenantQueryDto) { return this.findings.create(req.user, body, query.tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateFindingDto, @Query() query: TenantQueryDto) { return this.findings.update(req.user, id, body, query.tenantId); }
}
