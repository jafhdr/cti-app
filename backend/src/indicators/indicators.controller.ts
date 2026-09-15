import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule } from '../auth/module-access.decorator';
import { AuthUser } from '../users/users.types';
import { IndicatorInput, ThreatActorAttributionInput } from './indicators.types';
import { IndicatorsService } from './indicators.service';
import { IndicatorFeedsService } from './indicator-feeds.service';
import { SyncIndicatorFeedsDto } from './indicator-feeds.types';
import { IndicatorEnrichmentService } from './indicator-enrichment.service';
import { ThreatActorAttributionService } from './threat-actor-attribution.service';

@Controller('indicators')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
export class IndicatorsController {
  constructor(
    private readonly indicators: IndicatorsService,
    private readonly feeds: IndicatorFeedsService,
    private readonly enrichment: IndicatorEnrichmentService,
    private readonly attribution: ThreatActorAttributionService,
  ) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query() query: Record<string, string | undefined>) { return this.indicators.list(req.user, query); }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: IndicatorInput) { return this.indicators.create(req.user, body); }

  @Post('feed-sync')
  @Roles('SUPER_ADMIN', 'ADMIN')
  syncFeeds(@Req() req: { user: AuthUser }, @Body() body: SyncIndicatorFeedsDto) { return this.feeds.sync(req.user, body.tenantId); }

  @Get('feed-status')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  feedStatus(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.feeds.status(req.user, tenantId); }

  @Get(':id/enrichments')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  enrichments(@Req() req: { user: AuthUser }, @Param('id') id: string) { return this.enrichment.list(req.user, id); }

  @Post(':id/enrich')
  @Roles('SUPER_ADMIN', 'ADMIN')
  enrich(@Req() req: { user: AuthUser }, @Param('id') id: string) { return this.enrichment.run(req.user, id); }

  @Post(':id/correlate-threat-actor')
  @Roles('SUPER_ADMIN', 'ADMIN')
  correlateThreatActor(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.indicators.correlateThreatActor(req.user, id);
  }

   @Post(':id/confirm-threat-actor')
   @Roles('SUPER_ADMIN', 'ADMIN')
   confirmThreatActor(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: ThreatActorAttributionInput) {
     return this.attribution.confirm(req.user, id, body.threatActorId);
   }

   @Post(':id/attribute-threat-actor')
   @Roles('SUPER_ADMIN', 'ADMIN')
   attributeThreatActor(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: ThreatActorAttributionInput) {
     return this.attribution.attribute(req.user, id, body.threatActorId);
   }

   @Post(':id/discover-threat-actors')
   @Roles('SUPER_ADMIN', 'ADMIN')
   discoverThreatActors(@Req() req: { user: AuthUser }, @Param('id') id: string) { return this.attribution.discover(req.user, id); }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: IndicatorInput) { return this.indicators.update(req.user, id, body); }

  @Patch(':id/deactivate')
  @Roles('SUPER_ADMIN', 'ADMIN')
  deactivate(@Req() req: { user: AuthUser }, @Param('id') id: string) { return this.indicators.deactivate(req.user, id); }
}
