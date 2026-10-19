import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { type AuthUser } from '../users/users.types';
import { IntelligenceService } from './intelligence.service';
import { type EntityInput, type RelationshipInput } from './intelligence.types';

@Controller('intelligence')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
@RequiresModuleFeature('intelligence-hub')
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

}
