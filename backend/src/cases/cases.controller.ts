import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule } from '../auth/module-access.decorator';
import { AuthUser } from '../users/users.types';
import { CasesService } from './cases.service';
import { CreateCaseInput, CreateEvidenceInput, CreateInvestigationNoteInput, UpdateCaseInput, ListCaseQuery } from './cases.types';

@Controller('cases')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('case-management')
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListCaseQuery) {
    return this.casesService.list(req.user, query);
  }

  @Get('assignable-users')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getAssignableUsers(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.casesService.getAssignableUsers(req.user, tenantId);
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

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  getDetail(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.casesService.getDetail(req.user, id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateCaseInput) {
    return this.casesService.create(req.user, body);
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
  assign(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: { assigneeId: string }) {
    return this.casesService.assign(req.user, id, body.assigneeId);
  }

}
