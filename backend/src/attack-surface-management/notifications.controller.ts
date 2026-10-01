import { BadRequestException, Controller, Get, NotFoundException, Param, Patch, Put, Body, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ModuleAccessGuard } from '../auth/module-access.guard';
import { RequiresModule, RequiresModuleFeature } from '../auth/module-access.decorator';
import type { AuthUser } from '../users/users.types';

@Controller('attack-surface/notifications')
@UseGuards(AuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule('attack-surface-management')
@RequiresModuleFeature('asset-management')
export class AsmNotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  private async tenant(user: AuthUser, requested?: string): Promise<string> {
    const id = user.role === 'SUPER_ADMIN' ? requested : user.tenantId;
    if (!id) throw new BadRequestException('Tenant wajib');
    if (user.role === 'SUPER_ADMIN' && !await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException('Tenant tidak ditemukan');
    return id;
  }

  @Get() @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  async list(@Req() req: { user: AuthUser }, @Query('tenantId') requested?: string) {
    const tenantId = await this.tenant(req.user, requested);
    const rows = await this.prisma.asmNotification.findMany({ where: { tenantId }, take: 100, orderBy: { createdAt: 'desc' },
      include: { alert: { select: { id: true, title: true, severity: true, source: true, assetId: true, findingId: true, vulnerabilityCorrelationId: true, caseId: true, firstSeenAt: true } }, reads: { where: { userId: req.user.sub }, select: { readAt: true } } } });
    return rows.map(({ reads, ...row }) => ({ ...row, readAt: reads[0]?.readAt ?? null }));
  }

  @Patch(':id/read') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  async read(@Req() req: { user: AuthUser }, @Param('id') id: string, @Query('tenantId') requested?: string) {
    const tenantId = await this.tenant(req.user, requested);
    const item = await this.prisma.asmNotification.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Notification tidak ditemukan');
    return this.prisma.asmNotificationRead.upsert({ where: { notificationId_userId: { notificationId: id, userId: req.user.sub } }, create: { notificationId: id, userId: req.user.sub }, update: {} });
  }

  @Get('preferences') @Roles('SUPER_ADMIN', 'ADMIN', 'USER')
  async preferences(@Req() req: { user: AuthUser }, @Query('tenantId') requested?: string) {
    const tenantId = await this.tenant(req.user, requested);
    return await this.prisma.asmNotificationPreference.findUnique({ where: { tenantId } }) ?? { tenantId, enabled: true, minimumSeverity: 'HIGH', channel: 'IN_APP' };
  }

  @Put('preferences') @Roles('SUPER_ADMIN', 'ADMIN')
  async configure(@Req() req: { user: AuthUser }, @Body() body: { enabled?: unknown; minimumSeverity?: unknown }, @Query('tenantId') requested?: string) {
    const tenantId = await this.tenant(req.user, requested);
    if (typeof body.enabled !== 'boolean' || !['HIGH', 'CRITICAL'].includes(String(body.minimumSeverity))) throw new BadRequestException('Invalid notification preference');
    const minimumSeverity = body.minimumSeverity === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
    return this.prisma.asmNotificationPreference.upsert({ where: { tenantId }, create: { tenantId, enabled: body.enabled, minimumSeverity }, update: { enabled: body.enabled, minimumSeverity } });
  }
}
