import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { ModuleAccessService } from '../auth/module-access.service';
import { ForbiddenException } from '@nestjs/common';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { AuthUser } from '../users/users.types';
import { CasesService } from './cases.service';
import { CaseTenantGuard } from './case-tenant.guard';
import { CaseClosedMutationGuard } from './case-closed-mutation.guard';
import { AssignCaseInput, CaseTenantQuery, LinkAsmAlertInput, CreateCaseInput, CreateEvidenceInput, CreateInvestigationNoteInput, LinkCampaignInput, LinkIndicatorInput, LinkThreatActorInput, UpdateCaseInput, ListCaseQuery } from './cases.types';

@Controller('cases')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard, CaseTenantGuard, CaseClosedMutationGuard)
@RequiresModule('case-management')
@RequiresModuleFeature('case-workflow')
export class CasesController {
  constructor(private readonly casesService: CasesService, private readonly moduleAccess: ModuleAccessService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListCaseQuery) {
    return this.casesService.list(req.user, query);
  }

  @Get('assignable-users')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getAssignableUsers(@Req() req: { user: AuthUser }, @Query() query: CaseTenantQuery) {
    return this.casesService.getAssignableUsers(req.user, query.tenantId);
  }

  @Get(':id/notes')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getNotes(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.casesService.getNotes(req.user, id);
  }

  @Post(':id/notes')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  addNote(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: CreateInvestigationNoteInput) {
    return this.casesService.addNote(req.user, id, body);
  }

  @Get(':id/evidence')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getEvidence(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.casesService.getEvidence(req.user, id);
  }

  @Post(':id/evidence')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  addEvidence(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: CreateEvidenceInput) {
    return this.casesService.addEvidence(req.user, id, body);
  }

  @Get(':id/activity')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getActivity(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.casesService.getActivity(req.user, id);
  }

  @Get(':id/indicators/available')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getAvailableIndicators(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('search') search?: string) {
    return this.casesService.getAvailableIndicators(req.user, id, search);
  }

  @Get(':id/indicators')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getIndicators(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.casesService.getIndicators(req.user, id);
  }

  @Post(':id/indicators')
  @Roles('SUPER_ADMIN', 'ADMIN')
  linkIndicator(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: LinkIndicatorInput) {
    return this.casesService.linkIndicator(req.user, id, body.indicatorId);
  }

  @Delete(':id/indicators/:indicatorId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  unlinkIndicator(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('indicatorId') indicatorId: string) {
    return this.casesService.unlinkIndicator(req.user, id, indicatorId);
  }

  @Get(':id/threat-actors/available')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getAvailableThreatActors(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('search') search?: string) {
    return this.casesService.getAvailableThreatActors(req.user, id, search);
  }

  @Get(':id/threat-actors')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getThreatActors(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.casesService.getThreatActors(req.user, id);
  }

  @Post(':id/threat-actors')
  @Roles('SUPER_ADMIN', 'ADMIN')
  linkThreatActor(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: LinkThreatActorInput) {
    return this.casesService.linkThreatActor(req.user, id, body.threatActorId);
  }

  @Delete(':id/threat-actors/:threatActorId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  unlinkThreatActor(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('threatActorId') threatActorId: string) {
    return this.casesService.unlinkThreatActor(req.user, id, threatActorId);
  }

  @Get(':id/campaigns/available')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getAvailableCampaigns(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('search') search?: string) {
    return this.casesService.getAvailableCampaigns(req.user, id, search);
  }

  @Get(':id/campaigns')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getCampaigns(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.casesService.getCampaigns(req.user, id);
  }

  @Post(':id/campaigns')
  @Roles('SUPER_ADMIN', 'ADMIN')
  linkCampaign(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: LinkCampaignInput) {
    return this.casesService.linkCampaign(req.user, id, body.campaignId);
  }

  @Delete(':id/campaigns/:campaignId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  unlinkCampaign(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('campaignId') campaignId: string) {
    return this.casesService.unlinkCampaign(req.user, id, campaignId);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getDetail(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: CaseTenantQuery) {
    return this.casesService.getDetail(req.user, id, query.tenantId);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateCaseInput) {
    return this.casesService.create(req.user, body);
  }

  @Post('from-indicator/:indicatorId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  createFromIndicator(
    @Req() req: { user: AuthUser },
    @Param('indicatorId') indicatorId: string,
    @Body() body: CreateCaseInput,
  ) {
    return this.casesService.createFromIndicator(req.user, indicatorId, body);
  }

  @Post('from-asm-alert/:alertId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async createFromAsmAlert(@Req() req: { user: AuthUser }, @Param('alertId') alertId: string, @Body() body: CreateCaseInput) {
    const access = await this.moduleAccess.evaluate(req.user, 'attack-surface-management', ['asset-management']);
    if (!access.accessible) throw new ForbiddenException(access.reason);
    return this.casesService.createFromAsmAlert(req.user, alertId, body);
  }

  @Post('from-asm-finding/:findingId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async createFromAsmFinding(@Req() req: { user: AuthUser }, @Param('findingId') findingId: string, @Body() body: CreateCaseInput) {
    const access = await this.moduleAccess.evaluate(req.user, 'attack-surface-management', ['asset-management']);
    if (!access.accessible) throw new ForbiddenException(access.reason);
    return this.casesService.createFromAsmFinding(req.user, findingId, body);
  }

  @Post(':id/asm-alerts/:alertId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async linkAsmAlert(@Req() req: { user: AuthUser }, @Param('id') caseId: string, @Param('alertId') alertId: string, @Body() body: LinkAsmAlertInput) {
    const access = await this.moduleAccess.evaluate(req.user, 'attack-surface-management', ['asset-management']);
    if (!access.accessible) throw new ForbiddenException(access.reason);
    return this.casesService.linkAsmAlert(req.user, caseId, alertId, body.tenantId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateCaseInput) {
    return this.casesService.update(req.user, id, body);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  delete(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.casesService.delete(req.user, id);
  }

  @Post(':id/assign')
  @Roles('SUPER_ADMIN', 'ADMIN')
  assign(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: AssignCaseInput) {
    return this.casesService.assign(req.user, id, body.assigneeId);
  }

}
