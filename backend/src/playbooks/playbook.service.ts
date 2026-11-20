import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../users/users.types';
import { effectiveIndicatorEligibility } from '../indicators/indicator-eligibility';
import type { DecidePlaybook, TriggerPlaybook } from './playbook.dto';
import { nextPlaybookState, PlaybookTransitionError, PLAYBOOK_KEY, PLAYBOOK_MAX_ATTEMPTS, PLAYBOOK_TIMEOUT_MS, PLAYBOOK_VERSION, simulationAllowed } from './playbook-policy';
import { connectorConfig } from './sandbox-contract';

const detail = { definition: true, alert: { select: { id: true, title: true, status: true, caseId: true } },
  steps: { include: { receipts: { orderBy: { createdAt: 'asc' as const } } }, orderBy: { ordinal: 'asc' as const } },
  decisions: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'asc' as const } },
  sandboxJobs: { include: { events: { orderBy: { createdAt: 'asc' as const } } }, orderBy: { createdAt: 'asc' as const } } } satisfies Prisma.PlaybookRunInclude;
const digest = (domain: string): string => createHash('sha256').update(domain).digest('hex');
const stateSchema = z.enum(['PENDING_CONFIRMATION', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'VERIFYING', 'VERIFIED', 'FAILED', 'REJECTED', 'EXPIRED']);

@Injectable()
export class PlaybookService {
  constructor(private readonly prisma: PrismaService) {}

  capabilities() {
    const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/disabled').pathname.slice(1);
    const simulationEnabled = simulationAllowed(process.env.SICTI_SOAR_QA_ENABLED, process.env.SICTI_ISOLATED_QA, database);
    let connectorEnabled = false;
    if (simulationEnabled) { try { connectorConfig(); connectorEnabled = true; } catch { /* connector remains disabled */ } }
    return { simulationEnabled, connectorEnabled, adapter: 'IN_PROCESS_SANDBOX' as const };
  }

  private tenant(user: AuthUser, requested?: string): string {
    if (user.role === 'SUPER_ADMIN') {
      if (!requested) throw new BadRequestException('Tenant required');
      return requested;
    }
    if (!user.tenantId || (requested && requested !== user.tenantId)) throw new ForbiddenException('Tenant context denied');
    return user.tenantId;
  }

  private qaEnabled(): void {
    const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/disabled').pathname.slice(1);
    if (!simulationAllowed(process.env.SICTI_SOAR_QA_ENABLED, process.env.SICTI_ISOLATED_QA, database)) throw new NotFoundException('Simulated execution unavailable');
  }

  async list(user: AuthUser, requested?: string) {
    const tenantId = this.tenant(user, requested);
    return this.prisma.playbookRun.findMany({ where: { tenantId, ...(user.role === 'USER' ? { tlp: { not: 'RED' as const } } : {}) }, include: detail, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async eligibleAlerts(user: AuthUser, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const rows = await this.prisma.threatCorrelation.findMany({ where: { tenantId, event: { observableType: 'DOMAIN', ...(user.role === 'USER' ? { tlp: { not: 'RED' as const } } : {}) } },
      include: { event: { select: { observableValue: true, tlp: true } }, indicator: true, alert: { select: { title: true, status: true, source: true } } }, orderBy: { correlatedAt: 'desc' }, take: 100 });
    return rows.filter(row => row.alert.source === 'CORRELATION' && row.indicator.type === 'DOMAIN'
      && row.event.observableValue === row.indicator.value && effectiveIndicatorEligibility(row.indicator, new Date()).eligible)
      .map(row => ({ id: row.id, alertId: row.alertId, domain: row.event.observableValue, title: row.alert.title, tlp: row.event.tlp }));
  }

  async get(user: AuthUser, id: string, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const run = await this.prisma.playbookRun.findFirst({ where: { id, tenantId, ...(user.role === 'USER' ? { tlp: { not: 'RED' as const } } : {}) }, include: detail });
    if (!run) throw new NotFoundException('Playbook run unavailable');
    return run;
  }

  async trigger(user: AuthUser, input: TriggerPlaybook, requested?: string) {
    const tenantId = this.tenant(user, requested);
    const prior = await this.prisma.playbookRun.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: detail });
    if (prior) {
      if (prior.alertId !== input.alertId || (input.caseId !== undefined && prior.caseId !== input.caseId)) throw new ConflictException('Idempotency key belongs to another alert');
      return prior;
    }
    const correlation = await this.prisma.threatCorrelation.findFirst({ where: { tenantId, alertId: input.alertId },
      include: { event: true, indicator: true, alert: true } });
    if (!correlation || correlation.alert.source !== 'CORRELATION' || correlation.event.observableType !== 'DOMAIN'
      || correlation.indicator.type !== 'DOMAIN' || correlation.event.observableValue !== correlation.indicator.value
      || !effectiveIndicatorEligibility(correlation.indicator, new Date()).eligible) throw new NotFoundException('Eligible malicious-domain correlation unavailable');
    const caseId = input.caseId ?? correlation.alert.caseId;
    if (caseId) {
      const linked = await this.prisma.case.findFirst({ where: { id: caseId, tenantId, alerts: { some: { id: input.alertId } } }, select: { id: true } });
      if (!linked) throw new NotFoundException('Linked case unavailable');
    }
    try {
      return await this.prisma.$transaction(async tx => {
        const definition = await tx.playbookDefinition.upsert({ where: { tenantId_key_version: { tenantId, key: PLAYBOOK_KEY, version: PLAYBOOK_VERSION } },
          create: { tenantId, key: PLAYBOOK_KEY, version: PLAYBOOK_VERSION, title: 'Simulated malicious-domain block', actionKind: 'SIMULATED_DOMAIN_BLOCK',
            policy: { approval: 'separate-analyst', adapter: 'sandbox-only', maxAttempts: PLAYBOOK_MAX_ATTEMPTS, timeoutMs: PLAYBOOK_TIMEOUT_MS } }, update: {} });
        const run = await tx.playbookRun.create({ data: { tenantId, definitionId: definition.id, alertId: input.alertId, caseId, caseTenantId: caseId ? tenantId : null,
          idempotencyKey: input.idempotencyKey, domain: correlation.event.observableValue, tlp: correlation.event.tlp, triggeredById: user.sub } });
        await tx.playbookStep.create({ data: { tenantId, runId: run.id, ordinal: 1, actionKind: 'SIMULATED_DOMAIN_BLOCK' } });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'PLAYBOOK_TRIGGERED', metadata: { runId: run.id, alertId: input.alertId, caseId, definitionVersion: PLAYBOOK_VERSION } } });
        return tx.playbookRun.findUniqueOrThrow({ where: { id: run.id }, include: detail });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const repeated = await this.prisma.playbookRun.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: detail });
        if (repeated && repeated.alertId === input.alertId && (input.caseId === undefined || repeated.caseId === input.caseId)) return repeated;
        throw new ConflictException('Idempotency key belongs to another alert');
      }
      throw error;
    }
  }

  async decide(user: AuthUser, id: string, input: DecidePlaybook, requested?: string) {
    const tenantId = this.tenant(user, requested);
    return this.prisma.$transaction(async tx => {
      const run = await tx.playbookRun.findFirst({ where: { id, tenantId }, include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 } } });
      if (!run) throw new NotFoundException('Playbook run unavailable');
      if (Date.now() - run.createdAt.getTime() > 86400000) {
        if (run.status === 'PENDING_CONFIRMATION' || run.status === 'PENDING_APPROVAL') {
          await tx.playbookRun.update({ where: { id }, data: { status: 'EXPIRED' } });
          await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'PLAYBOOK_EXPIRED', metadata: { runId: id, from: run.status } } });
          return tx.playbookRun.findUniqueOrThrow({ where: { id }, include: detail });
        }
        throw new ConflictException('Approval window expired');
      }
      if (input.kind === 'APPROVE' && (run.triggeredById === user.sub || run.decisions[0]?.actorId === user.sub)) throw new ForbiddenException('A separate analyst must approve');
      let next: string;
      try { next = nextPlaybookState(stateSchema.parse(run.status), input.kind); }
      catch (error) { if (error instanceof PlaybookTransitionError) throw new ConflictException(error.message); throw error; }
      const changed = await tx.playbookRun.updateMany({ where: { id, tenantId, status: run.status }, data: { status: next } });
      if (changed.count !== 1) throw new ConflictException('Playbook state changed');
      await tx.playbookDecision.create({ data: { tenantId, runId: id, kind: input.kind, reason: input.reason, actorId: user.sub } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: `PLAYBOOK_${input.kind}`, metadata: { runId: id, from: run.status, to: next } } });
      return tx.playbookRun.findUniqueOrThrow({ where: { id }, include: detail });
    });
  }

  async execute(user: AuthUser, id: string, requested?: string) {
    this.qaEnabled();
    const tenantId = this.tenant(user, requested);
    return this.prisma.$transaction(async tx => {
      const run = await tx.playbookRun.findFirst({ where: { id, tenantId }, include: { steps: true, decisions: true } });
      if (!run) throw new NotFoundException('Playbook run unavailable');
      if (run.status !== 'APPROVED') throw new ConflictException('Approval required before execution');
      if (run.domain.endsWith('.test')) throw new ConflictException('Synthetic connector target must use the sandbox queue');
      if (!run.decisions.some(decision => decision.kind === 'APPROVE' && decision.actorId !== run.triggeredById)) throw new ForbiddenException('Independent approval missing');
      if (Date.now() - run.updatedAt.getTime() > 86400000) {
        await tx.playbookRun.update({ where: { id }, data: { status: 'EXPIRED' } });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'PLAYBOOK_EXPIRED', metadata: { runId: id, from: 'APPROVED' } } });
        return tx.playbookRun.findUniqueOrThrow({ where: { id }, include: detail });
      }
      const step = run.steps[0];
      if (!step || step.attemptCount >= PLAYBOOK_MAX_ATTEMPTS) throw new ConflictException('Execution attempt limit reached');
      const changed = await tx.playbookRun.updateMany({ where: { id, tenantId, status: 'APPROVED' }, data: { status: 'EXECUTING' } });
      if (changed.count !== 1) throw new ConflictException('Playbook state changed');
      const started = Date.now();
      // This adapter records intent only. It has no network client or connector credentials.
      const targetDigest = digest(run.domain);
      const timedOut = process.env.SICTI_SOAR_QA_FORCE_TIMEOUT === 'true' || Date.now() - started > PLAYBOOK_TIMEOUT_MS;
      const attempt = step.attemptCount + 1;
      await tx.playbookStep.update({ where: { id: step.id }, data: { status: timedOut ? 'FAILED' : 'VERIFYING', attemptCount: attempt, startedAt: new Date(started), completedAt: timedOut ? new Date() : null, failureCode: timedOut ? 'SIMULATION_TIMEOUT' : null } });
      await tx.playbookReceipt.create({ data: { tenantId, runId: id, stepId: step.id, attempt, adapter: 'IN_PROCESS_SANDBOX', action: 'SIMULATED_DOMAIN_BLOCK',
        result: timedOut ? 'TIMEOUT' : 'SIMULATED', targetDigest, evidence: { sandboxOnly: true, alertId: run.alertId, simulatedAt: new Date().toISOString() }, actorId: user.sub } });
      await tx.playbookRun.update({ where: { id }, data: { status: timedOut ? 'FAILED' : 'VERIFYING' } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'PLAYBOOK_SIMULATION_EXECUTED', metadata: { runId: id, attempt, result: timedOut ? 'TIMEOUT' : 'SIMULATED', targetDigest } } });
      return tx.playbookRun.findUniqueOrThrow({ where: { id }, include: detail });
    });
  }

  async verify(user: AuthUser, id: string, requested?: string) {
    this.qaEnabled();
    const tenantId = this.tenant(user, requested);
    return this.prisma.$transaction(async tx => {
      const run = await tx.playbookRun.findFirst({ where: { id, tenantId }, include: { steps: { include: { receipts: { orderBy: { createdAt: 'desc' }, take: 1 } } } } });
      if (!run) throw new NotFoundException('Playbook run unavailable');
      if (run.status !== 'VERIFYING') throw new ConflictException('Run is not awaiting verification');
      const step = run.steps[0];
      const receipt = step?.receipts[0];
      if (!step || !receipt || receipt.result !== 'SIMULATED' || receipt.targetDigest !== digest(run.domain)) throw new ConflictException('Simulation receipt invalid');
      if (!step.startedAt || Date.now() - step.startedAt.getTime() > 86400000) {
        await tx.playbookRun.update({ where: { id }, data: { status: 'FAILED' } });
        await tx.playbookStep.update({ where: { id: step.id }, data: { status: 'FAILED', completedAt: new Date(), failureCode: 'VERIFICATION_TIMEOUT' } });
        await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'PLAYBOOK_VERIFICATION_TIMEOUT', metadata: { runId: id, receiptId: receipt.id } } });
        return tx.playbookRun.findUniqueOrThrow({ where: { id }, include: detail });
      }
      const changed = await tx.playbookRun.updateMany({ where: { id, tenantId, status: 'VERIFYING' }, data: { status: nextPlaybookState('VERIFYING', 'VERIFY') } });
      if (changed.count !== 1) throw new ConflictException('Playbook state changed');
      await tx.playbookStep.update({ where: { id: step.id }, data: { status: 'VERIFIED', completedAt: new Date() } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'PLAYBOOK_SIMULATION_VERIFIED', metadata: { runId: id, receiptId: receipt.id, targetDigest: receipt.targetDigest } } });
      return tx.playbookRun.findUniqueOrThrow({ where: { id }, include: detail });
    });
  }

  async retry(user: AuthUser, id: string, requested?: string) {
    this.qaEnabled();
    const tenantId = this.tenant(user, requested);
    return this.prisma.$transaction(async tx => {
      const run = await tx.playbookRun.findFirst({ where: { id, tenantId }, include: { steps: true, decisions: true } });
      if (!run) throw new NotFoundException('Playbook run unavailable');
      const step = run.steps[0];
      if (run.status !== 'FAILED' || !step || step.attemptCount >= PLAYBOOK_MAX_ATTEMPTS
        || !run.decisions.some(decision => decision.kind === 'APPROVE' && decision.actorId !== run.triggeredById)) throw new ConflictException('Retry unavailable');
      await tx.playbookRun.update({ where: { id }, data: { status: nextPlaybookState('FAILED', 'RETRY') } });
      await tx.playbookStep.update({ where: { id: step.id }, data: { status: 'PENDING', failureCode: null } });
      await tx.auditLog.create({ data: { tenantId, userId: user.sub, action: 'PLAYBOOK_RETRY_APPROVED', metadata: { runId: id, nextAttempt: step.attemptCount + 1 } } });
      return tx.playbookRun.findUniqueOrThrow({ where: { id }, include: detail });
    });
  }
}
