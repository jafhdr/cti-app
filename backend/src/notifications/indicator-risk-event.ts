import type { IndicatorSeverity, Prisma } from '@prisma/client';

const severityRank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;

export function isSignificantRiskIncrease(previous: IndicatorSeverity, next: IndicatorSeverity): boolean {
  return severityRank[next] >= severityRank.HIGH && severityRank[next] > severityRank[previous];
}

export async function enqueueIndicatorRiskIncrease(tx: Prisma.TransactionClient, input: {
  readonly tenantId: string;
  readonly indicatorId: string;
  readonly previous: IndicatorSeverity;
  readonly next: IndicatorSeverity;
  readonly actorId: string | null;
  readonly source: 'MANUAL' | 'FEED';
}): Promise<void> {
  if (!isSignificantRiskIncrease(input.previous, input.next)) return;
  await tx.notificationOutbox.create({ data: {
    tenantId: input.tenantId,
    type: 'INDICATOR_RISK_CHANGED',
    payloadVersion: 1,
    payload: {
      indicatorId: input.indicatorId,
      previousSeverity: input.previous,
      nextSeverity: input.next,
      actorId: input.actorId,
      source: input.source,
    },
  } });
}
