import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { CreateThreatActorDto, ListThreatActorsQueryDto, UpdateThreatActorDto, parseBatchThreatActorsDto, parseStixThreatActorDto } from './threat-actors.dto';
import { ThreatActorsService } from './threat-actors.service';
import { MitreThreatActorIngestionService } from './mitre-threat-actor-ingestion.service';

@Controller('intelligence/threat-actors')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
export class ThreatActorsController {
  constructor(private readonly threatActors: ThreatActorsService, private readonly mitreIngestion: MitreThreatActorIngestionService) {}

  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: ListThreatActorsQueryDto) { return this.threatActors.list(req.user, query); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.threatActors.get(req.user, id, tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateThreatActorDto, @Query('tenantId') tenantId?: string) { return this.threatActors.create(req.user, body, tenantId); }
  @Post('upsert') @Roles('SUPER_ADMIN', 'ADMIN')
  upsert(@Req() req: { user: AuthUser }, @Body() body: unknown, @Query('tenantId') tenantId?: string) { return this.threatActors.upsert(req.user, parseStixThreatActorDto(body), tenantId); }
  @Post('batch') @Roles('SUPER_ADMIN', 'ADMIN')
  batch(@Req() req: { user: AuthUser }, @Body() body: unknown, @Query('tenantId') tenantId?: string) { return this.threatActors.batch(req.user, parseBatchThreatActorsDto(body), tenantId); }
  @Post('ingest-mitre') @Roles('SUPER_ADMIN', 'ADMIN')
  ingestMitre(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.mitreIngestion.ingest(req.user, tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateThreatActorDto, @Query('tenantId') tenantId?: string) { return this.threatActors.update(req.user, id, body, tenantId); }
  @Delete(':id') @Roles('SUPER_ADMIN', 'ADMIN')
  remove(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.threatActors.remove(req.user, id, tenantId); }
}
