import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { type AuthUser } from '../users/users.types';
import { ModulesService } from './modules.service';
import { type CreateModuleInput, type UpdateModuleInput, type UpdateTenantModuleInput } from './modules.types';

@Controller('modules')
@UseGuards(AuthGuard, RolesGuard)
export class ModulesController {
  constructor(private readonly modules: ModulesService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  listAvailable(@Req() req: { user: AuthUser }) { return this.modules.listAvailable(req.user); }

  @Get('configuration')
  @Roles('SUPER_ADMIN', 'ADMIN')
  listConfiguration(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.modules.listConfiguration(req.user, tenantId); }

  @Post()
  @Roles('SUPER_ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateModuleInput) { return this.modules.create(req.user, body); }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') moduleId: string, @Body() body: UpdateModuleInput) { return this.modules.update(req.user, moduleId, body); }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  remove(@Req() req: { user: AuthUser }, @Param('id') moduleId: string) { return this.modules.remove(req.user, moduleId); }

  @Patch(':id/access')
  @Roles('SUPER_ADMIN', 'ADMIN')
  updateAccess(@Req() req: { user: AuthUser }, @Param('id') moduleId: string, @Body() body: UpdateTenantModuleInput) { return this.modules.updateTenantAccess(req.user, moduleId, body); }
}
