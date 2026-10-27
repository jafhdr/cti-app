import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { AssignCollectionTaskDto, CreateCollectionTaskDto, LinkCollectionEvidenceDto, ListCollectionTasksDto, ResultCollectionTaskDto, StatusCollectionTaskDto, UpdateCollectionTaskDto } from './collection-tasks.dto';
import { CollectionTasksService } from './collection-tasks.service';

@Controller('intelligence/collection-tasks')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class CollectionTasksController {
  constructor(private readonly tasks: CollectionTasksService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER') list(@Req() req: { user: AuthUser }, @Query() query: ListCollectionTasksDto) { return this.tasks.list(req.user, query); }
  @Get('sources') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') sources(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.tasks.sources(req.user, tenantId); }
  @Get('sir/:sirId/progress') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') progress(@Req() req: { user: AuthUser }, @Param('sirId') sirId: string, @Query('tenantId') tenantId?: string) { return this.tasks.progress(req.user, sirId, tenantId); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.tasks.get(req.user, id, tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN') create(@Req() req: { user: AuthUser }, @Body() body: CreateCollectionTaskDto, @Query('tenantId') tenantId?: string) { return this.tasks.create(req.user, body, tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN') update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateCollectionTaskDto, @Query('tenantId') tenantId?: string) { return this.tasks.update(req.user, id, body, tenantId); }
  @Patch(':id/assign') @Roles('SUPER_ADMIN', 'ADMIN') assign(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: AssignCollectionTaskDto, @Query('tenantId') tenantId?: string) { return this.tasks.assign(req.user, id, body.responsibleUserId, tenantId); }
  @Patch(':id/status') @Roles('SUPER_ADMIN', 'ADMIN') status(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: StatusCollectionTaskDto, @Query('tenantId') tenantId?: string) { return this.tasks.status(req.user, id, body.status, tenantId); }
  @Patch(':id/result') @Roles('SUPER_ADMIN', 'ADMIN') result(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: ResultCollectionTaskDto, @Query('tenantId') tenantId?: string) { return this.tasks.result(req.user, id, body, tenantId); }
  @Post(':id/evidence') @Roles('SUPER_ADMIN', 'ADMIN') linkEvidence(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: LinkCollectionEvidenceDto, @Query('tenantId') tenantId?: string) { return this.tasks.linkEvidence(req.user, id, body.evidenceId, tenantId); }
}
