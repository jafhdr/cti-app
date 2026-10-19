import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { LinkFindingVulnerabilityDto, PageQueryDto, TenantQueryDto } from './appsec.dto';
import { FindingIntegrationsService } from './finding-integrations.service';
import { FindingCaseService } from './finding-case.service';

@Controller('appsec/findings/:id')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('appsec-posture')
@RequiresModuleFeature('finding-management')
export class FindingIntegrationsController {
  constructor(private readonly integrations: FindingIntegrationsService, private readonly cases: FindingCaseService) {}

  @Get('exposure') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  exposure(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TenantQueryDto) { return this.integrations.exposure(req.user, id, query.tenantId); }

  @Get('vulnerability') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  vulnerability(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TenantQueryDto) { return this.integrations.vulnerability(req.user, id, query.tenantId); }

  @Get('vulnerabilities/available') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  available(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: PageQueryDto) { return this.integrations.available(req.user, id, query); }

  @Post('vulnerability') @Roles('SUPER_ADMIN', 'ADMIN')
  link(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: LinkFindingVulnerabilityDto, @Query() query: TenantQueryDto) { return this.integrations.link(req.user, id, body.vulnerabilityId, query.tenantId); }

  @Delete('vulnerability') @Roles('SUPER_ADMIN', 'ADMIN')
  unlink(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TenantQueryDto) { return this.integrations.unlink(req.user, id, query.tenantId); }

  @Get('case') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getCase(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TenantQueryDto) { return this.cases.get(req.user, id, query.tenantId); }

  @Post('case') @Roles('SUPER_ADMIN', 'ADMIN')
  createCase(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TenantQueryDto) { return this.cases.create(req.user, id, query.tenantId); }
}
