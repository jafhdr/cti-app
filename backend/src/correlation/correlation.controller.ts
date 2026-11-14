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

@Controller('threat-correlations')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('indicator-management')
export class CorrelationController {
  constructor(private readonly correlations: CorrelationService, private readonly connector: CorrelationConnectorService) {}

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
