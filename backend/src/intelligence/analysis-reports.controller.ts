import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { AnalysisReportsService } from './analysis-reports.service';
import { ChangeAnalysisStatusDto, ListAnalysisReportsDto, SaveAnalysisReportDto } from './analysis-reports.dto';

@Controller('intelligence/reports/analysis')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class AnalysisReportsController {
  constructor(private readonly reports: AnalysisReportsService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN') list(@Req() req: { user: AuthUser }, @Query() query: ListAnalysisReportsDto) { return this.reports.list(req.user, query); }
  @Get('context/:pirId') @Roles('SUPER_ADMIN', 'ADMIN') context(@Req() req: { user: AuthUser }, @Param('pirId') pirId: string, @Query('tenantId') tenantId?: string) { return this.reports.context(req.user, pirId, tenantId); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN') get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.reports.get(req.user, id, tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN') create(@Req() req: { user: AuthUser }, @Body() body: SaveAnalysisReportDto, @Query('tenantId') tenantId?: string) { return this.reports.save(req.user, body, undefined, tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN') update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: SaveAnalysisReportDto, @Query('tenantId') tenantId?: string) { return this.reports.save(req.user, body, id, tenantId); }
  @Patch(':id/status') @Roles('SUPER_ADMIN', 'ADMIN') status(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: ChangeAnalysisStatusDto, @Query('tenantId') tenantId?: string) { return this.reports.status(req.user, id, body.status, tenantId); }
  @Post(':id/finalize') @Roles('SUPER_ADMIN', 'ADMIN') finalize(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.reports.finalize(req.user, id, tenantId); }
}
