import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { CreateStakeholderDto, ListStakeholdersQueryDto, UpdateStakeholderDto } from './stakeholders.dto';
import { StakeholdersService } from './stakeholders.service';

@Controller('intelligence/stakeholders')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class StakeholdersController {
  constructor(private readonly stakeholders: StakeholdersService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER') list(@Req() req: { user: AuthUser }, @Query() query: ListStakeholdersQueryDto) { return this.stakeholders.list(req.user, query); }
  @Get('responsible-users') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') users(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.stakeholders.users(req.user, tenantId); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.stakeholders.get(req.user, id, tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN') create(@Req() req: { user: AuthUser }, @Body() body: CreateStakeholderDto, @Query('tenantId') tenantId?: string) { return this.stakeholders.create(req.user, body, tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN') update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateStakeholderDto, @Query('tenantId') tenantId?: string) { return this.stakeholders.update(req.user, id, body, tenantId); }
  @Patch(':id/active') @Roles('SUPER_ADMIN', 'ADMIN') active(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body('isActive') isActive: boolean, @Query('tenantId') tenantId?: string) { return this.stakeholders.setActive(req.user, id, isActive, tenantId); }
}
