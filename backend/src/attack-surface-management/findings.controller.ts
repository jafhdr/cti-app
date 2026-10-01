import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { CreateFindingDto, UpdateFindingDto } from './findings.dto';
import { FindingsService } from './findings.service';

@Controller('attack-surface/assets/:assetId/findings')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-management')
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) {
    return this.findings.list(req.user, assetId, tenantId);
  }

  @Get('risk-summary') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  risk(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Query('tenantId') tenantId?: string) {
    return this.findings.risk(req.user, assetId, tenantId);
  }

  @Get(':findingId') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  detail(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('findingId') findingId: string, @Query('tenantId') tenantId?: string) {
    return this.findings.detail(req.user, assetId, findingId, tenantId);
  }

  @Post() @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Body() body: CreateFindingDto, @Query('tenantId') tenantId?: string) {
    return this.findings.create(req.user, assetId, body, tenantId);
  }

  @Patch(':findingId') @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('assetId') assetId: string, @Param('findingId') findingId: string, @Body() body: UpdateFindingDto, @Query('tenantId') tenantId?: string) {
    return this.findings.update(req.user, assetId, findingId, body, tenantId);
  }
}
