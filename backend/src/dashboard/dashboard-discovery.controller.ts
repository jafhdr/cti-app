import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AuthUser } from '../users/users.types';
import { DashboardDiscoveryService } from './dashboard-discovery.service';
import { DashboardNotificationsService } from './dashboard-notifications.service';
import { DashboardNotificationQuery, DashboardSearchQuery } from './dashboard-discovery.dto';

@Controller('dashboard')
@UseGuards(AuthGuard, RolesGuard)
export class DashboardDiscoveryController {
  constructor(private readonly discovery: DashboardDiscoveryService, private readonly notices: DashboardNotificationsService) {}

  @Get('search') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  search(@Req() req: { user: AuthUser }, @Query() query: DashboardSearchQuery) {
    return this.discovery.search(req.user, query.q, query.tenantId);
  }

  @Get('notifications') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  notifications(@Req() req: { user: AuthUser }, @Query() query: DashboardNotificationQuery) {
    return this.notices.list(req.user, query);
  }

  @Patch('notifications/:id/read') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  markRead(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.notices.markRead(req.user, id, tenantId);
  }
}
