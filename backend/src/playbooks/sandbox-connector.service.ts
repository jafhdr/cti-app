import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { connectorConfig } from './sandbox-contract';
import { simulationAllowed } from './playbook-policy';
import type { RecoverSandbox } from './playbook.dto';

@Injectable()
export class SandboxConnectorService {
  constructor(private readonly prisma: PrismaService) {}

  enabled(): boolean {
    const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/disabled').pathname.slice(1);
    if (!simulationAllowed(process.env.SICTI_SOAR_QA_ENABLED, process.env.SICTI_ISOLATED_QA, database)) return false;
    try { connectorConfig(); return true; } catch { return false; }
  }

  private gate(): void {
    if (!this.enabled()) throw new NotFoundException('Sandbox connector unavailable');
  }

  private tenant(user: AuthUser, requested?: string): string {
    if (user.role === 'SUPER_ADMIN') {
      if (!requested) throw new BadRequestException('Tenant required');
      return requested;
    }
    if (!user.tenantId || (requested && requested !== user.tenantId)) throw new ForbiddenException('Tenant context denied');
    return user.tenantId;
  }

  async detail(user: AuthUser, runId: string, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const run = await this.prisma.playbookRun.findFirst({ where: { id: runId, tenantId, ...(user.role === 'USER' ? { tlp: { not: 'RED' as const } } : {}) }, select: { id: true } });
    if (!run) throw new NotFoundException('Playbook run unavailable');
    return this.prisma.sandboxConnectorJob.findMany({ where: { tenantId, runId }, include: { events: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } });
  }

  async enqueue(user: AuthUser, runId: string, operation: 'BLOCK_DOMAIN' | 'UNBLOCK_DOMAIN', requested?: string) {
    this.gate();
    const tenantId = this.tenant(user, requested);
    return this.prisma.$transaction(async tx => {
      const run = await tx.playbookRun.findFirst({ where: { id: runId, tenantId }, include: { decisions: true } });
      if (!run) throw new NotFoundException('Playbook run unavailable');
      if (!/^(?:[a-z0-9-]+\.)+[a-z0-9-]+\.test$/.test(run.domain)) throw new BadRequestException('Synthetic .test target required');
      if (!run.decisions.some(row => row.kind === 'CONFIRM' && row.actorId === run.triggeredById) || !run.decisions.some(row => row.kind === 'APPROVE' && row.actorId !== run.triggeredById)) throw new ForbiddenException('Two analyst decisions required');
      const existing = await tx.sandboxConnectorJob.findUnique({ where: { runId_operation: { runId, operation } } });
      if (existing) return existing;
      if (operation === 'BLOCK_DOMAIN' && run.status !== 'APPROVED') throw new ConflictException('Approved run required');
      if (operation === 'UNBLOCK_DOMAIN' && run.status !== 'VERIFIED' && run.status !== 'ROLLBACK_FAILED') throw new ConflictException('Verified action required for rollback');
      const status = operation === 'BLOCK_DOMAIN' ? 'EXECUTING' : 'ROLLBACK_QUEUED';
      const changed = await tx.playbookRun.updateMany({ where: { id: runId, tenantId, status: run.status }, data: { status } });
      if (changed.count !== 1) throw new ConflictException('Run state changed');
      const job = await tx.sandboxConnectorJob.create({ data: { tenantId, runId, operation, target: run.domain, requestId: randomUUID(), requestedById: user.sub } });
      await tx.sandboxConnectorEvent.create({ data: { tenantId, runId, jobId: job.id, kind: 'QUEUED', evidence: { operation, requestedBy: user.sub, requestId: job.requestId } } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: `PLAYBOOK_SANDBOX_${operation}_QUEUED`, metadata: { runId, jobId: job.id } } });
      return job;
    });
  }

  async abort(user: AuthUser, runId: string, requested?: string) {
    this.gate();
    const tenantId = this.tenant(user, requested);
    return this.prisma.$transaction(async tx => {
      const job = await tx.sandboxConnectorJob.findFirst({ where: { tenantId, runId, operation: 'BLOCK_DOMAIN', status: 'QUEUED' }, orderBy: { createdAt: 'desc' } });
      if (!job) throw new ConflictException('Only unclaimed jobs can be safely aborted');
      const changed = await tx.sandboxConnectorJob.updateMany({ where: { id: job.id, status: 'QUEUED' }, data: { status: 'ABORTED' } });
      if (changed.count !== 1) throw new ConflictException('Job already claimed');
      await tx.playbookRun.update({ where: { id: runId }, data: { status: 'ABORTED' } });
      await tx.sandboxConnectorEvent.create({ data: { tenantId, runId, jobId: job.id, kind: 'ABORTED', evidence: { actorId: user.sub } } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'PLAYBOOK_SANDBOX_ABORTED', metadata: { runId, jobId: job.id } } });
      return { status: 'ABORTED' };
    });
  }

  async recoverRollback(user: AuthUser, runId: string, input: RecoverSandbox, requested?: string) {
    this.gate();
    const tenantId = this.tenant(user, requested);
    return this.prisma.$transaction(async tx => {
      const run = await tx.playbookRun.findFirst({ where: { id: runId, tenantId }, include: { decisions: true } });
      if (!run) throw new NotFoundException('Playbook run unavailable');
      if (!/^(?:[a-z0-9-]+\.)+[a-z0-9-]+\.test$/.test(run.domain)) throw new BadRequestException('Synthetic .test target required');
      if (!run.decisions.some(row => row.kind === 'CONFIRM' && row.actorId === run.triggeredById)
        || !run.decisions.some(row => row.kind === 'APPROVE' && row.actorId !== run.triggeredById)) throw new ForbiddenException('Two analyst decisions required');
      const job = await tx.sandboxConnectorJob.findUnique({ where: { runId_operation: { runId, operation: 'UNBLOCK_DOMAIN' } } });
      if (!job || job.tenantId !== tenantId) throw new NotFoundException('Rollback job unavailable');
      const replay = await tx.sandboxConnectorEvent.findFirst({ where: { tenantId, runId, jobId: job.id, kind: 'RECOVERY_QUEUED', evidence: { path: ['idempotencyKey'], equals: input.idempotencyKey } } });
      if (replay) return job;
      if (run.status !== 'ROLLBACK_FAILED' || job.status !== 'FAILED') throw new ConflictException('Terminal rollback failure required');
      const priorRecoveries = await tx.sandboxConnectorEvent.count({ where: { tenantId, runId, jobId: job.id, kind: 'RECOVERY_QUEUED' } });
      if (priorRecoveries >= 2) throw new ConflictException('Operator recovery limit reached');
      const requestId = randomUUID();
      const changed = await tx.playbookRun.updateMany({ where: { id: runId, tenantId, status: 'ROLLBACK_FAILED' }, data: { status: 'ROLLBACK_QUEUED' } });
      if (changed.count !== 1) throw new ConflictException('Run state changed');
      const updated = await tx.sandboxConnectorJob.updateMany({ where: { id: job.id, tenantId, status: 'FAILED', requestId: job.requestId }, data: { status: 'QUEUED', attempts: 0, requestId, requestedById: user.sub, nextAttemptAt: new Date(), leaseUntil: null, failureCode: null } });
      if (updated.count !== 1) throw new ConflictException('Rollback job changed');
      await tx.sandboxConnectorEvent.create({ data: { tenantId, runId, jobId: job.id, kind: 'RECOVERY_QUEUED', evidence: { ordinal: priorRecoveries + 1, actorId: user.sub, reason: input.reason, idempotencyKey: input.idempotencyKey, previousRequestId: job.requestId, requestId, previousFailureCode: job.failureCode } } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'PLAYBOOK_SANDBOX_ROLLBACK_RECOVERY_QUEUED', metadata: { runId, jobId: job.id, ordinal: priorRecoveries + 1, requestId } } });
      return tx.sandboxConnectorJob.findUniqueOrThrow({ where: { id: job.id } });
    });
  }
}
