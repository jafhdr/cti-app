import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TelegramClient } from './telegram.client';
import { parseTelegramConfig, type TelegramConfig } from './telegram.config';
import { TelegramIngestion } from './telegram.ingestion';
import { IocCandidatesService } from './ioc-candidates.service';

const lockKey = 1_418_034_856;

@Injectable()
export class TelegramWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramWorker.name);
  private readonly config: TelegramConfig;
  private active = false;

  constructor(private readonly prisma: PrismaService, private readonly iocCandidates: IocCandidatesService) {
    this.config = parseTelegramConfig(process.env);
  }

  onApplicationBootstrap(): void {
    if (!this.config.enabled) return;
    this.active = true;
    void this.loop();
  }

  onApplicationShutdown(): void {
    this.active = false;
  }

  async pollOnce(client = new TelegramClient(this.config.botToken)): Promise<boolean> {
    const polled = await this.prisma.$transaction(async transaction => {
      const acquired = await transaction.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`SELECT pg_try_advisory_xact_lock(${lockKey}) AS acquired`);
      if (!acquired[0]?.acquired) return false;
      const sources = await transaction.intelligenceSource.findMany({
        where: { telegramChatId: { not: null }, status: 'ACTIVE' },
        select: { id: true, tenantId: true },
      });
      if (sources.length === 0) return true;
      const states = await transaction.telegramPollingState.findMany({ where: { intelligenceSourceId: { in: sources.map(source => source.id) } } });
      const lastUpdateIds = states.flatMap(state => state.lastUpdateId === null ? [] : [Number(state.lastUpdateId)]);
      const offset = lastUpdateIds.length === 0 ? 0 : Math.min(...lastUpdateIds) + 1;
      const updates = await client.getUpdates(offset, this.config.timeoutSeconds, this.config.batchLimit);
      const ingestion = new TelegramIngestion(transaction, this.config.allowedChatIds);
      for (const update of updates) {
        await ingestion.process(update);
        for (const source of sources) {
          await transaction.telegramPollingState.upsert({
            where: { intelligenceSourceId_tenantId: { intelligenceSourceId: source.id, tenantId: source.tenantId } },
            create: { intelligenceSourceId: source.id, tenantId: source.tenantId, lastUpdateId: String(update.update_id) },
            update: { lastUpdateId: String(update.update_id) },
          });
        }
      }
      return true;
    }, { timeout: (this.config.timeoutSeconds + 15) * 1_000 });
    if (polled && this.iocCandidates) await this.iocCandidates.processPending();
    return polled;
  }

  private async loop(): Promise<void> {
    const client = new TelegramClient(this.config.botToken);
    while (this.active) {
      try {
        await this.pollOnce(client);
      } catch (error) {
        this.logger.error('telegram.poll.failed', { error: error instanceof Error ? error.name : 'UnknownError' });
        await new Promise(resolve => setTimeout(resolve, 5_000));
      }
    }
  }
}
