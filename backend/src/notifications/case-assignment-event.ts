import { Prisma } from '@prisma/client';

type CaseAssignmentEvent = 'CASE_ASSIGNED' | 'CASE_REASSIGNED';

export async function enqueueCaseAssignment(
  tx: Prisma.TransactionClient,
  input: { readonly tenantId: string; readonly caseId: string; readonly recipientId: string; readonly actorId: string; readonly type: CaseAssignmentEvent },
): Promise<void> {
  await tx.notificationOutbox.create({
    data: {
      tenantId: input.tenantId,
      type: input.type,
      payloadVersion: 1,
      payload: { caseId: input.caseId, recipientId: input.recipientId, actorId: input.actorId },
    },
  });
}
