import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { IndicatorFeedsService } from './indicator-feeds.service';

const schedulerName = 'threat-feed-sync';
const defaultIntervalMinutes = 60;

@Injectable()
export class IndicatorFeedScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndicatorFeedScheduler.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly prisma: PrismaService,
    private readonly feeds: IndicatorFeedsService,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMinutes = this.intervalMinutes();
    const interval = setInterval(() => void this.run(), intervalMinutes * 60_000);
    this.schedulerRegistry.addInterval(schedulerName, interval);
    this.logger.log('indicator.feed.scheduler.registered', { intervalMinutes });
  }

  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('indicator.feed.scheduler.overlap_skipped');
      return;
    }

    this.running = true;
    this.logger.log('indicator.feed.scheduler.started');
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
            where: { isActive: true, role: { in: ['ADMIN', 'USER'] } },
            orderBy: { role: 'asc' },
            take: 1,
            select: { id: true, role: true },
          },
        },
      });

      for (const tenant of tenants) {
        const actor = tenant.users[0];
        if (!actor) {
          this.logger.warn('indicator.feed.scheduler.tenant_skipped', { tenantId: tenant.id, reason: 'no_active_user' });
          continue;
        }

        const user: AuthUser = { sub: actor.id, tenantId: tenant.id, role: actor.role };
        await this.feeds.sync(user);
      }
      this.logger.log('indicator.feed.scheduler.finished', { tenantCount: tenants.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scheduler error';
      this.logger.error('indicator.feed.scheduler.failed', { error: message });
    } finally {
      this.running = false;
    }
  }

  private intervalMinutes(): number {
    const configured = Number(this.config.get<string>('THREAT_FEED_SYNC_INTERVAL_MINUTES'));
    if (Number.isInteger(configured) && configured > 0) return configured;
    return defaultIntervalMinutes;
  }
}
