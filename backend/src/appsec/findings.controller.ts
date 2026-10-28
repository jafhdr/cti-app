import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { AcceptFindingRiskDto, ActivateFindingDto, ApproveFindingFalsePositiveDto, AssignFindingDto, CreateFindingDto, DecideFindingVerificationDto, ListFindingsDto, OperationalPeriodDto, OperationalQueueDto, PageQueryDto, PrioritizeFindingDto, ReopenFindingDto, RequestFindingVerificationDto, StartRemediationDto, SubmitRemediationEvidenceDto, TenantQueryDto, UpdateFindingDto, ValidateFindingDto } from './appsec.dto';
import { FindingsService } from './findings.service';
import { FindingActionsService } from './finding-actions.service';
import { FindingVerificationService } from './finding-verification.service';
import { FindingReportingService } from './finding-reporting.service';

@Controller('appsec/findings')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('appsec-posture')
@RequiresModuleFeature('finding-management')
export class FindingsController {
  constructor(private readonly findings: FindingsService, private readonly actions: FindingActionsService, private readonly verification: FindingVerificationService, private readonly reporting: FindingReportingService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListFindingsDto) { return this.findings.list(req.user, query); }
  @Get('applications') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  applicationOptions(@Req() req: { user: AuthUser }, @Query() query: TenantQueryDto) { return this.findings.applicationOptions(req.user, query.tenantId); }
  @Get('assignees') @Roles('SUPER_ADMIN', 'ADMIN')
  assignees(@Req() req: { user: AuthUser }, @Query() query: TenantQueryDto) { return this.actions.assignees(req.user, query.tenantId); }
  @Get('queue') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  queue(@Req() req: { user: AuthUser }, @Query() query: OperationalQueueDto) { return this.reporting.queue(req.user, query); }
  @Get('operational-metrics') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  operationalMetrics(@Req() req: { user: AuthUser }, @Query() query: OperationalPeriodDto) { return this.reporting.metrics(req.user, query); }
  @Get(':id/lifecycle/events') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  history(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: PageQueryDto) { return this.actions.history(req.user, id, query); }
  @Post(':id/lifecycle/activate') @Roles('SUPER_ADMIN', 'ADMIN')
  activate(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: ActivateFindingDto, @Query() query: TenantQueryDto) { return this.actions.act(req.user, id, 'activate', body, query.tenantId); }
  @Post(':id/lifecycle/validate') @Roles('SUPER_ADMIN', 'ADMIN')
  validate(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: ValidateFindingDto, @Query() query: TenantQueryDto) { return this.actions.act(req.user, id, 'validate', body, query.tenantId); }
  @Post(':id/lifecycle/priority') @Roles('SUPER_ADMIN', 'ADMIN')
  priority(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: PrioritizeFindingDto, @Query() query: TenantQueryDto) { return this.actions.act(req.user, id, 'priority', body, query.tenantId); }
  @Post(':id/lifecycle/assign') @Roles('SUPER_ADMIN', 'ADMIN')
  assign(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: AssignFindingDto, @Query() query: TenantQueryDto) { return this.actions.act(req.user, id, 'assign', body, query.tenantId); }
  @Post(':id/lifecycle/start') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') @RequiresModuleFeature('finding-management', 'finding-remediation-submit')
  startRemediation(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: StartRemediationDto, @Query() query: TenantQueryDto) { return this.actions.act(req.user, id, 'start', body, query.tenantId); }
  @Post(':id/lifecycle/evidence') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') @RequiresModuleFeature('finding-management', 'finding-remediation-submit')
  submitEvidence(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: SubmitRemediationEvidenceDto, @Query() query: TenantQueryDto) { return this.actions.act(req.user, id, 'evidence', body, query.tenantId); }
  @Post(':id/lifecycle/request-verification') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') @RequiresModuleFeature('finding-management', 'finding-remediation-submit')
  requestVerification(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: RequestFindingVerificationDto, @Query() query: TenantQueryDto) { return this.verification.act(req.user, id, 'request-verification', body, query.tenantId); }
  @Post(':id/lifecycle/verify') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') @RequiresModuleFeature('finding-management', 'finding-review')
  verify(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: DecideFindingVerificationDto, @Query() query: TenantQueryDto) { return this.verification.act(req.user, id, 'verify', body, query.tenantId); }
  @Post(':id/lifecycle/accept-risk') @Roles('SUPER_ADMIN', 'ADMIN') @RequiresModuleFeature('finding-management', 'finding-review')
  acceptRisk(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: AcceptFindingRiskDto, @Query() query: TenantQueryDto) { return this.verification.act(req.user, id, 'accept-risk', body, query.tenantId); }
  @Post(':id/lifecycle/false-positive') @Roles('SUPER_ADMIN', 'ADMIN') @RequiresModuleFeature('finding-management', 'finding-review')
  falsePositive(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: ApproveFindingFalsePositiveDto, @Query() query: TenantQueryDto) { return this.verification.act(req.user, id, 'false-positive', body, query.tenantId); }
  @Post(':id/lifecycle/reopen') @Roles('SUPER_ADMIN', 'ADMIN') @RequiresModuleFeature('finding-management', 'finding-review')
  reopen(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: ReopenFindingDto, @Query() query: TenantQueryDto) { return this.verification.act(req.user, id, 'reopen', body, query.tenantId); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: TenantQueryDto) { return this.findings.get(req.user, id, query.tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateFindingDto, @Query() query: TenantQueryDto) { return this.findings.create(req.user, body, query.tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateFindingDto, @Query() query: TenantQueryDto) { return this.findings.update(req.user, id, body, query.tenantId); }
}
