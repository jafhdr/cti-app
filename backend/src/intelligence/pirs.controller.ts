import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { ChangePirStatusDto, CreatePirDto, ListPirsQueryDto, UpdatePirDto } from './pirs.dto';
import { PirsService } from './pirs.service';

@Controller('intelligence/pirs')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class PirsController {
  constructor(private readonly pirs: PirsService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER') list(@Req() req: { user: AuthUser }, @Query() query: ListPirsQueryDto) { return this.pirs.list(req.user, query); }
  @Get('eligible-stakeholders') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') stakeholders(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.pirs.stakeholders(req.user, tenantId); }
  @Get('responsible-users') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') users(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.pirs.users(req.user, tenantId); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.pirs.get(req.user, id, tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN') create(@Req() req: { user: AuthUser }, @Body() body: CreatePirDto, @Query('tenantId') tenantId?: string) { return this.pirs.create(req.user, body, tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN') update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdatePirDto, @Query('tenantId') tenantId?: string) { return this.pirs.update(req.user, id, body, tenantId); }
  @Patch(':id/status') @Roles('SUPER_ADMIN', 'ADMIN') status(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: ChangePirStatusDto, @Query('tenantId') tenantId?: string) { return this.pirs.changeStatus(req.user, id, body.status, tenantId); }
}
