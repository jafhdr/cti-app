import type { Prisma } from '@prisma/client';
import { Prisma as PrismaRuntime } from '@prisma/client';

export type IndicatorSuppression = 'FALSE_POSITIVE' | 'SAFELIST' | null;

export type IndicatorEligibilityInput = {
  readonly status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
  readonly expiresAt: Date | null;
  readonly suppressionKind: IndicatorSuppression;
};

export type IndicatorEligibility =
  | { readonly eligible: true; readonly reason: null }
  | { readonly eligible: false; readonly reason: 'INACTIVE' | 'EXPIRED' | 'FALSE_POSITIVE' | 'SAFELIST' };

export function effectiveIndicatorEligibility(indicator: IndicatorEligibilityInput, now: Date): IndicatorEligibility {
  if (indicator.status === 'INACTIVE') return { eligible: false, reason: 'INACTIVE' };
  if (indicator.status === 'EXPIRED' || (indicator.expiresAt !== null && indicator.expiresAt <= now)) {
    return { eligible: false, reason: 'EXPIRED' };
  }
  if (indicator.suppressionKind !== null) return { eligible: false, reason: indicator.suppressionKind };
  return { eligible: true, reason: null };
}
export function operationalIndicatorWhere(tenantId: string | undefined, now: Date): Prisma.IndicatorWhereInput {
  return { ...(tenantId ? { tenantId } : {}), status: 'ACTIVE', suppressionKind: null, AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] };
}

export function isSerializationConflict(error: unknown): boolean {
  return error instanceof PrismaRuntime.PrismaClientKnownRequestError
    && (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001'));
}
