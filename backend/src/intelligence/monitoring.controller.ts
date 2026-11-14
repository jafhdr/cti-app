import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { caseLinkSchema, observationSchema, redactSchema, reviewSchema, sourceConnectorSchema, sourceSchema, watchSchema, watchUpdateSchema } from './monitoring.dto';
import { MonitoringLinksService } from './monitoring-links.service';
import { MonitoringService, monitoringTenant } from './monitoring.service';
import { MonitoringCollectorService } from './monitoring-collector.service';

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { flatten(): unknown } } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}

@Controller('intelligence/monitoring')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService, private readonly links: MonitoringLinksService, private readonly collector: MonitoringCollectorService) {}

  @Get('collections') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  collections(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.collector.history(req.user, tenantId); }

  @Post('collections/schedule') @Roles('SUPER_ADMIN', 'ADMIN')
  scheduleCollection(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.collector.scheduleDue(monitoringTenant(req.user, tenantId));
  }

  @Post('collections/process') @Roles('SUPER_ADMIN', 'ADMIN')
  processCollection(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.collector.processDue(monitoringTenant(req.user, tenantId));
  }

  @Post('sources/:id/connector') @Roles('SUPER_ADMIN', 'ADMIN')
  configureConnector(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: unknown, @Query('tenantId') tenantId?: string) {
    const input = parse(sourceConnectorSchema, body);
    return this.collector.configure(req.user, id, input.intervalMinutes, tenantId);
  }

  @Post('sources/:id/collect') @Roles('SUPER_ADMIN', 'ADMIN')
  collect(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.collector.enqueue(req.user, id, tenantId); }

  @Patch('sources/:id/connector') @Roles('SUPER_ADMIN', 'ADMIN')
  disableConnector(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.collector.disable(req.user, id, tenantId); }

  @Get('watchlists') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  watchlists(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.monitoring.watchlists(req.user, tenantId); }

  @Post('watchlists') @Roles('SUPER_ADMIN', 'ADMIN')
  addWatchlist(@Req() req: { user: AuthUser }, @Body() body: unknown, @Query('tenantId') tenantId?: string) { return this.monitoring.addWatchlist(req.user, parse(watchSchema, body), tenantId); }

  @Patch('watchlists/:id') @Roles('SUPER_ADMIN', 'ADMIN')
  updateWatchlist(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: unknown, @Query('tenantId') tenantId?: string) { return this.monitoring.updateWatchlist(req.user, id, parse(watchUpdateSchema, body), tenantId); }

  @Get('sources') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  sources(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.monitoring.sources(req.user, tenantId); }

  @Post('sources') @Roles('SUPER_ADMIN', 'ADMIN')
  addSource(@Req() req: { user: AuthUser }, @Body() body: unknown, @Query('tenantId') tenantId?: string) { return this.monitoring.addSource(req.user, parse(sourceSchema, body), tenantId); }

  @Post('observations') @Roles('SUPER_ADMIN', 'ADMIN')
  ingest(@Req() req: { user: AuthUser }, @Body() body: unknown, @Query('tenantId') tenantId?: string) { return this.monitoring.ingest(req.user, parse(observationSchema, body), tenantId); }

  @Post('observations/:id/redact') @Roles('SUPER_ADMIN', 'ADMIN')
  redact(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: unknown, @Query('tenantId') tenantId?: string) { return this.monitoring.redact(req.user, id, parse(redactSchema, body).reason, tenantId); }

  @Get('findings') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  findings(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string, @Query('status') status?: string) {
    if (status && !['NEW', 'UNDER_REVIEW', 'CONFIRMED', 'FALSE_POSITIVE', 'RESOLVED'].includes(status)) throw new BadRequestException('Invalid finding status');
    return this.monitoring.findings(req.user, tenantId, status as 'NEW' | 'UNDER_REVIEW' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'RESOLVED' | undefined);
  }

  @Get('findings/:id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  detail(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.monitoring.detail(req.user, id, tenantId); }

  @Post('findings/:id/reviews') @Roles('SUPER_ADMIN', 'ADMIN')
  review(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: unknown, @Query('tenantId') tenantId?: string) { return this.monitoring.review(req.user, id, parse(reviewSchema, body), tenantId); }

  @Post('findings/:id/alert') @Roles('SUPER_ADMIN', 'ADMIN')
  alert(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.links.alert(req.user, id, tenantId); }

  @Post('findings/:id/case') @Roles('SUPER_ADMIN', 'ADMIN')
  case(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: unknown, @Query('tenantId') tenantId?: string) { return this.links.case(req.user, id, parse(caseLinkSchema, body), tenantId); }
}
