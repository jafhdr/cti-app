import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { AuditService } from './audit.service';

@Controller('audit-logs')
@UseGuards(AuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  list(
    @Req() req: { user: AuthUser },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
  ) {
    return this.audit.list(req.user, {
      page: Number(page) || 1,
      limit: Number(limit) || 50,
      tenantId: tenantId ? String(tenantId).trim() : undefined,
      userId: userId ? String(userId).trim() : undefined,
      action: action ? String(action).trim() : undefined,
    });
  }
}
