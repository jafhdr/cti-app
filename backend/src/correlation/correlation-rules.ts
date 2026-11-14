import type { IndicatorType } from '@prisma/client';

type Observation = { readonly type: IndicatorType; readonly value: string; readonly observedAt: Date; readonly confidence: number };
type Telemetry = Observation & { readonly ioaKind: string };
type Match = { readonly matched: true; readonly score: number; readonly reason: 'EXACT_IOC_WITHIN_5_MINUTES' } | { readonly matched: false };

export const correlationWindowMs = 5 * 60_000;

export function normalizeObservable(type: IndicatorType, value: string): string {
  const trimmed = value.trim();
  if (type === 'DOMAIN') return trimmed.toLowerCase().replace(/\.$/, '');
  if (type === 'EMAIL' || type === 'FILE_HASH') return trimmed.toLowerCase();
  if (type === 'URL') {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  }
  return trimmed;
}

export function evaluateCorrelation(telemetry: Telemetry, feed: Observation): Match {
  if (telemetry.type !== feed.type || normalizeObservable(telemetry.type, telemetry.value) !== normalizeObservable(feed.type, feed.value)) return { matched: false };
  if (Math.abs(telemetry.observedAt.getTime() - feed.observedAt.getTime()) > correlationWindowMs) return { matched: false };
  const score = Math.round((telemetry.confidence + feed.confidence) / 2);
  return score >= 70 ? { matched: true, score, reason: 'EXACT_IOC_WITHIN_5_MINUTES' } : { matched: false };
}
