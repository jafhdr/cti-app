import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { CreateSourceDto, ListSourcesQueryDto, UpdateSourceDto } from './sources.dto';
import { SourcesService } from './sources.service';

@Controller('intelligence/sources')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListSourcesQueryDto) { return this.sources.list(req.user, query); }

  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.sources.get(req.user, id, tenantId); }

  @Post() @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateSourceDto, @Query('tenantId') tenantId?: string) { return this.sources.create(req.user, body, tenantId); }

  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateSourceDto, @Query('tenantId') tenantId?: string) { return this.sources.update(req.user, id, body, tenantId); }

  @Delete(':id') @Roles('SUPER_ADMIN', 'ADMIN')
  remove(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.sources.remove(req.user, id, tenantId); }
}
