import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { type AuthUser } from '../users/users.types';
import { IntelligenceService } from './intelligence.service';
import { type AlertInput, type AlertStatusInput, type CaseInput, type CaseStatusInput, type EntityInput, type RelationshipInput } from './intelligence.types';

@Controller('intelligence')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
export class IntelligenceController {
  constructor(private readonly intelligence: IntelligenceService) {}

  @Get('overview')
  @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  overview(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.intelligence.overview(req.user, tenantId); }

  @Post('entities')
  @Roles('SUPER_ADMIN')
  createEntity(@Req() req: { user: AuthUser }, @Body() body: EntityInput) { return this.intelligence.createEntity(req.user, body); }

  @Post('relationships')
  @Roles('SUPER_ADMIN')
  createRelationship(@Req() req: { user: AuthUser }, @Body() body: RelationshipInput) { return this.intelligence.createRelationship(req.user, body); }

  @Post('cases')
  @Roles('SUPER_ADMIN')
  createCase(@Req() req: { user: AuthUser }, @Body() body: CaseInput) { return this.intelligence.createCase(req.user, body); }

  @Patch('cases/:id/status')
  @Roles('SUPER_ADMIN')
  updateCaseStatus(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: CaseStatusInput) { return this.intelligence.updateCaseStatus(req.user, id, body); }

  @Post('alerts')
  @Roles('SUPER_ADMIN')
  createAlert(@Req() req: { user: AuthUser }, @Body() body: AlertInput) { return this.intelligence.createAlert(req.user, body); }

  @Patch('alerts/:id/status')
  @Roles('SUPER_ADMIN')
  updateAlertStatus(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: AlertStatusInput) { return this.intelligence.updateAlertStatus(req.user, id, body); }
}
