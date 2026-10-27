import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { SendReportDto, SubmitReportFeedbackDto } from './report-dissemination.dto';
import { ReportDisseminationService } from './report-dissemination.service';

@Controller('intelligence/reports/dissemination')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class ReportDisseminationController {
  constructor(private readonly service: ReportDisseminationService) {}
  @Get('received') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') received(@Req() req: { user: AuthUser }) { return this.service.received(req.user); }
  @Get('received/:id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') view(@Req() req: { user: AuthUser }, @Param('id') id: string) { return this.service.view(req.user, id); }
  @Post('received/:id/feedback') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') feedback(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: SubmitReportFeedbackDto) { return this.service.feedback(req.user, id, body); }
  @Get(':reportId/recipients') @Roles('SUPER_ADMIN', 'ADMIN') recipients(@Req() req: { user: AuthUser }, @Param('reportId') reportId: string, @Query('tenantId') tenantId?: string) { return this.service.recipients(req.user, reportId, tenantId); }
  @Get(':reportId/history') @Roles('SUPER_ADMIN', 'ADMIN') history(@Req() req: { user: AuthUser }, @Param('reportId') reportId: string, @Query('tenantId') tenantId?: string) { return this.service.history(req.user, reportId, tenantId); }
  @Post(':reportId/send') @Roles('SUPER_ADMIN', 'ADMIN') send(@Req() req: { user: AuthUser }, @Param('reportId') reportId: string, @Body() body: SendReportDto, @Query('tenantId') tenantId?: string) { return this.service.send(req.user, reportId, body, tenantId); }
}
