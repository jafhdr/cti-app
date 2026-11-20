import { classifyTemporalOrder } from './ttp-observation.logic';

describe('classifyTemporalOrder', () => {
  it('Given nonoverlapping intervals, when compared, then reports chronological order', () => {
    expect(classifyTemporalOrder({ start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z' }, { start: '2026-01-02T00:00:00Z', end: '2026-01-02T01:00:00Z' })).toBe('BEFORE');
  });
  it('Given overlapping intervals, when compared, then reports ambiguous order', () => {
    expect(classifyTemporalOrder({ start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' }, { start: '2026-01-01T12:00:00Z', end: '2026-01-03T00:00:00Z' })).toBe('OVERLAPS');
  });
});
