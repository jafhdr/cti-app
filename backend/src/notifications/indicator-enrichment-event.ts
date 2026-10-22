import type { Prisma } from '@prisma/client';

export async function enqueueIndicatorEnrichment(
  tx: Prisma.TransactionClient,
  input: {
    readonly tenantId: string;
    readonly jobId: string;
    readonly indicatorId: string;
    readonly requestedById: string | null;
    readonly type: 'INDICATOR_ENRICHMENT_COMPLETED' | 'INDICATOR_ENRICHMENT_FAILED';
    readonly resultKind: 'NEW' | 'CACHED' | 'FAILED';
  },
): Promise<void> {
  await tx.notificationOutbox.create({ data: {
    tenantId: input.tenantId,
    type: input.type,
    payloadVersion: 1,
    payload: { jobId: input.jobId, indicatorId: input.indicatorId, recipientId: input.requestedById, resultKind: input.resultKind },
  } });
}
