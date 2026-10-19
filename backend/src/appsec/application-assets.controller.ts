import { Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { ListAvailableAssetsDto, TenantQueryDto } from './appsec.dto';
import { ApplicationAssetsService } from './application-assets.service';

@Controller('appsec/applications/:id/assets')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('appsec-posture')
@RequiresModuleFeature('application-inventory')
export class ApplicationAssetsController {
  constructor(private readonly assets: ApplicationAssetsService) {}

  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TenantQueryDto) { return this.assets.list(req.user, id, query.tenantId); }

  @Get('available') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  available(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: ListAvailableAssetsDto) { return this.assets.available(req.user, id, query); }

  @Post(':assetId') @Roles('SUPER_ADMIN', 'ADMIN')
  link(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('assetId') assetId: string, @Query() query: TenantQueryDto) { return this.assets.link(req.user, id, assetId, query.tenantId); }

  @Delete(':assetId') @Roles('SUPER_ADMIN', 'ADMIN')
  unlink(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('assetId') assetId: string, @Query() query: TenantQueryDto) { return this.assets.unlink(req.user, id, assetId, query.tenantId); }
}
