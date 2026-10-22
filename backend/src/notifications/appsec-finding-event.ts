import { Prisma } from '@prisma/client';

export type AppSecFindingEvent = 'APPSEC_FINDING_CREATED_HIGH_RISK' | 'APPSEC_FINDING_REOPENED';

export async function enqueueAppSecFinding(
  tx: Prisma.TransactionClient,
  input: { readonly tenantId: string; readonly findingId: string; readonly actorId: string; readonly type: AppSecFindingEvent },
): Promise<void> {
  await tx.notificationOutbox.create({ data: {
    tenantId: input.tenantId,
    type: input.type,
    payloadVersion: 1,
    payload: { findingId: input.findingId, actorId: input.actorId },
  } });
}
