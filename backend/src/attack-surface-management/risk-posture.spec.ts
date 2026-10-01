import { evaluateRiskPosture } from './risk-posture';

const low = { id: 'low', severity: 'LOW' } as const;
const medium = { id: 'medium', severity: 'MEDIUM' } as const;
const high = { id: 'high', severity: 'HIGH' } as const;
const high2 = { id: 'high2', severity: 'HIGH' } as const;
const critical = { id: 'critical', severity: 'CRITICAL' } as const;

describe('deterministic ASM risk posture', () => {
  it('stores a baseline from active severity counts', () => {
    expect(evaluateRiskPosture([low, medium], null)).toMatchObject({ low: 1, medium: 1, total: 2, score: 3, previousScore: null, trend: 'BASELINE', shouldAlert: false });
  });
  it('reports unchanged, increased, and decreased against a persisted previous posture', () => {
    const first = evaluateRiskPosture([low, medium], null);
    const previous = { score: first.score, highImpactFindingIds: first.highImpactFindingIds };
    expect(evaluateRiskPosture([low, medium], previous).trend).toBe('UNCHANGED');
    const increase = evaluateRiskPosture([low, medium, high], previous);
    expect(increase).toMatchObject({ score: 7, trend: 'INCREASED', shouldAlert: false });
    expect(evaluateRiskPosture([low, medium], { score: increase.score, highImpactFindingIds: increase.highImpactFindingIds }).trend).toBe('DECREASED');
  });
  it('recognizes a critical increase without duplicating its individual Finding alert', () => {
    expect(evaluateRiskPosture([low, medium, critical], { score: 3, highImpactFindingIds: [] })).toMatchObject({ score: 11, trend: 'INCREASED', shouldAlert: false });
  });
  it('alerts once for a significant multi-finding asset-level increase', () => {
    expect(evaluateRiskPosture([low, medium, high, high2], { score: 3, highImpactFindingIds: [] })).toMatchObject({ score: 11, trend: 'INCREASED', shouldAlert: true, newHighImpactFindingIds: ['high', 'high2'] });
  });
});
