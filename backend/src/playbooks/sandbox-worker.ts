import { createHash } from 'node:crypto';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SandboxClient } from './sandbox-client';
import { SandboxConnectorService } from './sandbox-connector.service';

@Injectable()
export class SandboxWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(private readonly prisma: PrismaService, private readonly client: SandboxClient, private readonly connector: SandboxConnectorService) {}

  onModuleInit(): void {
    if (!this.connector.enabled()) return;
    this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async tick(): Promise<void> {
    if (this.busy || !this.connector.enabled()) return;
    this.busy = true;
    try {
      const now = new Date();
      const exhausted = await this.prisma.sandboxConnectorJob.findMany({ where: { status: 'CLAIMED', leaseUntil: { lt: now }, attempts: { gte: 3 } }, take: 5 });
      for (const job of exhausted) {
        await this.prisma.$transaction(async tx => {
          const changed = await tx.sandboxConnectorJob.updateMany({ where: { id: job.id, status: 'CLAIMED', attempts: job.attempts }, data: { status: 'FAILED', leaseUntil: null, failureCode: 'SANDBOX_WORKER_INTERRUPTED' } });
          if (changed.count !== 1) return;
          await tx.playbookRun.update({ where: { id: job.runId }, data: { status: job.operation === 'UNBLOCK_DOMAIN' ? 'ROLLBACK_FAILED' : 'FAILED' } });
          await tx.sandboxConnectorEvent.create({ data: { tenantId: job.tenantId, runId: job.runId, jobId: job.id, kind: 'FAILED', evidence: { code: 'SANDBOX_WORKER_INTERRUPTED', attempt: job.attempts } } });
          await tx.auditLog.create({ data: { tenantId: job.tenantId, userId: job.requestedById, action: 'PLAYBOOK_SANDBOX_WORKER_INTERRUPTED', metadata: { runId: job.runId, jobId: job.id, attempt: job.attempts } } });
        });
      }
      const jobs = await this.prisma.sandboxConnectorJob.findMany({ where: { attempts: { lt: 3 }, OR: [{ status: 'QUEUED', nextAttemptAt: { lte: now } }, { status: 'CLAIMED', leaseUntil: { lt: now } }] }, orderBy: { createdAt: 'asc' }, take: 5 });
      for (const candidate of jobs) {
        const claimed = await this.prisma.sandboxConnectorJob.updateMany({ where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts }, data: { status: 'CLAIMED', attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + 15_000) } });
        if (claimed.count !== 1) continue;
        await this.process(candidate.id);
      }
    } finally { this.busy = false; }
  }

  private async process(id: string): Promise<void> {
    const job = await this.prisma.sandboxConnectorJob.findUniqueOrThrow({ where: { id }, include: { run: { include: { steps: true } } } });
    try {
      const acknowledgement = await this.client.action({ requestId: job.requestId, tenantId: job.tenantId, target: job.target, operation: job.operation as 'BLOCK_DOMAIN' | 'UNBLOCK_DOMAIN' });
      await this.prisma.sandboxConnectorEvent.create({ data: { tenantId: job.tenantId, runId: job.runId, jobId: id, kind: 'ACKNOWLEDGED', evidence: { requestId: job.requestId, blocked: acknowledgement.blocked, toolTimestamp: acknowledgement.timestamp } } });
      const state = await this.client.state({ tenantId: job.tenantId, target: job.target });
      const expected = job.operation === 'BLOCK_DOMAIN';
      if (state.blocked !== expected) throw new Error('SANDBOX_STATE_MISMATCH');
      await this.prisma.$transaction(async tx => {
        const changed = await tx.sandboxConnectorJob.updateMany({ where: { id, status: 'CLAIMED', attempts: job.attempts }, data: { status: 'SUCCEEDED', leaseUntil: null, failureCode: null } });
        if (changed.count !== 1) return;
        await tx.sandboxConnectorEvent.create({ data: { tenantId: job.tenantId, runId: job.runId, jobId: id, kind: 'STATE_VERIFIED', evidence: { blocked: state.blocked, toolTimestamp: state.timestamp, independentRequestId: state.requestId } } });
        if (expected) {
          const step = job.run.steps[0];
          if (step) {
            await tx.playbookStep.update({ where: { id: step.id }, data: { status: 'VERIFIED', attemptCount: { increment: 1 }, completedAt: new Date() } });
            await tx.playbookReceipt.create({ data: { tenantId: job.tenantId, runId: job.runId, stepId: step.id, attempt: 1, adapter: 'SIGNED_LOOPBACK_SANDBOX', action: job.operation, result: 'STATE_VERIFIED', targetDigest: createHash('sha256').update(job.target).digest('hex'), evidence: { sandboxOnly: true, requestId: job.requestId, stateRequestId: state.requestId, blocked: state.blocked }, actorId: job.requestedById } });
          }
        }
        await tx.playbookRun.update({ where: { id: job.runId }, data: { status: expected ? 'VERIFIED' : 'ROLLED_BACK' } });
        await tx.auditLog.create({ data: { tenantId: job.tenantId, userId: job.requestedById, action: expected ? 'PLAYBOOK_SANDBOX_STATE_VERIFIED' : 'PLAYBOOK_SANDBOX_ROLLBACK_VERIFIED', metadata: { runId: job.runId, jobId: id, requestId: job.requestId } } });
      });
    } catch (error) {
      const code = error instanceof Error && /^SANDBOX_[A-Z_0-9]+$/.test(error.message) ? error.message : 'SANDBOX_UNAVAILABLE';
      const terminal = job.attempts >= 3;
      await this.prisma.$transaction(async tx => {
        const changed = await tx.sandboxConnectorJob.updateMany({ where: { id, status: 'CLAIMED', attempts: job.attempts }, data: { status: terminal ? 'FAILED' : 'QUEUED', leaseUntil: null, nextAttemptAt: new Date(Date.now() + Math.min(30_000, 1000 * 2 ** job.attempts)), failureCode: code } });
        if (changed.count !== 1) return;
        await tx.sandboxConnectorEvent.create({ data: { tenantId: job.tenantId, runId: job.runId, jobId: id, kind: terminal ? 'FAILED' : 'RETRY_SCHEDULED', evidence: { code, attempt: job.attempts } } });
        await tx.auditLog.create({ data: { tenantId: job.tenantId, userId: job.requestedById, action: terminal ? 'PLAYBOOK_SANDBOX_FAILED' : 'PLAYBOOK_SANDBOX_RETRY_SCHEDULED', metadata: { runId: job.runId, jobId: id, code, attempt: job.attempts } } });
        if (terminal) await tx.playbookRun.update({ where: { id: job.runId }, data: { status: job.operation === 'UNBLOCK_DOMAIN' ? 'ROLLBACK_FAILED' : 'FAILED' } });
      });
    }
  }
}
