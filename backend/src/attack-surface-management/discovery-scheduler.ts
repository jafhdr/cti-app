import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ModuleAccessService } from '../auth/module-access.service';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { DiscoveryRunsService } from './discovery-runs.service';

@Injectable()
export class DiscoveryScheduler {
  private readonly logger = new Logger(DiscoveryScheduler.name);
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly access: ModuleAccessService, private readonly runs: DiscoveryRunsService) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.asmDiscoverySchedule.findMany({ where: { enabled: true, nextRunAt: { lte: new Date() }, asset: { tenant: { isActive: true } } }, orderBy: { nextRunAt: 'asc' }, take: 50 });
      for (const schedule of due) {
        try {
          const admins = await this.prisma.user.findMany({ where: { tenantId: schedule.tenantId, role: 'ADMIN', isActive: true }, select: { id: true, role: true } });
          let authorized: AuthUser | null = null;
          for (const admin of admins) {
            const candidate: AuthUser = { sub: admin.id, role: admin.role, tenantId: schedule.tenantId };
            const decision = await this.access.evaluate(candidate, 'attack-surface-management', ['asset-management', 'asset-discovery']);
            if (decision.accessible) { authorized = candidate; break; }
          }
          if (!authorized) continue;
          await this.runs.run(authorized, schedule.assetId, undefined, 'SCHEDULED');
        } catch (error) {
          this.logger.error(`asm.schedule.failed assetId=${schedule.assetId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally { this.running = false; }
  }
}
