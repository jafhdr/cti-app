import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthUser } from '../users/users.types';
import { AuditService } from './audit.service';

@Controller('audit-logs')
@UseGuards(AuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  list(@Req() req: { user: AuthUser }, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.audit.list(req.user, Number(page) || 1, Number(limit) || 50);
  }
}
