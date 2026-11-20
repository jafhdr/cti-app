import type { Prisma } from '@prisma/client';

export async function lockFingerprintService(tx: Prisma.TransactionClient, tenantId: string, serviceId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'fingerprint:' + tenantId + ':' + serviceId}, 0)) IS NULL AS locked`;
}

export async function latestFingerprint(tx: Prisma.TransactionClient, tenantId: string, serviceId: string) {
  return tx.asmServiceFingerprintObservation.findFirst({
    where: { tenantId, serviceId },
    orderBy: [{ observedAt: 'desc' }, { discoveryRun: { startedAt: 'desc' } }, { id: 'desc' }],
  });
}
