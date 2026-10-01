import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { CreateAssetDto, ListAssetsQueryDto, UpdateAssetDto } from './assets.dto';
import { AssetsService } from './assets.service';
import { DiscoveryRunsService } from './discovery-runs.service';

@Controller('attack-surface/assets')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-management')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly discovery: DiscoveryRunsService,
  ) {}

  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListAssetsQueryDto) {
    return this.assets.list(req.user, query);
  }

  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.assets.get(req.user, id, tenantId);
  }

  @Get(':id/relationships') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  relationships(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.assets.relationships(req.user, id, tenantId);
  }

  @Get(':id/threat-intelligence') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  threatIntelligence(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.assets.threatIntelligence(req.user, id, tenantId);
  }

  @Post() @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateAssetDto, @Query('tenantId') tenantId?: string) {
    return this.assets.create(req.user, body, tenantId);
  }

  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateAssetDto, @Query('tenantId') tenantId?: string) {
    return this.assets.update(req.user, id, body, tenantId);
  }

  @Delete(':id') @Roles('SUPER_ADMIN', 'ADMIN')
  remove(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.assets.remove(req.user, id, tenantId);
  }

  /** Phase 2A – Domain/Subdomain Discovery */
  @RequiresModuleFeature('asset-discovery')
  @Post(':id/discover') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  discover(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.discovery.run(req.user, id, tenantId, 'MANUAL', req.user.role !== 'USER').then(result => ({ ...result.legacySummary, runId: result.id }));
  }
}
