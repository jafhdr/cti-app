import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { CreateAssetDto, ListAssetsQueryDto, UpdateAssetDto } from './assets.dto';
import { AssetsService } from './assets.service';
import { DiscoveryService } from './discovery.service';

@Controller('attack-surface/assets')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly discovery: DiscoveryService,
  ) {}

  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListAssetsQueryDto) {
    return this.assets.list(req.user, query);
  }

  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.assets.get(req.user, id, tenantId);
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
  @Post(':id/discover') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  discover(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.discovery.runDiscovery(req.user, id, tenantId);
  }
}
