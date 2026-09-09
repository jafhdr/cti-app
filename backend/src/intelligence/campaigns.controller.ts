import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule } from '../auth/module-access.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { CreateCampaignDto, ListCampaignsQueryDto, UpdateCampaignDto } from './campaigns.dto';
import { CampaignsService } from './campaigns.service';

@Controller('intelligence/campaigns')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('threat-intelligence')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}
  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER') list(@Req() req: { user: AuthUser }, @Query() query: ListCampaignsQueryDto) { return this.campaigns.list(req.user, query); }
  @Get('relations') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') relations(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) { return this.campaigns.relations(req.user, tenantId); }
  @Get(':id') @Roles('SUPER_ADMIN', 'ADMIN', 'USER') get(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.campaigns.get(req.user, id, tenantId); }
  @Post() @Roles('SUPER_ADMIN', 'ADMIN') create(@Req() req: { user: AuthUser }, @Body() body: CreateCampaignDto, @Query('tenantId') tenantId?: string) { return this.campaigns.create(req.user, body, tenantId); }
  @Patch(':id') @Roles('SUPER_ADMIN', 'ADMIN') update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: UpdateCampaignDto, @Query('tenantId') tenantId?: string) { return this.campaigns.update(req.user, id, body, tenantId); }
  @Delete(':id') @Roles('SUPER_ADMIN', 'ADMIN') remove(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) { return this.campaigns.remove(req.user, id, tenantId); }
}
