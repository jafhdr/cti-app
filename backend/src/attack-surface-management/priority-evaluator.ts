export const PRIORITY_EVALUATOR_VERSION = 'asm-reviewed-priority-v1' as const;
const FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

export type PriorityCandidate = {
  readonly id: string;
  readonly tenantId: string;
  readonly assetId: string;
  readonly workflowVersion: number;
  readonly status: string;
  readonly reviewStatus: string | null;
  readonly evidenceHash: string | null;
  readonly reviewedEvidenceHash: string | null;
  readonly confidence: string;
  readonly lastSeenAt: Date;
  readonly currentSourceMatch?: boolean;
  readonly service: { readonly id: string; readonly tenantId: string; readonly assetId: string; readonly status: string; readonly lastSeenAt: Date; readonly port: number; readonly protocol: string };
  readonly vulnerability: { readonly id: string; readonly tenantId: string; readonly cveId: string; readonly severity: string; readonly cvssScore: number | null };
};

export type PriorityInput = {
  readonly tenantId: string;
  readonly assetId: string;
  readonly criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  readonly asOf: Date;
  readonly candidates: readonly PriorityCandidate[];
  readonly truncated?: boolean;
};

const criticalityWeights = { LOW: 10, MEDIUM: 20, HIGH: 30, CRITICAL: 40 } as const;
const severityWeights = { LOW: 10, MEDIUM: 20, HIGH: 30, CRITICAL: 40 } as const;
type Exclusion = 'FOREIGN_TENANT' | 'LEGACY_V1' | 'STALE' | 'PENDING' | 'REJECTED' | 'REVIEW_REQUIRED' |
  'EVIDENCE_CHANGED' | 'INVALID_RELATIONSHIP' | 'STALE_SOURCE' | 'UNKNOWN_SEVERITY';

function exclusion(item: PriorityCandidate, input: PriorityInput): Exclusion | null {
  if (item.tenantId !== input.tenantId || item.vulnerability.tenantId !== input.tenantId || item.service.tenantId !== input.tenantId) return 'FOREIGN_TENANT';
  if (item.assetId !== input.assetId || item.service.assetId !== input.assetId) return 'INVALID_RELATIONSHIP';
  if (item.workflowVersion !== 2) return 'LEGACY_V1';
  if (item.status !== 'ACTIVE' || item.service.status !== 'OPEN') return 'STALE';
  if (item.reviewStatus !== 'ACCEPTED') {
    if (item.reviewStatus === 'REJECTED') return 'REJECTED';
    if (item.reviewStatus === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
    return 'PENDING';
  }
  if (item.currentSourceMatch === false) return 'EVIDENCE_CHANGED';
  if (!item.evidenceHash || item.reviewedEvidenceHash !== item.evidenceHash) return 'EVIDENCE_CHANGED';
  const serviceAge = input.asOf.getTime() - item.service.lastSeenAt.getTime();
  const correlationAge = input.asOf.getTime() - item.lastSeenAt.getTime();
  if (serviceAge < 0 || correlationAge < 0 || serviceAge > FRESHNESS_MS || correlationAge > FRESHNESS_MS) return 'STALE_SOURCE';
  if (!(item.vulnerability.severity in severityWeights)) return 'UNKNOWN_SEVERITY';
  return null;
}

function severityWeight(value: string): number {
  if (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH' || value === 'CRITICAL') return severityWeights[value];
  return 0;
}

export function evaluateContextualPriority(input: PriorityInput) {
  const excluded: Partial<Record<Exclusion, number>> = {};
  const missing: string[] = [];
  if (!input.criticality) missing.push('ASSET_CRITICALITY_UNAVAILABLE');
  if (input.truncated) missing.push('CORRELATION_LIMIT_EXCEEDED');
  const seen = new Set<string>();
  const contributing = [] as Array<{
    correlationId: string; serviceId: string; vulnerabilityId: string; cveId: string; severity: string;
    machineConfidence: string; evidenceHash: string; serviceObservedAt: string; score: number;
    factors: { assetCriticality: number; cveSeverity: number; observedService: number; tiCvss: number | null };
  }>;
  for (const item of input.candidates) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const reason = exclusion(item, input);
    if (reason) { excluded[reason] = (excluded[reason] ?? 0) + 1; continue; }
    if (!input.criticality || input.truncated || !item.evidenceHash) continue;
    const cvss = item.vulnerability.cvssScore;
    if (cvss === null || !Number.isFinite(cvss) || cvss < 0 || cvss > 10) {
      if (!missing.includes('TI_CVSS_UNAVAILABLE')) missing.push('TI_CVSS_UNAVAILABLE');
    }
    const factors = {
      assetCriticality: criticalityWeights[input.criticality], cveSeverity: severityWeight(item.vulnerability.severity),
      observedService: 10, tiCvss: cvss !== null && Number.isFinite(cvss) && cvss >= 0 && cvss <= 10 ? Math.round(cvss) : null,
    };
    contributing.push({ correlationId: item.id, serviceId: item.service.id, vulnerabilityId: item.vulnerability.id,
      cveId: item.vulnerability.cveId, severity: item.vulnerability.severity, machineConfidence: item.confidence,
      evidenceHash: item.evidenceHash, serviceObservedAt: item.service.lastSeenAt.toISOString(),
      score: factors.assetCriticality + factors.cveSeverity + factors.observedService + (factors.tiCvss ?? 0), factors });
  }
  contributing.sort((a, b) => b.score - a.score || a.cveId.localeCompare(b.cveId) || a.serviceId.localeCompare(b.serviceId) || a.correlationId.localeCompare(b.correlationId));
  if (contributing.length === 0 && !missing.includes('NO_CURRENT_REVIEWED_EVIDENCE')) missing.push('NO_CURRENT_REVIEWED_EVIDENCE');
  const score = !input.truncated && input.criticality && contributing.length ? contributing[0].score : null;
  const priority = score === null ? 'NOT_ASSESSED' : score >= 85 ? 'CRITICAL' : score >= 65 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW';
  return {
    evaluatorVersion: PRIORITY_EVALUATOR_VERSION, asOf: input.asOf.toISOString(), assetId: input.assetId, assetCriticality: input.criticality,
    priority, score, eligibleCount: contributing.length, excluded, missing, contributing,
    explanation: score === null ? 'Current reviewed evidence or required asset context is insufficient for priority.'
      : `Priority uses the highest current reviewed asset-to-CVE relevance (${contributing[0].cveId}); ${contributing.length} eligible correlation(s) are listed. OPEN service means observed open port, not proven internet exposure.`,
    policy: { maxCorrelationAgeDays: 30, aggregation: 'maximum eligible score; no duplicate or count bonus',
      weights: { assetCriticality: criticalityWeights, cveSeverity: severityWeights, observedOpenService: 10, tiCvss: 'rounded 0–10 when available' } },
  };
}
