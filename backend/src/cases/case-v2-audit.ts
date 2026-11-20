import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

export async function writeCaseV2Audit(
  tx: Prisma.TransactionClient,
  input: { readonly tenantId: string; readonly caseId: string; readonly actorId: string; readonly action: string; readonly metadata: Prisma.InputJsonObject },
): Promise<void> {
  const [state] = await tx.$queryRaw<{ revision: number; occurredAt: Date }[]>`
    SELECT revision, clock_timestamp() AS "occurredAt" FROM "Case"
    WHERE id = ${input.caseId} AND "tenantId" = ${input.tenantId}`;
  if (!state) throw new Error('Case audit target disappeared');
  const metadata: Prisma.InputJsonObject = {
    ...input.metadata,
    requestId: randomUUID(),
    revision: state.revision,
    caseId: input.caseId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
  };
  await tx.caseActivity.create({ data: { tenantId: input.tenantId, caseId: input.caseId, actorId: input.actorId,
    action: input.action, metadata, createdAt: state.occurredAt } });
  await tx.auditLog.create({ data: { tenantId: input.tenantId, userId: input.actorId,
    action: input.action, metadata, createdAt: state.occurredAt } });
}
