import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { telemetrySchema } from './correlation.dto';
import { CorrelationService } from './correlation.service';
import { CorrelationConnectorService } from './correlation-connector.service';
import { CorrelationCaseService } from './correlation-case.service';

@Controller('threat-correlations')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('indicator-management')
export class CorrelationController {
  constructor(private readonly correlations: CorrelationService, private readonly connector: CorrelationConnectorService, private readonly cases: CorrelationCaseService) {}

  @Get('alerts/:alertId/case') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  linkedCase(@Req() req: { user: AuthUser }, @Param('alertId') alertId: string, @Query('tenantId') tenantId?: string) {
    return this.cases.get(req.user, alertId, tenantId);
  }

  @Post('alerts/:alertId/case') @Roles('SUPER_ADMIN', 'ADMIN')
  linkCase(@Req() req: { user: AuthUser }, @Param('alertId') alertId: string, @Body() body: unknown, @Query('tenantId') tenantId?: string) {
    const input = body as { caseId?: unknown; createCase?: unknown } | null;
    if (!input || typeof input !== 'object' || (input.caseId !== undefined && typeof input.caseId !== 'string') || (input.createCase !== undefined && input.createCase !== true) || Object.keys(input).some(key => key !== 'caseId' && key !== 'createCase')) throw new BadRequestException('Invalid case link request');
    return this.cases.link(req.user, alertId, input as { caseId?: string; createCase?: true }, tenantId);
  }

  @Post('connector/events') @Roles('SUPER_ADMIN', 'ADMIN')
  enqueue(@Req() req: { user: AuthUser }, @Body() body: unknown) {
    const parsed = telemetrySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid connector telemetry');
    return this.connector.enqueue(req.user, parsed.data);
  }

  @Get('connector/health') @Roles('SUPER_ADMIN', 'ADMIN')
  health(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.connector.health(req.user, tenantId);
  }

  @Get('connector/events/:id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  status(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId: string | undefined, @Param('id') id: string) {
    return this.connector.status(req.user, id, tenantId);
  }

  @Post('qa-telemetry') @Roles('SUPER_ADMIN', 'ADMIN')
  ingest(@Req() req: { user: AuthUser }, @Body() body: unknown) {
    const parsed = telemetrySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid synthetic telemetry');
    return this.correlations.ingest(req.user, parsed.data);
  }

  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  list(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.correlations.list(req.user, tenantId);
  }
}
