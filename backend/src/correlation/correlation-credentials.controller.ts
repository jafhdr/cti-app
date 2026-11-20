import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';
import { telemetrySchema } from './correlation.dto';
import { CorrelationConnectorService } from './correlation-connector.service';
import { CorrelationCredentialsService } from './correlation-credentials.service';

const issueSchema = z.object({ tenantId: z.string().min(1).optional(), name: z.string().trim().min(2).max(80), expiresInDays: z.number().int().min(1).max(90) }).strict();
const rotateSchema = z.object({ tenantId: z.string().min(1).optional(), expiresInDays: z.number().int().min(1).max(90) }).strict();

@Controller('threat-correlations/connector-credentials')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('indicator-management')
@Roles('SUPER_ADMIN', 'ADMIN')
export class CorrelationCredentialsController {
  constructor(private readonly credentials: CorrelationCredentialsService) {}

  @Post()
  create(@Req() req: { user: AuthUser }, @Body() body: unknown) {
    const parsed = issueSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid credential request');
    return this.credentials.create(req.user, parsed.data.name, parsed.data.expiresInDays, parsed.data.tenantId);
  }

  @Get()
  list(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.credentials.list(req.user, tenantId);
  }

  @Post(':id/rotate')
  rotate(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: unknown) {
    const parsed = rotateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid rotation request');
    return this.credentials.rotate(req.user, id, parsed.data.expiresInDays, parsed.data.tenantId);
  }

  @Delete(':id')
  revoke(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.credentials.revoke(req.user, id, tenantId);
  }
}

@Controller('threat-correlations/machine')
export class CorrelationMachineController {
  constructor(private readonly credentials: CorrelationCredentialsService, private readonly connector: CorrelationConnectorService) {}

  @Post('events')
  async ingest(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const identity = await this.credentials.authenticate(authorization);
    const parsed = telemetrySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid connector telemetry');
    return this.connector.enqueueMachine(identity.tenantId, identity.credentialId, parsed.data);
  }
}
