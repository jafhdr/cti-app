import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { CreateReportDto, ListReportsQueryDto, UpdateReportDto } from './reports.dto';
import { ReportsService, type ReportRelationKind } from './reports.service';

@Controller('intelligence/reports')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER') list(@Req() req: { user: AuthUser }, @Query() query: ListReportsQueryDto) { return this.reports.list(req.user, query); }
  @Get('relations') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') relations(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.reports.relations(req.user, tenantId); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.reports.get(req.user, id, tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN') create(@Req() req: { user: AuthUser }, @Body() body: CreateReportDto, @Query('tenantId') tenantId?: string) { return this.reports.create(req.user, body, tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN') update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateReportDto, @Query('tenantId') tenantId?: string) { return this.reports.update(req.user, id, body, tenantId); }
  @Delete(':id') @Roles('SUPER_ADMIN', 'ADMIN') remove(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.reports.remove(req.user, id, tenantId); }
  @Post(':id/:kind/:relatedId') @Roles('SUPER_ADMIN', 'ADMIN') attach(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('kind') kind: ReportRelationKind, @Param('relatedId') relatedId: string, @Query('tenantId') tenantId?: string) { return this.reports.setRelation(req.user, id, kind, relatedId, true, tenantId); }
  @Delete(':id/:kind/:relatedId') @Roles('SUPER_ADMIN', 'ADMIN') detach(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('kind') kind: ReportRelationKind, @Param('relatedId') relatedId: string, @Query('tenantId') tenantId?: string) { return this.reports.setRelation(req.user, id, kind, relatedId, false, tenantId); }
}
