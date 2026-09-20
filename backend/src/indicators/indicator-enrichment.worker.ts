import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { IndicatorEnrichmentJob } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IndicatorEnrichmentService } from './indicator-enrichment.service';

const processingLeaseMs = 60_000;

type WorkerConfig = {
  readonly maxConcurrency: number;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly cooldownMs: number;
  readonly intervalMs: number;
};

@Injectable()
export class IndicatorEnrichmentWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndicatorEnrichmentWorker.name);
  private readonly config: WorkerConfig;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: IndicatorEnrichmentService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.config = {
      maxConcurrency: positiveInteger(process.env.VIRUSTOTAL_MAX_CONCURRENCY, 1),
      maxAttempts: positiveInteger(process.env.VIRUSTOTAL_MAX_ATTEMPTS, 5),
      retryBaseMs: positiveInteger(process.env.VIRUSTOTAL_RETRY_BASE_MS, 30_000),
      cooldownMs: nonNegativeInteger(process.env.VIRUSTOTAL_COOLDOWN_MS, 24 * 60 * 60_000),
      intervalMs: positiveInteger(process.env.VIRUSTOTAL_WORKER_INTERVAL_MS, 15_000),
    };
  }

  onApplicationBootstrap(): void {
    const interval = setInterval(() => void this.runScheduled(), this.config.intervalMs);
    this.schedulerRegistry.addInterval('virustotal-enrichment-worker', interval);
    this.logger.log('indicator.enrichment.worker.registered', { maxConcurrency: this.config.maxConcurrency });
  }

  private async runScheduled(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown worker error';
      this.logger.error('indicator.enrichment.worker.failed', { error: message });
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.recoverExpiredClaims();
      const jobs: IndicatorEnrichmentJob[] = [];
      for (let index = 0; index < this.config.maxConcurrency; index += 1) {
        const job = await this.claimNext();
        if (!job) break;
        jobs.push(job);
      }
      await Promise.all(jobs.map(job => this.process(job)));
    } finally {
      this.running = false;
    }
  }

  private async claimNext(): Promise<IndicatorEnrichmentJob | null> {
    return this.prisma.$transaction(async transaction => {
      const candidate = await transaction.indicatorEnrichmentJob.findFirst({
        where: { status: 'PENDING', availableAt: { lte: new Date() } },
        orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
      });
      if (!candidate) return null;
      const claimed = await transaction.indicatorEnrichmentJob.updateMany({
        where: { id: candidate.id, tenantId: candidate.tenantId, status: 'PENDING', availableAt: { lte: new Date() } },
        data: { status: 'PROCESSING', lockedAt: new Date(), attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) return null;
      return transaction.indicatorEnrichmentJob.findUnique({ where: { id: candidate.id } });
    });
  }

  private async process(job: IndicatorEnrichmentJob): Promise<void> {
    const result = await this.enrichment.runVirusTotalAutomation(job.tenantId, job.indicatorId, this.config.cooldownMs);
    if (result.kind === 'success' || result.kind === 'fresh') {
      await this.finish(job, 'SUCCESS', null, 'INDICATOR_ENRICHMENT_COMPLETED');
      return;
    }
    if (result.retryable && job.attempts < this.config.maxAttempts) {
      const availableAt = new Date(Date.now() + (result.retryAfterMs ?? this.backoffMs(job.attempts)));
      await this.prisma.indicatorEnrichmentJob.update({
        where: { id: job.id },
        data: { status: 'PENDING', availableAt, lockedAt: null, lastError: result.message },
      });
      this.logger.warn('indicator.enrichment.retry_scheduled', { jobId: job.id, tenantId: job.tenantId, attempts: job.attempts, availableAt });
      return;
    }
    await this.finish(job, 'FAILED', result.message, 'INDICATOR_ENRICHMENT_FAILED');
  }

  private async finish(job: IndicatorEnrichmentJob, status: 'SUCCESS' | 'FAILED', lastError: string | null, action: string): Promise<void> {
    await this.prisma.$transaction(async transaction => {
      await transaction.indicatorEnrichmentJob.update({ where: { id: job.id }, data: { status, lockedAt: null, lastError } });
      await transaction.auditLog.create({
        data: {
          userId: job.requestedById,
          tenantId: job.tenantId,
          action,
          metadata: { indicatorId: job.indicatorId, provider: job.provider, trigger: job.trigger, status, jobId: job.id },
        },
      });
    });
  }

  private async recoverExpiredClaims(): Promise<void> {
    await this.prisma.indicatorEnrichmentJob.updateMany({
      where: { status: 'PROCESSING', lockedAt: { lte: new Date(Date.now() - processingLeaseMs) } },
      data: { status: 'PENDING', lockedAt: null, availableAt: new Date() },
    });
  }

  private backoffMs(attempts: number): number {
    const exponential = this.config.retryBaseMs * 2 ** Math.max(0, attempts - 1);
    return Math.round(exponential * (0.75 + Math.random() * 0.5));
  }
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
