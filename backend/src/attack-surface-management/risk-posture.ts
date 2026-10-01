type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type Finding = { readonly id: string; readonly severity: Severity };
type Previous = { readonly score: number; readonly highImpactFindingIds: readonly string[] };
export type RiskPosture = {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly total: number;
  readonly score: number;
  readonly previousScore: number | null;
  readonly trend: 'BASELINE' | 'INCREASED' | 'DECREASED' | 'UNCHANGED';
  readonly highImpactFindingIds: readonly string[];
  readonly newHighImpactFindingIds: readonly string[];
  readonly shouldAlert: boolean;
};

export function evaluateRiskPosture(findings: readonly Finding[], previous: Previous | null): RiskPosture {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  const highImpactFindingIds: string[] = [];
  for (const finding of findings) {
    switch (finding.severity) {
      case 'CRITICAL': counts.critical++; highImpactFindingIds.push(finding.id); break;
      case 'HIGH': counts.high++; highImpactFindingIds.push(finding.id); break;
      case 'MEDIUM': counts.medium++; break;
      case 'LOW': counts.low++; break;
      default: { const exhaustive: never = finding.severity; return exhaustive; }
    }
  }
  highImpactFindingIds.sort();
  const score = counts.critical * 8 + counts.high * 4 + counts.medium * 2 + counts.low;
  const previousIds = new Set(previous?.highImpactFindingIds ?? []);
  const newHighImpactFindingIds = highImpactFindingIds.filter(id => !previousIds.has(id));
  const trend = !previous ? 'BASELINE' : score > previous.score ? 'INCREASED' : score < previous.score ? 'DECREASED' : 'UNCHANGED';
  return {
    ...counts, total: findings.length, score, previousScore: previous?.score ?? null, trend,
    highImpactFindingIds, newHighImpactFindingIds,
    shouldAlert: trend === 'INCREASED' && previous !== null && score - previous.score >= 8 && newHighImpactFindingIds.length >= 2,
  };
}
