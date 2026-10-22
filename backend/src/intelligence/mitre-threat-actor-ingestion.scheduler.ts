import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { MitreThreatActorIngestionService } from './mitre-threat-actor-ingestion.service';
import { recordSyncFailure } from '../notifications/ti-sync-event';

const schedulerName = 'mitre-attack-sync';
const defaultIntervalMinutes = 1440;

@Injectable()
export class MitreThreatActorIngestionScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MitreThreatActorIngestionScheduler.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly prisma: PrismaService,
    private readonly ingestion: MitreThreatActorIngestionService,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMinutes = this.intervalMinutes();
    const interval = setInterval(() => void this.run(), intervalMinutes * 60_000);
    this.schedulerRegistry.addInterval(schedulerName, interval);
    this.logger.log('mitre.attack.scheduler.registered', { intervalMinutes });
  }

  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('mitre.attack.scheduler.overlap_skipped');
      return;
    }

    this.running = true;
    this.logger.log('mitre.attack.scheduler.started');
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: {
          isActive: true,
          subscription: { status: { in: ['TRIAL', 'ACTIVE'] }, renewalAt: { gt: new Date() } },
          moduleSettings: { some: { isEnabled: true, module: { slug: 'threat-intelligence', isActive: true } } },
        },
        select: {
          id: true,
          users: {
            where: { isActive: true, role: 'ADMIN' },
            take: 1,
            select: { id: true, role: true },
          },
        },
      });

      for (const tenant of tenants) {
        const admin = tenant.users[0];
        if (!admin) {
          this.logger.warn('mitre.attack.scheduler.tenant_skipped', { tenantId: tenant.id, reason: 'no_active_admin' });
          continue;
        }

        const user: AuthUser = { sub: admin.id, tenantId: tenant.id, role: admin.role };
        try {
          const result = await this.ingestion.ingest(user, undefined, true);
          this.logger.log('mitre.attack.scheduler.tenant_finished', { tenantId: tenant.id, ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown scheduler error';
          this.logger.error('mitre.attack.scheduler.tenant_failed', { tenantId: tenant.id, error: message });
          await recordSyncFailure(this.prisma, { tenantId: tenant.id, userId: admin.id, workflow: 'MITRE',
            sourceKey: 'MITRE:ATTACK', sourceName: 'MITRE ATT&CK' });
        }
      }
      this.logger.log('mitre.attack.scheduler.finished', { tenantCount: tenants.length });
    } finally {
      this.running = false;
    }
  }

  private intervalMinutes(): number {
    const configured = Number(this.config.get<string>('MITRE_ATTACK_SYNC_INTERVAL_MINUTES'));
    if (Number.isInteger(configured) && configured > 0) return configured;
    return defaultIntervalMinutes;
  }
}
