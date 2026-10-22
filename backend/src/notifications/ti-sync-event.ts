import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export type SyncWorkflow = 'FEED' | 'MITRE';

type SyncIdentity = {
  readonly tenantId: string;
  readonly userId: string;
  readonly workflow: SyncWorkflow;
  readonly sourceKey: string;
  readonly sourceName: string;
};

export async function recordSyncSuccess(tx: Prisma.TransactionClient, input: SyncIdentity & {
  readonly runId: string;
  readonly created: number;
  readonly updated: number;
}): Promise<void> {
  await tx.auditLog.create({ data: { tenantId: input.tenantId, userId: input.userId, action: 'TI_SYNC_ATTEMPT_SUCCEEDED',
    metadata: { sourceKey: input.sourceKey, runId: input.runId } } });
  if (input.created + input.updated === 0) return;
  await tx.notificationOutbox.createMany({ data: [{ id: `ti-sync-summary:${input.runId}`, tenantId: input.tenantId,
    type: 'TI_SYNC_COMPLETED', payloadVersion: 1,
    payload: { workflow: input.workflow, sourceKey: input.sourceKey, sourceName: input.sourceName,
      created: input.created, updated: input.updated, runId: input.runId } }], skipDuplicates: true });
}

export async function recordSyncFailure(prisma: PrismaService, input: SyncIdentity): Promise<void> {
  for (let retry = 0; ; retry += 1) {
    try {
      await prisma.$transaction(async tx => {
        const latestSuccess = await tx.auditLog.findFirst({ where: { tenantId: input.tenantId, action: 'TI_SYNC_ATTEMPT_SUCCEEDED',
          metadata: { path: ['sourceKey'], equals: input.sourceKey } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true } });
        const failures = await tx.auditLog.findMany({ where: { tenantId: input.tenantId, action: 'TI_SYNC_ATTEMPT_FAILED',
          metadata: { path: ['sourceKey'], equals: input.sourceKey }, ...(latestSuccess ? { createdAt: { gt: latestSuccess.createdAt } } : {}) },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true }, take: 3 });
        const current = await tx.auditLog.create({ data: { tenantId: input.tenantId, userId: input.userId,
          action: 'TI_SYNC_ATTEMPT_FAILED', metadata: { sourceKey: input.sourceKey } } });
        if (failures.length < 2) return;
        const firstId = failures[0]?.id ?? current.id;
        await tx.notificationOutbox.createMany({ data: [{ id: `ti-sync-failure:${firstId}`, tenantId: input.tenantId,
          type: 'TI_SYNC_FAILED', payloadVersion: 1,
          payload: { workflow: input.workflow, sourceKey: input.sourceKey, sourceName: input.sourceName,
            failureCount: 3 } }], skipDuplicates: true });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || retry >= 7) throw error;
    }
  }
}

export function newSyncRunId(): string { return randomUUID(); }
