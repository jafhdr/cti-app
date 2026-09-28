import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { CreateMitreTechniqueDto, ListMitreTechniquesQueryDto, UpdateMitreTechniqueDto } from './mitre-techniques.dto';
import { MitreTechniquesService } from './mitre-techniques.service';

@Controller('intelligence/mitre-techniques')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class MitreTechniquesController {
  constructor(private readonly techniques: MitreTechniquesService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER') list(@Req() req: { user: AuthUser }, @Query() query: ListMitreTechniquesQueryDto) { return this.techniques.list(req.user, query); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.techniques.get(req.user, id, tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN') create(@Req() req: { user: AuthUser }, @Body() body: CreateMitreTechniqueDto, @Query('tenantId') tenantId?: string) { return this.techniques.create(req.user, body, tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN') update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateMitreTechniqueDto, @Query('tenantId') tenantId?: string) { return this.techniques.update(req.user, id, body, tenantId); }
  @Delete(':id') @Roles('SUPER_ADMIN', 'ADMIN') remove(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.techniques.remove(req.user, id, tenantId); }
}
