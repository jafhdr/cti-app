import { Prisma } from '@prisma/client';
import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma.service';

export async function logNotificationQueueHealth(prisma: PrismaService, logger: Logger): Promise<void> {
    const [row] = await prisma.$queryRaw<Array<{
      pending: number; oldestPendingSeconds: number | null; expiredLeases: number;
      terminalFailed: number; processed: number; retrying: number;
    }>>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
        EXTRACT(EPOCH FROM ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - MIN("createdAt") FILTER (WHERE status = 'PENDING')))::int AS "oldestPendingSeconds",
        COUNT(*) FILTER (WHERE status = 'PROCESSING' AND "leasedUntil" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))::int AS "expiredLeases",
        COUNT(*) FILTER (WHERE status = 'FAILED')::int AS "terminalFailed",
        COUNT(*) FILTER (WHERE status = 'PROCESSED')::int AS processed,
        COUNT(*) FILTER (WHERE status = 'PENDING' AND attempts > 0)::int AS retrying
      FROM "NotificationOutbox"`);
    const [attempts, sources, errors, delivered] = await Promise.all([
      prisma.notificationOutbox.groupBy({ by: ['attempts'], _count: true }),
      prisma.notificationOutbox.groupBy({ by: ['type'], _count: true }),
      prisma.notificationOutbox.groupBy({ by: ['lastError'], where: { status: 'FAILED' }, _count: true }),
      prisma.notification.count(),
    ]);
    const source = (type: string) => type.startsWith('CASE_') ? 'CASE' : type.startsWith('APPSEC_') ? 'APPSEC'
      : type.startsWith('INDICATOR_') ? 'TI' : 'UNKNOWN';
    const sourceCounts: Record<string, number> = {};
    for (const entry of sources) sourceCounts[source(entry.type)] = (sourceCounts[source(entry.type)] ?? 0) + entry._count;
    const safeErrors: Record<string, number> = {};
    for (const entry of errors) {
      const category = ['INVALID_PAYLOAD', 'UnsupportedEvent', 'UnsupportedPayloadVersion', 'DELIVERY_FAILED'].includes(entry.lastError ?? '')
        ? entry.lastError! : 'OTHER';
      safeErrors[category] = (safeErrors[category] ?? 0) + entry._count;
    }
    logger.log(JSON.stringify({ event: 'notification.worker.queue_health', enabled: process.env.NOTIFICATION_WORKER_ENABLED === 'true',
      pending: row.pending, oldestPendingSeconds: row.oldestPendingSeconds, expiredLeases: row.expiredLeases,
      terminalFailed: row.terminalFailed, processed: row.processed, delivered, retrying: row.retrying,
      attempts: Object.fromEntries(attempts.map(entry => [entry.attempts, entry._count])), sources: sourceCounts, errors: safeErrors }));
  }

