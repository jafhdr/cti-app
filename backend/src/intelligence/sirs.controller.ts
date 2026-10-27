import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { AnswerSirDto, ChangeSirStatusDto, CreateSirDto, ListSirsQueryDto, UpdateSirDto } from './sirs.dto';
import { SirsService } from './sirs.service';
import { SirEvidenceService } from './sir-evidence.service';
import { AttachSirEvidenceDto, SearchSirEvidenceDto, UpdateSirEvidenceDto } from './sir-evidence.dto';

@Controller('intelligence/sirs')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class SirsController {
  constructor(private readonly sirs: SirsService, private readonly evidence: SirEvidenceService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER') list(@Req() req: { user: AuthUser }, @Query() query: ListSirsQueryDto) { return this.sirs.list(req.user, query); }
  @Get(':id/evidence') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') evidenceList(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.evidence.list(req.user, id, tenantId); }
  @Get(':id/evidence/search') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') evidenceSearch(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query() query: SearchSirEvidenceDto) { return this.evidence.search(req.user, id, query); }
  @Post(':id/evidence') @Roles('SUPER_ADMIN', 'ADMIN') evidenceAttach(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: AttachSirEvidenceDto, @Query('tenantId') tenantId?: string) { return this.evidence.attach(req.user, id, body, tenantId); }
  @Patch(':id/evidence/:evidenceId') @Roles('SUPER_ADMIN', 'ADMIN') evidenceUpdate(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('evidenceId') evidenceId: string, @Body() body: UpdateSirEvidenceDto, @Query('tenantId') tenantId?: string) { return this.evidence.update(req.user, id, evidenceId, body, tenantId); }
  @Delete(':id/evidence/:evidenceId') @Roles('SUPER_ADMIN', 'ADMIN') evidenceDetach(@Req() req: { user: AuthUser }, @Param('id') id: string, @Param('evidenceId') evidenceId: string, @Query('tenantId') tenantId?: string) { return this.evidence.detach(req.user, id, evidenceId, tenantId); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.sirs.get(req.user, id, tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN') create(@Req() req: { user: AuthUser }, @Body() body: CreateSirDto, @Query('tenantId') tenantId?: string) { return this.sirs.create(req.user, body, tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN') update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateSirDto, @Query('tenantId') tenantId?: string) { return this.sirs.update(req.user, id, body, tenantId); }
  @Patch(':id/answer') @Roles('SUPER_ADMIN', 'ADMIN') answer(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: AnswerSirDto, @Query('tenantId') tenantId?: string) { return this.sirs.answer(req.user, id, body, tenantId); }
  @Patch(':id/status') @Roles('SUPER_ADMIN', 'ADMIN') status(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: ChangeSirStatusDto, @Query('tenantId') tenantId?: string) { return this.sirs.changeStatus(req.user, id, body.status, tenantId); }
}
