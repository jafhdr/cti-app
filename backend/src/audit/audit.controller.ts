import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../users/users.types';
import { AuditService } from './audit.service';

@Controller('audit-logs')
@UseGuards(AuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('actions')
  @Roles('SUPER_ADMIN', 'ADMIN')
  actions(@Req() req: { user: AuthUser }, @Query('tenantId') tenantId?: string) {
    return this.audit.actions(req.user, tenantId?.trim() || undefined);
  }

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
      page: this.parseNumber(page, 1, 100000, 'page'),
      limit: this.parseNumber(limit, 50, 100, 'limit'),
      tenantId: tenantId ? String(tenantId).trim() : undefined,
      userId: userId ? String(userId).trim() : undefined,
      action: action ? String(action).trim() : undefined,
    });
  }

  private parseNumber(raw: string | undefined, defaultValue: number, maximum: number, name: string) {
    if (raw === undefined) return defaultValue;
    if (!/^[1-9]\d*$/.test(raw)) throw new BadRequestException(`${name} harus bilangan bulat positif`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > maximum) throw new BadRequestException(`${name} di luar rentang 1-${maximum}`);
    return value;
  }
}
